from datetime import timedelta
from uuid import uuid4
from backend.app.database import now
from backend.tests.test_organisations import client, test_db, workspace, register, create, empty_case, login, PASSWORD, connection


def test_onboarding_distinguishes_key_creation_from_actual_delivery(workspace):
    client, _ = workspace
    register(client)
    setup = client.get("/api/org/onboarding").json()
    assert setup["members"] == 1 and setup["applicants"] == 0
    integration = connection(client)
    setup = client.get("/api/org/onboarding").json()
    assert setup["activeConnections"] == 1 and setup["serverCasesReceived"] == 0
    assert client.post("/api/ingest/cases", json=empty_case(), headers={"X-Lens-Key": integration["secret"]}).status_code == 201
    setup = client.get("/api/org/onboarding").json()
    assert setup["serverCasesReceived"] == 1 and setup["applicants"] == 1
    assert not setup["browserMeasurementEnabled"]


def test_requests_are_actionable_revision_checked_and_do_not_change_risk(workspace):
    client, _ = workspace
    _, owner = register(client)
    case_id = create(client, empty_case())
    before = client.get(f"/api/org/cases/{case_id}").json()
    request = {"case_revision": before["revision"], "category": "Phone verification", "description": "Obtain a fictional verification record.", "assigned_to": owner["accountId"], "due_at": (now() + timedelta(hours=24)).isoformat()}
    response = client.post(f"/api/org/cases/{case_id}/requests", json=request)
    assert response.status_code == 201, response.text
    row = response.json()
    after = client.get(f"/api/org/cases/{case_id}").json()
    assert after["status"] == "Needs evidence" and after["revision"] == before["revision"] + 1
    assert after["evidenceRevision"] == before["evidenceRevision"]
    assert after["assessment"] == before["assessment"]
    assert client.post(f"/api/org/cases/{case_id}/requests", json=request).status_code == 409
    assert client.post(f"/api/org/cases/{case_id}/requests", json={**request, "case_revision": after["revision"]}).status_code == 409
    close = {"revision": row["revision"], "status": "Resolved", "resolution": "Reviewed the supplied fictional record; no independent verification claimed."}
    endpoint = f"/api/org/cases/{case_id}/requests/{row['id']}"
    assert client.put(endpoint, json=close).status_code == 200
    assert client.put(endpoint, json=close).status_code == 409
    assert client.get(f"/api/org/cases/{case_id}/requests").json()[0]["status"] == "Resolved"
    assert client.get(f"/api/org/cases/{case_id}").json()["assessment"] == before["assessment"]
    assert client.get("/api/org/onboarding").json()["openRequests"] == 0


def test_request_scope_and_viewer_permissions(workspace):
    client, _ = workspace
    owner_a, _ = register(client)
    case_id = create(client, empty_case())
    row = client.post(f"/api/org/cases/{case_id}/requests", json={"case_revision": 1, "category": "Other", "description": "Clarify the supplied source record."}).json()
    register(client)
    assert client.get(f"/api/org/cases/{case_id}/requests").status_code == 404
    assert client.put(f"/api/org/cases/{case_id}/requests/{row['id']}", json={"revision": 1, "status": "Resolved", "resolution": "This request is not ours."}).status_code == 404
    login(client, owner_a)
    invitation = client.post("/api/org/invitations", json={"role": "viewer"}).json()
    assert client.post("/api/org/join", json={"username": "requests-viewer-" + uuid4().hex[:8], "password": PASSWORD, "display_name": "Viewer", "token": invitation["token"]}).status_code == 200
    assert client.get(f"/api/org/cases/{case_id}/requests").status_code == 200
    assert client.post(f"/api/org/cases/{case_id}/requests", json={"case_revision": 2, "category": "Email history", "description": "Another request."}).status_code == 403
    assert client.put(f"/api/org/cases/{case_id}/requests/{row['id']}", json={"revision": 1, "status": "Cancelled", "resolution": "Not allowed for a viewer."}).status_code == 403
