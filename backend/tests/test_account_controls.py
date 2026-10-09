from datetime import timedelta
from uuid import uuid4
from sqlalchemy import select
from backend.tests.test_organisations import client, test_db, workspace, register, login, PASSWORD
from backend.app.database import WorkspaceSession, Account, now
from backend.app.auth import digest


def add_session(factory, account_id, org_id, expired=False):
    token = "test-session-" + uuid4().hex
    with factory.begin() as db:
        db.add(WorkspaceSession(token_hash=digest(token), account_id=account_id, organisation_id=org_id, expires_at=now() + timedelta(hours=-1 if expired else 1)))
    return token


def test_only_own_active_sessions_are_visible_and_tokens_are_not_exposed(workspace):
    client, factory = workspace
    username, owner = register(client)
    token = add_session(factory, owner["accountId"], owner["organisationId"])
    add_session(factory, owner["accountId"], owner["organisationId"], expired=True)
    register(client, "Other organisation")
    login(client, username)
    response = client.get("/api/org/account/sessions")
    assert response.status_code == 200 and len(response.json()) == 2
    assert sum(row["current"] for row in response.json()) == 1
    assert token not in response.text and digest(token) not in response.text
    assert all(row["organisation"] == "Organisation" for row in response.json())


def test_revocation_keeps_current_session_and_is_scoped(workspace):
    client, factory = workspace
    username, owner = register(client)
    own_token = client.cookies.get("lens_workspace")
    other = add_session(factory, owner["accountId"], owner["organisationId"])
    response = client.post("/api/org/account/sessions/revoke-others")
    assert response.status_code == 200 and response.json()["revoked"] == 1
    assert client.get("/api/org/me").status_code == 200
    with factory() as db:
        assert db.get(WorkspaceSession, digest(other)) is None
        assert db.get(WorkspaceSession, digest(own_token))
    current = client.get("/api/org/account/sessions").json()[0]
    register(client, "Separate owner")
    assert client.delete("/api/org/account/sessions/" + current["id"]).status_code == 404
    login(client, username)
    identifier = client.get("/api/org/account/sessions").json()[0]["id"]
    assert client.delete("/api/org/account/sessions/" + identifier).json()["signedOut"]
    assert client.get("/api/org/me").status_code == 401


def test_password_change_validates_current_password_revokes_all_and_preserves_data(workspace):
    client, factory = workspace
    username, owner = register(client)
    add_session(factory, owner["accountId"], owner["organisationId"])
    body = {"current_password": "incorrect-password-2026", "new_password": "Changed-test-password-2026"}
    assert client.post("/api/org/account/password", json=body).status_code == 401
    assert client.post("/api/org/account/password", json={"current_password": PASSWORD, "new_password": PASSWORD}).status_code == 422
    assert client.post("/api/org/account/password", json={"current_password": PASSWORD, "new_password": "short"}).status_code == 422
    result = client.post("/api/org/account/password", json={**body, "current_password": PASSWORD})
    assert result.status_code == 200
    assert client.get("/api/org/me").status_code == 401
    with factory() as db:
        assert not db.scalars(select(WorkspaceSession).where(WorkspaceSession.account_id == owner["accountId"])).all()
        assert db.get(Account, owner["accountId"]).password_hash.startswith("scrypt$")
    assert client.post("/api/org/login", json={"username": username, "password": PASSWORD}).status_code == 401
    assert client.post("/api/org/login", json={"username": username, "password": body["new_password"]}).status_code == 200
    assert client.get("/api/org/cases").json() == []


def test_email_features_are_not_exposed(workspace):
    client, _ = workspace
    register(client)
    for path in ("config", "email", "request", "verify", "reset"):
        assert client.get("/api/org/recovery/" + path).status_code == 404
    assert all("/api/org/recovery/" not in name for name in client.get("/openapi.json").json()["paths"])
