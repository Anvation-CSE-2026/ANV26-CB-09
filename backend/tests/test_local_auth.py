from datetime import timedelta
from sqlalchemy import select
from backend.tests.test_api import client, test_db, login
from backend.app.database import AuthSession, now
from backend.app.auth import digest
from backend.app.config import settings


def test_expired_session_cannot_access_evidence(client, test_db):
    login(client)
    token = client.cookies.get("lens_session")
    with test_db[1].begin() as db:
        db.get(AuthSession, digest(token)).expires_at = now() - timedelta(seconds=1)
    assert client.get("/api/bootstrap").status_code == 401


def test_unknown_session_cannot_access_evidence(client):
    client.cookies.set("lens_session", "unknown-session", domain="testserver.local", path="/api")
    assert client.get("/api/auth/me").status_code == 401


def test_login_rotates_session_and_stores_only_hash(client, test_db):
    login(client)
    old_token = client.cookies.get("lens_session")
    response = client.post("/api/auth/demo", json={"role": "viewer"})
    new_token = client.cookies.get("lens_session")
    assert old_token != new_token
    with test_db[1]() as db:
        assert db.get(AuthSession, digest(old_token)) is None
        assert db.get(AuthSession, digest(new_token)).role == "viewer"
        assert new_token not in list(db.scalars(select(AuthSession.token_hash)))
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie


def test_logout_revokes_server_session(client, test_db):
    login(client)
    token = client.cookies.get("lens_session")
    assert client.post("/api/auth/logout").status_code == 204
    with test_db[1]() as db:
        assert db.get(AuthSession, digest(token)) is None
    assert client.get("/api/bootstrap").status_code == 401


def test_remote_clients_cannot_create_demo_sessions(test_db, monkeypatch):
    from fastapi import HTTPException, Response
    from starlette.requests import Request
    from backend.app.auth import demo_login
    import pytest
    request = Request({"type": "http", "headers": [], "client": ("192.0.2.1", 1234)})
    with test_db[1]() as db:
        with pytest.raises(HTTPException) as error:
            demo_login(request, Response(), db)
    assert error.value.status_code == 403


def test_public_sample_sessions_are_always_read_only(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_public_samples", True)
    monkeypatch.setattr(settings, "secure_cookies", True)
    response = client.post("/api/auth/sample", json={"role": "analyst"})
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    assert "secure" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/config").json()["publicSampleReadOnly"] is True
    # Secure cookies are not transmitted by an HTTP test client; send the issued
    # test-only token explicitly to test the server's write boundary.
    token = response.cookies.get("lens_session")
    response = client.put("/api/cases/CASE-002/review",
                          headers={"Cookie": "lens_session=" + token},
                          json={"status": "Needs evidence", "note": "Not permitted", "revision": 0})
    assert response.status_code == 403


def test_standard_cloud_database_urls_select_the_installed_driver():
    from backend.app.config import Settings
    for url in ("postgres://user:secret@host/db", "postgresql://user:secret@host/db"):
        config = Settings(_env_file=None, database_url=url)
        assert config.database_url == "postgresql+psycopg://user:secret@host/db"
    explicit = "postgresql+psycopg://user:secret@host/db?sslmode=require"
    assert Settings(_env_file=None, database_url=explicit).database_url == explicit
