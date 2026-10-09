"""Local operator setup: attach the standalone connector to a chosen existing org.

Requires instance-level database access. This is never exposed as a web endpoint.
Creates only a new private configuration file; no existing key/config is overwritten.
"""
import argparse
import os
from pathlib import Path
import secrets
from sqlalchemy import select
from backend.app.database import SessionLocal, Organisation, Integration
from backend.app.auth import digest
from backend.app.workspaces import uid, audit

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".local/registration.env"


def connect(factory, organisation_name, destination=CONFIG):
    path = Path(destination).resolve()
    if path.exists():
        raise ValueError("A connector is already configured. No existing configuration or integration was changed.")
    secret = "lens_" + secrets.token_urlsafe(32)
    written = False
    try:
        with factory.begin() as db:
            matches = list(db.scalars(select(Organisation).where(Organisation.name == organisation_name).with_for_update()))
            if len(matches) != 1:
                raise ValueError("Choose exactly one existing organisation name. Missing or duplicate names cannot be connected automatically.")
            org = matches[0]
            row = Integration(id=uid(), organisation_id=org.id, name="Local registration application", origins=["http://localhost:4180", "http://127.0.0.1:4180"], key_hash=digest(secret), key_prefix=secret[:12])
            db.add(row)
            audit(db, org.id, "local-operator", "integration_created", {"integrationId": row.id, "source": "local_connector_setup", "configLocation": ".local/registration.env"})
            db.flush()
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            written = True
            with os.fdopen(descriptor, "w") as output:
                output.write("LENS_REGISTRATION_API=http://127.0.0.1:8000\nLENS_REGISTRATION_KEY=" + secret + "\n")
                output.flush()
                os.fsync(output.fileno())
            result = {"organisation": org.name, "integrationId": row.id, "path": str(path)}
        return result
    except Exception:
        if written:
            path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organisation", required=True)
    args = parser.parse_args()
    try:
        result = connect(SessionLocal, args.organisation)
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
    print("Connected the registration service to", result["organisation"] + ".")
    print("Private configuration:", result["path"])
    print("The secret is not printed and never enters browser code. The organisation can revoke it under Connections.")


if __name__ == "__main__":
    main()
