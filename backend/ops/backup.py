"""Consistent logical application backups with non-destructive recovery drills.

This is not a PostgreSQL physical backup, WAL archive or point-in-time recovery.
Archive data is never interpreted as SQL. Restores target new databases only.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import DateTime, Integer, create_engine, func, inspect, select, text

from backend.app.config import settings
from backend.app.database import Base

ROOT = Path(__file__).resolve().parents[2]
FORMAT = "identity-lens-logical-v1"
MAX_BYTES = 100 * 1024 * 1024
EPHEMERAL = frozenset({"auth_sessions", "workspace_sessions", "collection_tickets", "auth_throttle", "email_actions", "hosted_access"})


def config():
    result = Config(str(ROOT / "alembic.ini"))
    result.set_main_option("script_location", str(ROOT / "backend/migrations"))
    return result


def head():
    return ScriptDirectory.from_config(config()).get_current_head()


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def serialise(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("Cannot back up a timestamp without a timezone.")
        return value.astimezone(timezone.utc).isoformat()
    return value


def rows(connection):
    result = {}
    for table in Base.metadata.sorted_tables:
        if table.name in EPHEMERAL:
            continue
        records = connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()
        result[table.name] = [{key: serialise(value) for key, value in row.items()} for row in records]
    return result


def snapshot(engine):
    # Every table sees the same committed database state, even during intake.
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
            if revision != head():
                raise ValueError("Apply current migrations before creating a backup.")
            return {"format": FORMAT, "createdAt": datetime.now(timezone.utc).isoformat(),
                    "schemaRevision": revision, "excludedEphemeralTables": sorted(EPHEMERAL),
                    "tables": rows(connection)}


def write_archive(payload, path):
    path = Path(path).resolve()
    encoded = canonical(payload)
    if len(encoded) > MAX_BYTES:
        raise ValueError("This logical backup tool is limited to 100 MiB of uncompressed application data.")
    envelope = canonical({"payload": payload, "sha256": hashlib.sha256(encoded).hexdigest()})
    if len(envelope) > MAX_BYTES:
        raise ValueError("Backup envelope exceeds the 100 MiB limit.")
    # O_EXCL refuses overwrites and existing symlinks; archive permissions are 0600.
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            with gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0) as archive:
                archive.write(envelope)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        # Remove only the newly created, incomplete file, never another backup.
        path.unlink(missing_ok=True)
        raise
    return path


def read_archive(path):
    path = Path(path).resolve()
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError("Choose an existing backup smaller than 100 MiB.")
    try:
        with gzip.open(path, "rb") as archive:
            encoded = archive.read(MAX_BYTES + 1)
        if len(encoded) > MAX_BYTES:
            raise ValueError("Backup expands beyond the 100 MiB limit.")
        envelope = json.loads(encoded)
        if set(envelope) != {"payload", "sha256"}:
            raise ValueError("Invalid backup envelope.")
        payload = envelope["payload"]
        if hashlib.sha256(canonical(payload)).hexdigest() != envelope["sha256"]:
            raise ValueError("Backup checksum failed. Do not restore this file.")
        validate_payload(payload)
        return payload
    except (OSError, EOFError, json.JSONDecodeError, TypeError, KeyError) as error:
        raise ValueError("The file is not a valid Identity Lens backup.") from error


def validate_payload(payload):
    if not isinstance(payload, dict) or payload.get("format") != FORMAT:
        raise ValueError("Unsupported backup format.")
    revision = payload.get("schemaRevision")
    older = revision in ("003", "004", "005") and head() == "006"
    if revision != head() and not older:
        raise ValueError("Restore using the application version matching the backup's schema revision.")
    expected = set(Base.metadata.tables) - EPHEMERAL
    if older and revision in ("003", "004"):
        expected -= {"recovery_emails"}
        if revision == "003":
            expected -= {"evidence_requests"}
    tables = payload.get("tables")
    if not isinstance(tables, dict) or set(tables) != expected:
        raise ValueError("Backup table manifest does not match this application.")
    exclusions = EPHEMERAL - {"hosted_access"} if older else EPHEMERAL
    if older and revision in ("003", "004"):
        exclusions -= {"email_actions"}
    if payload.get("excludedEphemeralTables") != sorted(exclusions):
        raise ValueError("Backup must exclude ephemeral authentication and collection sessions.")
    for name, records in tables.items():
        expected_columns = set(Base.metadata.tables[name].columns.keys())
        if not isinstance(records, list) or any(not isinstance(row, dict) or set(row) != expected_columns for row in records):
            raise ValueError("Backup records do not match the schema for " + name + ".")


def restore_empty(engine, payload):
    validate_payload(payload)
    with engine.begin() as connection:
        if inspect(connection).get_table_names():
            raise ValueError("Restore refused: the target schema already contains tables.")
        migration = config()
        migration.attributes["connection"] = connection
        command.upgrade(migration, "head")
        for table in Base.metadata.sorted_tables:
            if table.name in EPHEMERAL:
                continue
            records = []
            for source in payload["tables"].get(table.name, []):
                row = dict(source)
                for column in table.columns:
                    if isinstance(column.type, DateTime) and row[column.name] is not None:
                        value = datetime.fromisoformat(row[column.name])
                        if value.tzinfo is None:
                            raise ValueError("Restored timestamps require a timezone.")
                        row[column.name] = value
                records.append(row)
            if records:
                connection.execute(table.insert(), records)
            # Restoring explicit IDs must also recover the sequence high-water mark.
            for column in table.primary_key.columns:
                if isinstance(column.type, Integer):
                    schema = connection.scalar(text("SELECT current_schema()"))
                    relation = connection.dialect.identifier_preparer.quote_schema(schema) + "." + connection.dialect.identifier_preparer.quote(table.name)
                    sequence = connection.scalar(text("SELECT pg_get_serial_sequence(:relation, :column)"), {"relation": relation, "column": column.name})
                    maximum = connection.scalar(select(func.max(column)))
                    if sequence and maximum is not None:
                        connection.execute(text("SELECT setval(CAST(:sequence AS regclass), :maximum, true)"), {"sequence": sequence, "maximum": maximum})
        restored = rows(connection)
        expected = {name: payload["tables"].get(name, []) for name in restored}
        if canonical(restored) != canonical(expected):
            raise ValueError("Restored data failed the exact-content verification.")
    return {name: len(records) for name, records in restored.items()}


def verify(engine, payload):
    validate_payload(payload)
    schema = "lens_backup_verify_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = create_engine(engine.url, connect_args={"options": f"-c search_path={schema}"})
    try:
        return restore_empty(isolated, payload)
    finally:
        isolated.dispose()
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def recovery_database(engine, payload, name):
    validate_payload(payload)
    if not re.fullmatch(r"lens_recovery_[a-z0-9_]{1,40}", name) or name == engine.url.database:
        raise ValueError("Use a NEW database named lens_recovery_<name>. The active database can never be a target.")
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        if connection.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": name}):
            raise ValueError("Restore refused: this database already exists. Choose a new recovery name.")
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    target = create_engine(engine.url.set(database=name))
    try:
        return restore_empty(target, payload)
    finally:
        target.dispose()
    # An unsuccessful new database is deliberately retained for operator diagnosis.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("create")
    check = actions.add_parser("verify")
    check.add_argument("archive")
    restore = actions.add_parser("restore")
    restore.add_argument("archive")
    restore.add_argument("--database", required=True)
    args = parser.parse_args()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        if args.action == "create":
            payload = snapshot(engine)
            directory = ROOT / ".local/backups"
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            archive = write_archive(payload, directory / ("identity-lens-" + stamp + "-" + uuid4().hex[:8] + ".json.gz"))
            print("Backup saved:", archive)
            print("Private local file; not encrypted. Keep it out of submissions and source control.")
            counts = verify(engine, read_archive(archive))
            print("Recovery drill passed:", sum(counts.values()), "rows restored and exactly compared across", len(counts), "tables.")
            print("Only the temporary verification schema was removed. Active workspace data was not changed.")
        else:
            payload = read_archive(args.archive)
            counts = verify(engine, payload) if args.action == "verify" else recovery_database(engine, payload, args.database)
            print("Verified", sum(counts.values()), "persistent rows across", len(counts), "tables.")
            if args.action == "restore":
                print("Recovered into NEW database:", args.database)
                print("Active database unchanged. Set DATABASE_URL to the recovered database before restarting; users must sign in again.")
            else:
                print("Temporary verification schema removed; active workspace data unchanged.")
    except Exception as error:
        # Do not print database URLs, credentials, queries or archived record values.
        message = str(error) if isinstance(error, ValueError) else "Database operation failed. Inspect the configuration; existing workspace data was not overwritten."
        parser.exit(1, message + "\n")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
