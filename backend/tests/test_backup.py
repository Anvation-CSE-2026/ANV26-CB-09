import copy
from datetime import timedelta
import gzip
import json
import os
from uuid import uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import (Account, Organisation, Membership, WorkspaceCase,
    WorkspaceAudit, WorkspaceAssessment, WorkspaceSession, Integration, EvidenceEvent, now, get_db)
from backend.app import main
from backend.app.evidence import EvidenceInput, SessionRecord, calculate, POLICY
from backend.app.workspaces import hash_password
from backend.ops.backup import (canonical, config, read_archive, recovery_database,
    restore_empty, snapshot, verify, write_archive, EPHEMERAL)

PASSWORD = "A-recovery-test-password-2026"


@pytest.fixture
def source_database():
    schema = "lens_backup_test_" + uuid4().hex
    admin = create_engine(settings.database_url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = create_engine(settings.database_url, connect_args={"options": f"-c search_path={schema}"})
    with isolated.begin() as connection:
        migration = config()
        migration.attributes["connection"] = connection
        command.upgrade(migration, "head")
    stamp = now()
    with Session(isolated) as db:
        db.add_all([Account(id="ACCOUNT-1", username="recovery-test", display_name="Recovery test", password_hash=hash_password(PASSWORD)),
                    Organisation(id="ORG-1", name="Recovery fixture")])
        db.flush()
        db.add(Membership(organisation_id="ORG-1", account_id="ACCOUNT-1", role="admin"))
        event = SessionRecord(event_id="OBS-1", timestamp=stamp + timedelta(minutes=1), device_token="DEV-RECOVERY", form_seconds=190, edit_count=4)
        evidence = EvidenceInput(synthetic=True, external_id="APP-1", registered_at=stamp, profile_records=[{"source": "Synthetic evidence ✓"}], sessions=[event])
        case = WorkspaceCase(id="CASE-1", organisation_id="ORG-1", external_id="APP-1", assigned_to="ACCOUNT-1", payload=evidence.model_dump(mode="json"))
        db.add(case)
        db.flush()
        db.add_all([WorkspaceAudit(id=500, organisation_id="ORG-1", case_id="CASE-1", actor="ACCOUNT-1", action="review_saved", details={"note": "Retain this exact note."}),
                    WorkspaceAssessment(id=700, organisation_id="ORG-1", case_id="CASE-1", policy_version=POLICY, evidence_revision=1, payload=calculate(case, [case])),
                    EvidenceEvent(id="EVENT-1", organisation_id="ORG-1", case_id="CASE-1", external_id="OBS-1", source="synthetic_replay", payload=event.model_dump(mode="json")),
                    Integration(id="KEY-1", organisation_id="ORG-1", name="Fixture integration", origins=["https://example.test"], key_hash="a" * 64, key_prefix="lens_example"),
                    WorkspaceSession(token_hash="b" * 64, organisation_id="ORG-1", account_id="ACCOUNT-1", expires_at=stamp + timedelta(hours=1))])
        db.commit()
    try:
        yield isolated
    finally:
        isolated.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_backup_is_private_exact_and_does_not_include_sessions(source_database, tmp_path):
    payload = snapshot(source_database)
    path = write_archive(payload, tmp_path / "workspace.json.gz")
    assert os.stat(path).st_mode & 0o777 == 0o600
    assert read_archive(path) == payload
    assert not (EPHEMERAL & set(payload["tables"]))
    assert payload["tables"]["accounts"][0]["password_hash"].startswith("scrypt$")
    assert PASSWORD not in json.dumps(payload)
    before = canonical(payload["tables"])
    counts = verify(source_database, payload)
    assert counts["workspace_cases"] == 1 and counts["workspace_audit"] == 1
    assert canonical(snapshot(source_database)["tables"]) == before
    with source_database.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM workspace_sessions")) == 1


def test_recovery_resets_sequences_and_excludes_authentication_sessions(source_database):
    # A generated, temporary database is the only destructive cleanup target.
    target_name = "lens_recovery_test_" + uuid4().hex[:20]
    payload = snapshot(source_database)
    target = create_engine(source_database.url.set(database=target_name))
    try:
        recovery_database(source_database, payload, target_name)
        assert snapshot(target)["tables"] == payload["tables"]
        with Session(target) as db:
            assert db.scalar(text("SELECT COUNT(*) FROM workspace_sessions")) == 0
            audit = WorkspaceAudit(organisation_id="ORG-1", actor="ACCOUNT-1", action="review_saved", details={"note": "New note after recovery."})
            db.add(audit)
            db.flush()
            assert audit.id == 501
            assessment = WorkspaceAssessment(organisation_id="ORG-1", case_id="CASE-1", policy_version="test", evidence_revision=1, payload={"score": 4})
            db.add(assessment)
            db.flush()
            assert assessment.id == 701
            db.rollback()
        with pytest.raises(ValueError, match="already exists"):
            recovery_database(source_database, payload, target_name)
        def recovered_session():
            with Session(target) as db:
                yield db
        previous_overrides = dict(main.app.dependency_overrides)
        main.app.dependency_overrides[get_db] = recovered_session
        # No lifespan: do not seed or change any other database during this check.
        client = TestClient(main.app)
        try:
            assert client.get("/api/org/me").status_code == 401
            logged_in = client.post("/api/org/login", json={"username": "recovery-test", "password": PASSWORD})
            assert logged_in.status_code == 200
            recovered_case = client.get("/api/org/cases/CASE-1").json()
            assert recovered_case["evidence"] == payload["tables"]["workspace_cases"][0]["payload"]
            assert recovered_case["audit"][0]["details"]["note"] == "Retain this exact note."
            assert client.put("/api/org/cases/CASE-1/review", json={"revision": recovered_case["revision"], "status": "In review", "note": "The recovered application accepts new reviews."}).status_code == 200
        finally:
            client.close()
            main.app.dependency_overrides.clear()
            main.app.dependency_overrides.update(previous_overrides)
    finally:
        target.dispose()
        with source_database.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            if connection.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": target_name}):
                connection.execute(text(f'DROP DATABASE "{target_name}"'))


def test_existing_data_cannot_be_overwritten(source_database):
    payload = snapshot(source_database)
    with pytest.raises(ValueError, match="already contains tables"):
        restore_empty(source_database, payload)
    with pytest.raises(ValueError, match="NEW database"):
        recovery_database(source_database, payload, source_database.url.database)
    assert snapshot(source_database)["tables"] == payload["tables"]


def test_corruption_unknown_tables_and_schema_mismatch_are_rejected(source_database, tmp_path):
    payload = snapshot(source_database)
    path = write_archive(payload, tmp_path / "original.json.gz")
    with pytest.raises(FileExistsError):
        write_archive(payload, path)
    envelope = json.loads(gzip.decompress(path.read_bytes()))
    envelope["payload"]["tables"]["accounts"][0]["display_name"] = "Corrupted"
    corrupt = tmp_path / "corrupted.json.gz"
    corrupt.write_bytes(gzip.compress(canonical(envelope)))
    with pytest.raises(ValueError, match="checksum failed"):
        read_archive(corrupt)
    unknown = copy.deepcopy(payload)
    unknown["tables"]["not_an_application_table"] = []
    with pytest.raises(ValueError, match="manifest"):
        verify(source_database, unknown)
    old = {**payload, "schemaRevision": "unknown"}
    with pytest.raises(ValueError, match="matching"):
        verify(source_database, old)


def test_previous_schema_backup_is_recoverable_after_workflow_upgrade(source_database):
    previous = snapshot(source_database)
    previous["schemaRevision"] = "003"
    previous["tables"].pop("evidence_requests")
    previous["tables"].pop("recovery_emails")
    previous["excludedEphemeralTables"].remove("email_actions")
    previous["excludedEphemeralTables"].remove("hosted_access")
    counts = verify(source_database, previous)
    assert counts["workspace_cases"] == 1
    assert counts["evidence_requests"] == 0
    assert counts["recovery_emails"] == 0


def test_workflow_schema_backup_is_recoverable_after_email_upgrade(source_database):
    previous = snapshot(source_database)
    previous["schemaRevision"] = "004"
    previous["tables"].pop("recovery_emails")
    previous["excludedEphemeralTables"].remove("email_actions")
    previous["excludedEphemeralTables"].remove("hosted_access")
    assert verify(source_database, previous)["recovery_emails"] == 0


def test_schema_005_backup_restores_without_reactivating_hosted_links(source_database):
    previous = snapshot(source_database)
    previous["schemaRevision"] = "005"
    previous["excludedEphemeralTables"].remove("hosted_access")
    assert verify(source_database, previous)["workspace_cases"] == 1
