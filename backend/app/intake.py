from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import text,select,func
from fastapi import HTTPException
from .database import Identity, Observation, EntityLink, Review, Assessment, Audit
from .seed import observations
from .engine import assess, fit_baseline, VERSION

Region = Literal["North", "South", "East", "West"]


class SyntheticCaseInput(BaseModel):
    # A token-only synthetic builder; no name, email, document or actual phone fields.
    registration_time: datetime
    email_age_days: int = Field(ge=0, le=3000)
    region: Region
    verification_region: Region
    birth_year: int = Field(ge=1900, le=2020)
    verification_birth_year: int = Field(ge=1900, le=2020)
    phone_verified: bool
    emulated_device: bool
    device_mismatch: bool
    device_token: str = Field(pattern=r"^DEV-[A-Z0-9-]{1,80}$")
    address_token: str = Field(pattern=r"^ADDR-[A-Z0-9-]{1,80}$")
    phone_token: str = Field(pattern=r"^PHONE-[A-Z0-9-]{1,80}$")
    session_region: Region
    form_seconds: float = Field(ge=1, le=1800)
    edit_count: int = Field(ge=0, le=200)
    failed_attempts: int = Field(ge=0, le=100)
    session_count: int = Field(ge=1, le=20)
    model_config = ConfigDict(extra="forbid")

    @field_validator("registration_time")
    @classmethod
    def require_timezone(cls, value):
        if value.tzinfo is None:
            raise ValueError("Registration time must include a timezone.")
        return value.astimezone(timezone.utc)


def create_synthetic_case(db: Session, data: SyntheticCaseInput, actor: str):
    db.execute(text("SELECT pg_advisory_xact_lock(2404)"))
    if db.scalar(select(func.count()).select_from(Identity).where(Identity.cohort == "observed")) >= 1000:
        raise HTTPException(409, "This synthetic workspace has reached its 1,000-case limit.")
    id = "NEW-" + uuid4().hex[:10].upper()
    created = data.registration_time
    p = {"id": id, "displayName": "Synthetic applicant " + id[4:10], "declaredRegion": data.region,
         "createdAt": created.isoformat(), "emailCreatedAt": (created - timedelta(days=data.email_age_days)).isoformat(),
         "phoneVerified": data.phone_verified, "emulatedDevice": data.emulated_device,
         "deviceIntegrityMismatch": data.device_mismatch, "addressToken": data.address_token, "phoneToken": data.phone_token,
         "deviceAttributes": {"reportedPlatform": "Synthetic Desktop", "browserPlatform": "Synthetic Mobile" if data.device_mismatch else "Synthetic Desktop", "environment": "Emulated" if data.emulated_device else "Standard"},
         "profileRecords": [{"source": "Registration record", "birthYear": data.birth_year, "declaredRegion": data.region}, {"source": "Verification record", "birthYear": data.verification_birth_year, "declaredRegion": data.verification_region}],
         "events": [{"id": f"EVT-{id}-{i+1}", "timestamp": (created + timedelta(seconds=(i+1)*30)).isoformat(), "deviceId": data.device_token,
                     "ipToken": "IP-" + id, "region": data.session_region, "formSeconds": data.form_seconds,
                     "editCount": data.edit_count, "failedAttempts": data.failed_attempts} for i in range(data.session_count)]}
    db.add(Identity(id=id, cohort="observed", payload=p))
    db.flush()
    db.add(Review(identity_id=id))
    for e in p["events"]:
        db.add(Observation(id=e["id"], identity_id=id, device_token=e["deviceId"], timestamp=e["timestamp"], payload=e))
    for kind, token in [("device", data.device_token), ("phone", data.phone_token), ("address", data.address_token)]:
        db.add(EntityLink(identity_id=id, kind=kind, token=token))
    db.flush()
    population = observations(db)
    baseline = fit_baseline(observations(db, "reference"))
    result = None
    snapshots = []
    # Adding shared evidence can affect existing cases, so persist a fresh complete population assessment.
    for subject in population:
        assessment = assess(subject, population, baseline)
        snapshot = Assessment(identity_id=subject["id"], version=VERSION, payload=assessment)
        snapshots.append(snapshot)
        db.add(snapshot)
        if subject["id"] == id:
            result = assessment
    db.flush()
    db.add(Audit(identity_id=id, actor=actor, action="synthetic_case_created", details={"version": VERSION, "score": result["score"], "populationReassessed": len(population), "assessmentIds": [s.id for s in snapshots]}))
    db.commit()
    return {"identity": p, "assessment": result}
