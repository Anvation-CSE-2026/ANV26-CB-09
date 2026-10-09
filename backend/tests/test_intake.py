from backend.tests.test_api import client, test_db, login


def sample():
    return {"registration_time": "2026-10-08T09:00:00Z", "email_age_days": 3, "region": "North", "verification_region": "South", "birth_year": 1995, "verification_birth_year": 1997, "phone_verified": False, "emulated_device": True, "device_mismatch": True, "device_token": "DEV-CASE-R0", "address_token": "ADDR-CASE-R0", "phone_token": "PHONE-CASE-R0", "session_region": "South", "form_seconds": 20, "edit_count": 0, "failed_attempts": 5, "session_count": 3}


def test_intake_persists_new_case_and_reassesses_linked_population(client):
    login(client)
    before = client.get("/api/bootstrap").json()
    response = client.post("/api/cases", json=sample())
    assert response.status_code == 201
    result = response.json()
    id = result["identity"]["id"]
    assert id.startswith("NEW-")
    assert result["assessment"]["band"] == "High"
    assert any("CASE-003" in l["peers"] for l in result["assessment"]["links"])
    b = client.get("/api/bootstrap").json()
    assert len(b["population"]) == len(before["population"]) + 1
    linked = next(r for r in b["assessments"] if r["id"] == "CASE-003")
    assert any(id in l["peers"] for l in linked["links"])
    report = client.get(f"/api/cases/{id}/report").json()
    assert report["review"]["status"] == "Unreviewed"
    assert report["review"]["history"][0]["action"] == "synthetic_case_created"
    assert client.get("/api/bootstrap").json()["metrics"] == before["metrics"]


def test_intake_rejects_personal_fields_invalid_tokens_and_unprivileged_access(client):
    login(client)
    assert client.post("/api/cases", json={**sample(), "email": "person@example.test"}).status_code == 422
    assert client.post("/api/cases", json={**sample(), "phone_token": "+919999999999"}).status_code == 422
    assert client.post("/api/cases", json={**sample(), "registration_time": "2026-10-08T09:00:00"}).status_code == 422
    login(client, "viewer")
    assert client.post("/api/cases", json=sample()).status_code == 403
