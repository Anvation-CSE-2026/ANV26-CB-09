from pathlib import Path
import os
import pytest
from sqlalchemy import select
from backend.tests.test_organisations import client, test_db, workspace, register
from backend.app.database import Integration
from backend.ops.connect_registration import connect
from backend.app.auth import digest


def test_local_setup_scopes_a_private_key_and_refuses_overwrites(workspace, tmp_path):
    client, factory = workspace
    _, owner = register(client, "Local connector fixture")
    path = tmp_path / "registration.env"
    result = connect(factory, "Local connector fixture", path)
    assert "secret" not in result
    assert os.stat(path).st_mode & 0o777 == 0o600
    secret = path.read_text().split("LENS_REGISTRATION_KEY=")[1].strip()
    with factory() as db:
        row = db.get(Integration, result["integrationId"])
        assert row.organisation_id == owner["organisationId"] and row.key_hash == digest(secret)
    assert client.post("/api/ingest/check", headers={"X-Lens-Key": secret}).json()["organisationName"] == "Local connector fixture"
    with pytest.raises(ValueError, match="already configured"):
        connect(factory, "Local connector fixture", path)
    assert path.read_text().split("LENS_REGISTRATION_KEY=")[1].strip() == secret
    assert len(client.get("/api/org/integrations").json()) == 1


def test_missing_or_ambiguous_org_and_file_error_create_nothing(workspace, tmp_path):
    client, factory = workspace
    register(client, "Ambiguous connector fixture")
    register(client, "Ambiguous connector fixture")
    path = tmp_path / "unwritten.env"
    with pytest.raises(ValueError, match="exactly one"):
        connect(factory, "Missing org", path)
    with pytest.raises(ValueError, match="exactly one"):
        connect(factory, "Ambiguous connector fixture", path)
    assert not path.exists()
    assert client.get("/api/org/integrations").json() == []
