import copy
from fastapi.testclient import TestClient
from backend.tests.test_organisations import client, test_db, workspace, register, connection
from backend import registration


def connector(workspace, monkeypatch):
    client, _ = workspace
    register(client)
    key = connection(client)["secret"]
    monkeypatch.setattr(registration, "connection_config", lambda: ("http://127.0.0.1:8000", key))
    class Forward:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, path, **kwargs): return client.post(path, headers={"X-Lens-Key": key}, **kwargs)
    monkeypatch.setattr(registration, "client_for", lambda *args: Forward())
    return client, TestClient(registration.app), key


def test_separate_registration_backend_delivers_and_deduplicates(workspace, monkeypatch):
    client, site, key = connector(workspace, monkeypatch)
    status = site.get("/api/connection")
    assert status.status_code == 200 and key not in status.text
    data = {"synthetic": True, "external_id": "CONNECTED-001", "registered_at": "2026-10-01T09:00:00Z", "region": "North", "birth_year": 1990, "email_age_days": 365, "phone_verified": True, "add_session": True, "device_token": "DEV-CONNECTED", "form_seconds": 190, "edit_count": 4}
    received = site.post("/api/register", json=data)
    assert received.status_code == 200, received.text
    assert received.json()["observationsAccepted"] == 1
    assert "score" not in received.text and key not in received.text
    retry = site.post("/api/register", json=data)
    assert retry.status_code == 200 and retry.json()["duplicateRegistration"] and retry.json()["observationsAccepted"] == 0
    cases = client.get("/api/org/cases").json()
    assert len(cases) == 1
    detail = client.get("/api/org/cases/" + cases[0]["id"]).json()
    assert len(detail["events"]) == 1 and detail["events"][0]["source"] == "server_integration"
    assert detail["evidence"]["sessions"][0]["failed_attempts"] is None
    assert site.post("/api/register", json={**data, "birth_year": 1991}).status_code == 409


def test_registration_scope_and_revocation(workspace, monkeypatch):
    client, site, key = connector(workspace, monkeypatch)
    data = {"synthetic": True, "external_id": "APP-001", "registered_at": "2026-10-01T09:00:00Z"}
    assert site.post("/api/register", json={**data, "synthetic": False}).status_code == 422
    assert site.post("/api/register", json=data, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert site.post("/api/register", json=data, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert site.post("/api/register", json={**data, "add_session": True}).status_code == 422
    assert site.post("/api/register", json={**data, "registered_at": "2026-10-01T09:00:00"}).status_code == 422
    integration = client.get("/api/org/integrations").json()[0]
    assert client.delete("/api/org/integrations/" + integration["id"]).status_code == 200
    assert site.get("/api/connection").status_code == 503
