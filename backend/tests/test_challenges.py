"""Independent small edge cases, not a claim of out-of-sample fraud accuracy."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from backend.app.database import WorkspaceCase
from backend.app.evidence import EvidenceInput, calculate


def case(external_id, offset=0, shared=False, sparse=False):
    registered = datetime(2026, 10, 1, 9, tzinfo=timezone.utc) + timedelta(days=offset)
    data = EvidenceInput(synthetic=True, external_id=external_id, registered_at=registered,
        declared_region=None if sparse else "North",
        email_created_at=None if sparse else registered - timedelta(days=365),
        phone_verified=None if sparse else True,
        phone_token="PHONE-HOUSEHOLD" if shared else "PHONE-" + external_id,
        address_token="ADDR-HOUSEHOLD" if shared else "ADDR-" + external_id,
        emulated_device=None if sparse else False, device_mismatch=None if sparse else False,
        profile_records=[] if sparse else [{"source": "Registration", "birth_year": 1990, "region": "North"}, {"source": "Independent fictional record", "birth_year": 1990, "region": "North"}],
        sessions=[{"event_id": "OBS-" + external_id, "timestamp": registered + timedelta(minutes=3), "device_token": "DEV-HOUSEHOLD" if shared else "DEV-" + external_id,
                   "region": None if sparse else "North", "form_seconds": None if sparse else 190, "edit_count": None if sparse else 4}])
    return WorkspaceCase(id=str(uuid4()), organisation_id="TEST", external_id=external_id, evidence_revision=1, payload=data.model_dump(mode="json"))


def test_shared_household_does_not_turn_into_a_ring_on_sharing_alone():
    rows = [case("HOUSE-A", shared=True), case("HOUSE-B", offset=7, shared=True)]
    results = [calculate(row, rows) for row in rows]
    for result in results:
        assert result["band"] == "Low"
        assert not any(i["id"] == "registration-burst" for i in result["indicators"])
        assert result["links"]


def test_sparse_history_is_not_reported_as_confident_authenticity():
    row = case("SPARSE", sparse=True)
    result = calculate(row, [row])
    assert result["coverage"]["status"] == "Incomplete" and not result["coverage"]["isConfidence"]
    assert "Evidence is incomplete" in result["explanation"]
    assert not any(i["id"] in ("unverified-phone", "new-email", "failed-attempts", "behaviour-anomaly") for i in result["indicators"])
    # A synthetically-labelled fraudster with no distinguishing evidence may still score Low.
    # That limitation must be disclosed, not "fixed" by secretly supplying the label.
    assert result["band"] == "Low"


def test_rotating_client_token_cannot_be_claimed_as_durable_device_identity():
    a, b = case("ROTATION-A"), case("ROTATION-B", offset=1)
    result = calculate(a, [a, b])
    assert result["links"] == []
    assert not any(i["id"] == "shared-device" for i in result["indicators"])
