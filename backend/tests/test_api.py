import uuid
import pytest
from sqlalchemy import create_engine, text, select, func
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from backend.app import main, seed
from backend.app.database import Base, get_db, Audit, SessionLocal
from backend.app.config import settings


@pytest.fixture(scope="module")
def test_db():
    # A temporary, isolated schema in real PostgreSQL; never touches analyst records.
    schema = "lens_test_" + uuid.uuid4().hex
    admin = create_engine(settings.database_url)
    with admin.begin() as c:
        c.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(settings.database_url, connect_args={"options": f"-c search_path={schema}"})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    yield engine, factory
    engine.dispose()
    with admin.begin() as c:
        c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


@pytest.fixture
def client(test_db, monkeypatch):
    engine, factory = test_db
    monkeypatch.setattr(seed, "SessionLocal", factory)
    monkeypatch.setattr(main, "engine", engine)
    def session():
        with factory() as db:
            yield db
    main.app.dependency_overrides[get_db] = session
    with TestClient(main.app) as client:
        yield client
    main.app.dependency_overrides.clear()


def login(client, role="analyst"):
    assert client.post("/api/auth/demo", json={"role": role}).status_code == 200


def test_authentication_and_bootstrap(client):
    assert client.get("/api/bootstrap").status_code == 401
    login(client)
    b = client.get("/api/bootstrap").json()
    assert len(b["population"]) == 183
    scores = {r["id"]: r["score"] for r in b["assessments"]}
    assert [scores[k] for k in b["showcases"]] == [0, 32, 100]
    assert "truth" not in b and "labels" not in b
    assert all("truth" not in p for p in b["population"])


def test_sample_entry_has_a_clear_public_api_and_retains_legacy_compatibility(client):
    assert client.post("/api/auth/sample", json={"role": "viewer"}).status_code == 200
    assert client.get("/api/auth/config").json()["mode"] == "sample"
    schema = client.get("/openapi.json").json()
    assert "/api/auth/sample" in schema["paths"]
    assert "/api/auth/demo" not in schema["paths"]
    assert client.post("/api/auth/demo", json={"role": "analyst"}).status_code == 200


def test_saved_review_survives_new_session_and_records_audit(client, test_db):
    login(client)
    r = client.get("/api/cases/CASE-002/review").json()
    saved = client.put("/api/cases/CASE-002/review", json={"status": "Needs evidence", "note": "Verify shared household context.", "revision": r["revision"]})
    assert saved.status_code == 200
    assert saved.json()["notes"][0]["text"] == "Verify shared household context."
    client.post("/api/auth/logout")
    assert client.get("/api/cases/CASE-002/review").status_code == 401
    login(client)
    assert client.get("/api/cases/CASE-002/review").json()["status"] == "Needs evidence"
    with test_db[1]() as db:
        assert db.scalar(select(func.count()).select_from(Audit)) >= 1


def test_concurrent_review_conflict_and_viewer_permissions(client):
    login(client)
    r = client.get("/api/cases/CASE-001/review").json()
    data = {"status": "In review", "note": "", "revision": r["revision"]}
    assert client.put("/api/cases/CASE-001/review", json=data).status_code == 200
    assert client.put("/api/cases/CASE-001/review", json=data).status_code == 409
    login(client, "viewer")
    assert client.put("/api/cases/CASE-001/review", json=data).status_code == 403
    assert client.get("/api/cases/CASE-001/report").status_code == 200
    assert client.post("/api/cases/CASE-001/reassess").status_code == 403


def test_sensitivity_never_changes_stored_assessment(client):
    login(client)
    r = client.get("/api/cases/CASE-003/report").json()["assessment"]
    ids = [i["id"] for i in r["indicators"]]
    assert client.post("/api/cases/CASE-003/sensitivity", json={"excluded": ids}).json()["score"] == 0
    assert client.get("/api/cases/CASE-003/report").json()["assessment"]["score"] == 100
    assert client.post("/api/cases/CASE-003/sensitivity", json={"excluded": ["invented"]}).status_code == 422
    assert client.post("/api/cases/UNKNOWN/sensitivity", json={"excluded": []}).status_code == 404


def test_validation_and_cross_origin_write_rejection(client):
    login(client)
    assert client.put("/api/cases/CASE-001/review", json={"status": "Denied", "revision": 0}).status_code == 422
    assert client.post("/api/auth/demo", json={"role": "admin"}).status_code == 422
    assert client.post("/api/auth/demo", json={}, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert client.post("/api/auth/demo", json={}, headers={"Origin": "http://localhost:4173", "Sec-Fetch-Site": "cross-site"}).status_code == 200
    assert client.post("/api/auth/demo", json={}, headers={"Host": "public.example"}).status_code == 403
