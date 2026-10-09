from datetime import timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from backend.tests.test_organisations import client, test_db, workspace, register, create, empty_case, login
from backend.app.database import HostedAccess, EvidenceEvent, WorkspaceCase, Membership, now
from backend.app.auth import digest
from backend.app.config import settings

ORIGIN = {"Origin": "http://localhost:4173"}


def issue(client, case_id):
    response = client.post("/api/org/hosted-links", json={"case_id": case_id, "synthetic": True})
    assert response.status_code == 201, response.text
    return response.json()


def begin(client, token, browser="DEV-HOSTED-ONE"):
    return client.post("/api/hosted/start", headers=ORIGIN, json={"token": token, "browser_token": browser,
        "notice_acknowledged": True, "synthetic": True})


def summary(token):
    return {"ticket": token, "event_id": str(uuid4()), "type": "form_completed", "form_seconds": 1.0,
        "edit_count": 3, "collection_notice_acknowledged": True}


def test_hosted_activity_is_scoped_hashed_and_source_labelled(workspace):
    client, factory = workspace
    register(client, "Hosted company")
    case_id = create(client, empty_case())
    before = client.get(f"/api/org/cases/{case_id}").json()
    link = issue(client, case_id)
    token = link["token"]
    listed = client.get("/api/org/hosted-links").json()
    assert token not in str(listed) and "token_hash" not in str(listed)
    with factory() as db:
        row = db.get(HostedAccess, link["id"])
        assert row.token_hash == digest(token) and row.started_at is None and row.browser_token is None
    info = client.post("/api/hosted/info", headers=ORIGIN, json={"token": token}).json()
    assert info["organisationName"] == "Hosted company" and info["externalId"] == "APP-001"
    assert "score" not in str(info) and "caseId" not in info and "password" not in str(info)
    assert begin(client, token).status_code == 200
    assert begin(client, token).status_code == 200
    assert begin(client, token, "DEV-HOSTED-OTHER").status_code == 409
    payload = summary(token)
    received = client.post("/api/hosted/complete", headers=ORIGIN, json=payload)
    assert received.status_code == 200 and received.json()["accepted"] == 1
    assert set(received.json()) == {"accepted", "duplicate", "trust"}
    assert client.post("/api/hosted/complete", headers=ORIGIN, json=payload).json()["duplicate"]
    assert client.post("/api/hosted/complete", headers=ORIGIN, json={**payload, "edit_count": 4}).status_code == 409
    assert begin(client, token).status_code == 409
    after = client.get(f"/api/org/cases/{case_id}").json()
    assert before["assessment"]["band"] == "Pending" and after["assessment"]["band"] != "Pending"
    assert len(after["evidence"]["sessions"]) == 1
    assert after["evidence"]["sessions"][0]["region"] is None
    assert after["evidence"]["sessions"][0]["failed_attempts"] is None
    assert after["events"][0]["source"] == "hosted_client_reported"
    assert len(after["history"]) == len(before["history"]) + 1
    assert client.get("/api/org/hosted-links").json()["links"][0]["status"] == "Received"


def test_hosted_notice_origins_and_limits_are_enforced(workspace, monkeypatch):
    client, factory = workspace
    register(client)
    case_id = create(client, empty_case())
    link = issue(client, case_id)
    token = link["token"]
    assert client.post("/api/hosted/info", json={"token": token}).status_code == 403
    assert client.post("/api/hosted/info", headers={"Origin": "https://foreign.example"}, json={"token": token}).status_code == 403
    assert client.post("/api/hosted/complete", headers=ORIGIN, json=summary(token)).status_code == 409
    assert client.post("/api/hosted/start", headers=ORIGIN, json={"token": token, "browser_token": "DEV-HOSTED-ONE", "synthetic": True, "notice_acknowledged": False}).status_code == 422
    assert begin(client, token).status_code == 200
    assert client.post("/api/hosted/complete", headers=ORIGIN, json={**summary(token), "form_seconds": 1800}).status_code == 422
    assert client.post("/api/hosted/complete", headers=ORIGIN, json={**summary(token), "typed_value": "never-store-this"}).status_code == 422
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(EvidenceEvent).where(EvidenceEvent.case_id == case_id)) == 0
    monkeypatch.setattr(settings, "allow_hosted_activity", False)
    assert client.post("/api/hosted/info", headers=ORIGIN, json={"token": token}).status_code == 403
    assert client.post("/api/org/hosted-links", json={"case_id": case_id, "synthetic": True}).status_code == 403
    assert client.get("/api/org/hosted-links").json()["enabled"] is False


