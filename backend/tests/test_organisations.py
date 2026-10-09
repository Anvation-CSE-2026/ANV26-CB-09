import copy
import csv
import io
import json
from uuid import uuid4
import pytest
from sqlalchemy import select, delete
from backend.tests.test_api import client, test_db
from backend.app.database import Account, AuthThrottle, WorkspaceSession, Integration, now
from backend.app.config import settings
from backend.app.auth import digest

PASSWORD = "A-local-test-password-2026"


@pytest.fixture
def workspace(client, test_db):
    with test_db[1].begin() as db:
        db.execute(delete(AuthThrottle))
    return client, test_db[1]


def register(client, label="Organisation"):
    username = "user-" + uuid4().hex[:12]
    response = client.post("/api/org/register", json={"username": username, "password": PASSWORD, "display_name": "Test operator", "organisation_name": label})
    assert response.status_code == 201, response.text
    return username, response.json()


def login(client, username):
    response = client.post("/api/org/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text


def empty_case(external_id="APP-001"):
    return {"synthetic": True, "external_id": external_id, "registered_at": "2026-10-01T09:00:00Z", "profile_records": [], "sessions": []}


def create(client, data):
    response = client.post("/api/org/cases", json=data)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def connection(client):
    response = client.post("/api/org/integrations", json={"name": "Test registration system", "origins": ["https://registration.example.test"]})
    assert response.status_code == 201, response.text
    return response.json()


def test_named_accounts_start_empty_and_passwords_are_hashed(workspace):
    client, factory = workspace
    username, account = register(client)
    assert client.get("/api/org/cases").json() == []
    token = client.cookies.get("lens_workspace")
    with factory() as db:
        stored = db.get(Account, account["accountId"])
        assert stored.password_hash.startswith("scrypt$") and PASSWORD not in stored.password_hash
        assert db.get(WorkspaceSession, digest(token)).account_id == stored.id
    assert client.post("/api/org/logout").status_code == 204
    assert client.get("/api/org/me").status_code == 401
    assert client.post("/api/org/login", json={"username": username, "password": "wrong-password-2026"}).status_code == 401
    login(client, username)
    assert client.get("/api/org/me").json()["role"] == "admin"


def test_cross_organisation_access_and_graphs_are_isolated(workspace):
    client, _ = workspace
    owner_a, _ = register(client, "Organisation A")
    case_a = create(client, empty_case())
    owner_b, _ = register(client, "Organisation B")
    case_b = create(client, empty_case())
    assert case_a != case_b
    for path in (f"/api/org/cases/{case_a}", f"/api/org/cases/{case_a}/report"):
        assert client.get(path).status_code == 404
    assert client.post(f"/api/org/cases/{case_a}/sensitivity", json={"excluded": []}).status_code == 404
    assert client.put(f"/api/org/cases/{case_a}/review", json={"revision": 1, "status": "In review"}).status_code == 404
    assert client.put(f"/api/org/cases/{case_a}/evidence", json={"revision": 1, "reason": "Correction reason", "evidence": empty_case()}).status_code == 404
    assert len(client.get("/api/org/cases").json()) == 1
    login(client, owner_a)
    assert client.get(f"/api/org/cases/{case_b}").status_code == 404
    assert client.get(f"/api/org/cases/{case_a}").json()["assessment"]["band"] == "Pending"
    assert client.post("/api/org/cases", json=empty_case()).status_code == 409


def test_matching_tokens_never_link_between_organisations(workspace):
    client, _ = workspace
    owner_a, _ = register(client, "Isolated A")
    evidence = {**empty_case(), "phone_token": "PHONE-SAME", "address_token": "ADDR-SAME",
                "sessions": [{"event_id": "OBS-001", "timestamp": "2026-10-01T09:01:00Z", "device_token": "DEV-SAME"}]}
    case_a = create(client, evidence)
    register(client, "Isolated B")
    case_b = create(client, evidence)
    result = client.get(f"/api/org/cases/{case_b}").json()["assessment"]
    assert result["links"] == [] and result["coverage"]["status"] == "Incomplete"
    login(client, owner_a)
    assert client.get(f"/api/org/cases/{case_a}").json()["assessment"]["links"] == []
    create(client, {**evidence, "external_id": "APP-002"})
    linked = client.get(f"/api/org/cases/{case_a}").json()["assessment"]
    assert linked["links"] and all(case_b not in link["peers"] for link in linked["links"])
    assert all(record["caseId"] != case_b for indicator in linked["indicators"] if indicator["id"] == "shared-device" for record in indicator["sourceRecords"])


def test_missing_observations_are_not_misrepresented_as_verified(workspace):
    client, _ = workspace
    register(client)
    evidence = {**empty_case(), "profile_records": [{"source": "Record A"}, {"source": "Record B"}],
                "sessions": [{"event_id": "OBS-001", "timestamp": "2026-10-01T09:01:00Z", "device_token": "DEV-UNKNOWN"}]}
    case_id = create(client, evidence)
    result = client.get(f"/api/org/cases/{case_id}").json()["assessment"]
    assert result["coverage"]["percent"] == 0
    assert "incomplete" in result["explanation"].lower()
    assert not any(m["title"] in ("Profile attributes are consistent", "Contact verification completed", "Device attributes are coherent", "Location pattern is stable") for m in result["mitigations"])


def test_unrelated_evidence_does_not_multiply_assessment_history(workspace):
    client, _ = workspace
    register(client)
    case_a = create(client, {**empty_case("NO-LINK-A"), "sessions": [{"event_id": "OBS-A", "timestamp": "2026-10-01T09:01:00Z", "device_token": "DEV-ALONE-A"}]})
    before = client.get(f"/api/org/cases/{case_a}").json()
    assert len(before["history"]) == 1
    create(client, {**empty_case("NO-LINK-B"), "sessions": [{"event_id": "OBS-B", "timestamp": "2026-10-01T09:01:00Z", "device_token": "DEV-ALONE-B"}]})
    assert len(client.get(f"/api/org/cases/{case_a}").json()["history"]) == 1
    create(client, {**empty_case("NEW-LINK-C"), "sessions": [{"event_id": "OBS-C", "timestamp": "2026-10-01T09:01:00Z", "device_token": "DEV-ALONE-A"}]})
    after = client.get(f"/api/org/cases/{case_a}").json()
    assert len(after["history"]) == 2
    assert after["assessment"]["score"] > before["assessment"]["score"]
    assert len(client.get("/api/org/cases").json()) == 3


def test_import_preview_atomicity_and_sample_assessments(workspace):
    client, _ = workspace
    register(client)
    sample = client.get("/api/org/sample-dataset").json()
    invalid = copy.deepcopy(sample[0]); invalid["email"] = "real-person@example.test"
    request = {"format": "json", "filename": "synthetic.json", "content": json.dumps([sample[0], invalid])}
    preview = client.post("/api/org/imports/preview", json=request).json()
    assert not preview["valid"] and preview["errors"]
    assert client.post("/api/org/imports", json=request).status_code == 422
    assert client.get("/api/org/cases").json() == []
    request["content"] = json.dumps(sample)
    assert client.post("/api/org/imports/preview", json=request).json()["valid"]
    assert client.post("/api/org/imports", json=request).status_code == 201
    rows = client.get("/api/org/cases").json()
    scores = {r["externalId"]: r["assessment"]["score"] for r in rows}
    assert [scores[k] for k in ("CASE-001", "CASE-002", "CASE-003")] == [0, 32, 100]
    assert client.post("/api/org/imports", json=request).status_code == 422
    assert len(client.get("/api/org/cases").json()) == len(sample)
    detail = client.get("/api/org/cases/" + rows[0]["id"]).json()
    assert all(e["source"] == "dataset_import" for e in detail["events"])


def test_csv_and_temporal_validation(workspace):
    client, _ = workspace
    register(client)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["synthetic", "external_id", "registered_at", "profile_records", "sessions"])
    writer.writeheader(); writer.writerow({"synthetic": "true", "external_id": "CSV-001", "registered_at": "2026-10-01T09:00:00Z", "profile_records": "[]", "sessions": "[]"})
    request = {"format": "csv", "content": output.getvalue(), "filename": "cases.csv"}
    assert client.post("/api/org/imports/preview", json=request).json()["valid"]
    assert client.post("/api/org/imports", json=request).status_code == 201
    assert client.post("/api/org/cases", json={**empty_case("BAD"), "synthetic": False}).status_code == 422
    assert client.post("/api/org/cases", json={**empty_case("BAD"), "registered_at": "2026-10-01T09:00:00"}).status_code == 422
    assert client.post("/api/org/cases", json={**empty_case("BAD"), "email_created_at": "2026-10-02T09:00:00Z"}).status_code == 422


