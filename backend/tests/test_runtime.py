import json
import re
from backend.tests.test_api import client, test_db
from backend.app.database import get_db
from backend.app import main
from backend.app.config import settings


def test_validation_and_logs_never_echo_submitted_credentials(client, caplog):
    password = "DO-NOT-LEAK"
    response = client.post("/api/org/login", json={"username": "bad user", "password": password})
    assert response.status_code == 422
    assert password not in response.text and "input" not in response.json()["detail"][0]
    assert re.fullmatch("[0-9a-f]{32}", response.headers["x-request-id"])
    assert response.headers["cache-control"] == "no-store"


def test_unexpected_failure_is_generic_and_database_outage_is_unready(client):
    old = main.app.dependency_overrides[get_db]
    def broken():
        raise RuntimeError("private-database-password-must-not-leak")
        yield
    main.app.dependency_overrides[get_db] = broken
    try:
        response = client.get("/api/health")
        assert response.status_code == 503
        assert "private-database-password" not in response.text
        assert re.fullmatch("[0-9a-f]{32}", response.headers["x-request-id"])
    finally:
        main.app.dependency_overrides[get_db] = old


def test_presentation_csp_and_original_route(client, monkeypatch):
    monkeypatch.setattr(settings, "runtime_mode", "presentation")
    response = client.get("/")
    assert response.status_code == 200
    assert "script-src 'self'" in response.headers["content-security-policy"]
    assert client.get("/sandbox").status_code == 200
    assert client.get("/unknown-private-record").status_code == 404
    monkeypatch.setattr(settings, "enable_sandbox", False)
    assert client.get("/sandbox").status_code == 404


def test_offline_reference_matches_schema_without_third_party_assets(client, monkeypatch):
    monkeypatch.setattr(settings, "runtime_mode", "presentation")
    reference = client.get("/docs")
    assert reference.status_code == 200
    assert "/api-reference.js" in reference.text and "/api-reference.css" in reference.text
    assert "cdn" not in reference.text.lower()
    script = client.get("/api-reference.js")
    assert script.status_code == 200 and "/openapi.json" in script.text
    assert client.get("/api-reference.css").status_code == 200
    schema = client.get("/openapi.json").json()
    assert "/api/org/account/password" in schema["paths"]
    assert not any(path.startswith("/api/org/recovery") for path in schema["paths"])


def test_private_log_rotation_keeps_every_file_private(tmp_path):
    from backend.app.runtime import PrivateRotatingFileHandler
    import logging
    target = tmp_path / "requests.jsonl"
    handler = PrivateRotatingFileHandler(target, maxBytes=80, backupCount=2, encoding="utf-8")
    try:
        for number in range(10):
            handler.emit(logging.LogRecord("test", logging.INFO, "", 0, json.dumps({"requestId": str(number), "status": 200}), (), None))
        handler.flush()
        files = list(tmp_path.iterdir())
        assert len(files) == 3
        assert all(path.stat().st_mode & 0o777 == 0o600 for path in files)
    finally:
        handler.close()


def test_serverless_assets_work_without_frontend_source_files(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "ASSETS_SOURCE", tmp_path / "not-bundled")
    for path in ("/identity-lens.js", "/docs", "/api-reference.js", "/api-reference.css"):
        assert client.get(path).status_code == 200