def test_cross_tenant_revocation_expiry_and_viewer_permissions(workspace):
    client, factory = workspace
    owner_a, account = register(client, "Hosted A")
    case_id = create(client, empty_case())
    link = issue(client, case_id)
    register(client, "Hosted B")
    assert client.get("/api/org/hosted-links").json()["links"] == []
    assert client.delete("/api/org/hosted-links/" + link["id"]).status_code == 404
    assert client.post("/api/org/hosted-links", json={"case_id": case_id, "synthetic": True}).status_code == 404
    login(client, owner_a)
    assert client.delete("/api/org/hosted-links/" + link["id"]).status_code == 200
    assert begin(client, link["token"]).status_code == 401
    expired = issue(client, case_id)
    with factory.begin() as db:
        db.get(HostedAccess, expired["id"]).expires_at = now() - timedelta(seconds=1)
    assert begin(client, expired["token"]).status_code == 401
    assert "Expired" in str(client.get("/api/org/hosted-links").json())
    with factory.begin() as db:
        db.get(Membership, (account["organisationId"], account["accountId"])).role = "viewer"
    assert client.post("/api/org/hosted-links", json={"case_id": case_id, "synthetic": True}).status_code == 403
    assert client.delete("/api/org/hosted-links/" + expired["id"]).status_code == 403
    assert client.get("/api/org/hosted-links").status_code == 200


def test_withdrawal_stops_without_storing_summary(workspace):
    client, factory = workspace
    register(client)
    case_id = create(client, empty_case())
    link = issue(client, case_id)
    assert begin(client, link["token"]).status_code == 200
    stopped = client.post("/api/hosted/cancel", headers=ORIGIN, json={"token": link["token"]})
    assert stopped.status_code == 200 and stopped.json()["summaryReceived"] is False
    assert client.post("/api/hosted/complete", headers=ORIGIN, json=summary(link["token"])).status_code == 401
    assert client.get(f"/api/org/cases/{case_id}").json()["assessment"]["band"] == "Pending"
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(EvidenceEvent).where(EvidenceEvent.case_id == case_id)) == 0


def test_same_browser_links_are_organisation_scoped_and_active_links_bounded(workspace):
    client, _ = workspace
    register(client)
    first = create(client, empty_case("HOSTED-ONE"))
    second = create(client, empty_case("HOSTED-TWO"))
    one, two = issue(client, first), issue(client, second)
    info_a = client.post("/api/hosted/info", headers=ORIGIN, json={"token": one["token"]}).json()
    info_b = client.post("/api/hosted/info", headers=ORIGIN, json={"token": two["token"]}).json()
    assert info_a["storageScope"] == info_b["storageScope"]
    for link in (one, two):
        assert begin(client, link["token"]).status_code == 200
        assert client.post("/api/hosted/complete", headers=ORIGIN, json=summary(link["token"])).status_code == 200
    assessment = client.get(f"/api/org/cases/{first}").json()["assessment"]
    assert any(link["type"] == "device" for link in assessment["links"])
    shared = next(indicator for indicator in assessment["indicators"] if indicator["id"] == "shared-device")
    assert shared["title"] == "Shared browser/device token"
    assert "not verified physical-device identity" in shared["reason"]
    assert "measured hosted activity" in shared["sourceQualification"]
    for _ in range(5): issue(client, first)
    assert client.post("/api/org/hosted-links", json={"case_id": first, "synthetic": True}).status_code == 429
    register(client, "Another hosted tenant")
    other = issue(client, create(client, empty_case()))
    info_c = client.post("/api/hosted/info", headers=ORIGIN, json={"token": other["token"]}).json()
    assert info_c["storageScope"] != info_a["storageScope"]