def test_corrections_preserve_history_and_reviews_do_not_change_evidence_version(workspace):
    client, _ = workspace
    register(client)
    response = client.post("/api/org/collection/replay", json={"scenario": "coordinated_ring"})
    assert response.status_code == 201, response.text
    case_id = response.json()["caseIds"][0]
    before = client.get(f"/api/org/cases/{case_id}").json()
    assert before["assessment"]["band"] == "High"
    review = {"revision": before["revision"], "status": "Needs evidence", "note": "Please clarify the shared contacts."}
    assert client.put(f"/api/org/cases/{case_id}/review", json=review).status_code == 200
    assert client.put(f"/api/org/cases/{case_id}/review", json=review).status_code == 409
    saved = client.get(f"/api/org/cases/{case_id}").json()
    assert saved["evidenceRevision"] == before["evidenceRevision"]
    corrected = copy.deepcopy(saved["evidence"])
    corrected["profile_records"][1] = {**corrected["profile_records"][0], "source": "Corrected verification record"}
    corrected["emulated_device"] = False; corrected["device_mismatch"] = False
    request = {"revision": saved["revision"], "reason": "Source records corrected after analyst review.", "evidence": corrected}
    assert client.put(f"/api/org/cases/{case_id}/evidence", json=request).status_code == 200
    after = client.get(f"/api/org/cases/{case_id}").json()
    assert after["assessment"]["score"] < before["assessment"]["score"]
    assert after["evidenceRevision"] == before["evidenceRevision"] + 1
    assert any(h["score"] == before["assessment"]["score"] for h in after["history"])
    assert any(a["details"].get("previous") == saved["evidence"] for a in after["audit"])


def test_invites_permissions_revocation_and_last_admin(workspace):
    client, _ = workspace
    owner, account = register(client)
    case_id = create(client, empty_case())
    invitation = client.post("/api/org/invitations", json={"role": "viewer"}).json()
    viewer = "viewer-" + uuid4().hex[:8]
    join = {"token": invitation["token"], "username": viewer, "password": PASSWORD, "display_name": "Viewer operator"}
    assert client.post("/api/org/join", json=join).status_code == 200
    viewer_id = client.get("/api/org/me").json()["id"]
    assert client.get(f"/api/org/cases/{case_id}/report").status_code == 200
    assert client.post("/api/org/cases", json=empty_case("VIEWER-CASE")).status_code == 403
    assert client.post("/api/org/invitations", json={"role": "admin"}).status_code == 403
    assert client.get("/api/org/integrations").status_code == 403
    assert client.put(f"/api/org/cases/{case_id}/review", json={"revision": 1, "status": "Review complete"}).status_code == 403
    assert client.post("/api/org/join", json=join).status_code == 410
    login(client, owner)
    assert client.put(f"/api/org/team/{account['accountId']}", json={"role": "viewer", "active": True}).status_code == 409
    assert client.put(f"/api/org/team/{viewer_id}", json={"role": "viewer", "active": False}).status_code == 200
    assert client.post("/api/org/login", json={"username": viewer, "password": PASSWORD}).status_code == 403


def test_server_integration_keys_deduplicate_and_revoke(workspace):
    client, factory = workspace
    register(client)
    integration = connection(client)
    key = {"X-Lens-Key": integration["secret"]}
    with factory() as db:
        assert db.get(Integration, integration["id"]).key_hash == digest(integration["secret"])
    assert "secret" not in client.get("/api/org/integrations").json()[0]
    request = empty_case("CONNECTED-001")
    first = client.post("/api/ingest/cases", json=request, headers=key)
    assert first.status_code == 201, first.text
    assert client.post("/api/ingest/cases", json=request, headers=key).json()["duplicate"]
    assert client.post("/api/ingest/cases", json=empty_case("BROWSER"), headers={**key, "Origin": "http://localhost:4173"}).status_code == 403
    sessions = {"synthetic": True, "sessions": [{"event_id": "EVENT-001", "timestamp": "2026-10-01T09:10:00Z", "device_token": "DEV-CONNECTED", "form_seconds": 190, "edit_count": 4}]}
    endpoint = "/api/ingest/cases/CONNECTED-001/sessions"
    assert client.post(endpoint, json=sessions, headers=key).json()["accepted"] == 1
    assert client.post(endpoint, json=sessions, headers=key).json()["duplicates"] == 1
    sessions["sessions"][0]["form_seconds"] = 10
    assert client.post(endpoint, json=sessions, headers=key).status_code == 409
    assert client.delete("/api/org/integrations/" + integration["id"]).status_code == 200
    assert client.post(endpoint, json=sessions, headers=key).status_code == 401


def test_browser_tickets_are_gated_origin_bound_and_idempotent(workspace, monkeypatch):
    client, _ = workspace
    register(client)
    integration = connection(client)
    key = {"X-Lens-Key": integration["secret"]}
    create(client, empty_case("BROWSER-001"))
    request = {"synthetic": True, "external_id": "BROWSER-001", "browser_token": "DEV-SYNTHETIC-BROWSER"}
    assert client.post("/api/ingest/collection-tickets", json=request, headers=key).status_code == 403
    monkeypatch.setattr(settings, "allow_browser_telemetry", True)
    response = client.post("/api/ingest/collection-tickets", json=request, headers=key)
    assert response.status_code == 201, response.text
    event = {"ticket": response.json()["ticket"], "event_id": "BROWSER-EVENT", "type": "form_completed", "form_seconds": 190, "edit_count": 4, "collection_notice_acknowledged": True}
    assert client.post("/api/collect/events", json=event, headers={"Origin": "https://other.example.test"}).status_code == 403
    origin = {"Origin": "https://registration.example.test"}
    assert client.post("/api/collect/events", json={**event, "typed_values": {"password": "never-store"}}, headers=origin).status_code == 422
    response = client.post("/api/collect/events", json=event, headers=origin)
    assert response.status_code == 200 and response.json()["accepted"] == 1, response.text
    assert response.headers["access-control-allow-origin"] == origin["Origin"]
    assert client.post("/api/collect/events", json=event, headers=origin).json()["duplicate"]
    row = client.get("/api/org/cases").json()[0]
    detail = client.get("/api/org/cases/" + row["id"]).json()
    assert detail["events"][0]["source"] == "browser_client_reported"
    assert detail["evidence"]["sessions"][0]["failed_attempts"] is None
    assert detail["evidence"]["sessions"][0]["region"] is None
