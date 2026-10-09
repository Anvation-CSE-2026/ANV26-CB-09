"""Validated evidence, import previews, revisions and organisation-scoped scoring."""
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .database import get_db, WorkspaceCase, WorkspaceAssessment, WorkspaceAudit, EvidenceEvent, ImportBatch, Membership, now
from .engine import assess, fit_baseline, GROUPS, VERSION, PopulationIndex
from .seed import DATA
from .workspaces import principal, writer, uid, audit, scoped_case, workspace_lock

router = APIRouter(prefix="/api/org", tags=["Evidence and assessments"])
POLICY = VERSION + "-workspace.1"
REFERENCE_VERSION = "synthetic-reference-240-v1"
BASELINE = fit_baseline(DATA["references"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProfileRecord(StrictModel):
    source: str = Field(min_length=2, max_length=80)
    birth_year: int | None = Field(default=None, ge=1900, le=2026)
    region: Literal["North", "South", "East", "West"] | None = None


class SessionRecord(StrictModel):
    event_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")
    timestamp: datetime
    device_token: str = Field(pattern=r"^DEV-[A-Z0-9-]{1,80}$")
    region: Literal["North", "South", "East", "West"] | None = None
    form_seconds: float | None = Field(default=None, ge=0, le=1800)
    edit_count: int | None = Field(default=None, ge=0, le=200)
    failed_attempts: int | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def validate_time(self):
        if self.timestamp.tzinfo is None:
            raise ValueError("Event timestamps require a timezone.")
        self.timestamp = self.timestamp.astimezone(timezone.utc)
        return self


class EvidenceInput(StrictModel):
    synthetic: Literal[True]
    external_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")
    registered_at: datetime
    declared_region: Literal["North", "South", "East", "West"] | None = None
    email_created_at: datetime | None = None
    phone_verified: bool | None = None
    phone_token: str | None = Field(default=None, pattern=r"^PHONE-[A-Z0-9-]{1,80}$")
    address_token: str | None = Field(default=None, pattern=r"^ADDR-[A-Z0-9-]{1,80}$")
    emulated_device: bool | None = None
    device_mismatch: bool | None = None
    profile_records: list[ProfileRecord] = Field(default_factory=list, max_length=10)
    sessions: list[SessionRecord] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_temporal_integrity(self):
        for value in [self.registered_at, self.email_created_at] + [s.timestamp for s in self.sessions]:
            if value is not None and value.tzinfo is None:
                raise ValueError("All timestamps require a timezone.")
        if self.email_created_at and self.email_created_at > self.registered_at:
            raise ValueError("Email creation cannot follow registration.")
        if any(s.timestamp < self.registered_at for s in self.sessions):
            raise ValueError("Sessions cannot precede registration.")
        ids = [s.event_id for s in self.sessions]
        if len(ids) != len(set(ids)):
            raise ValueError("Session event IDs must be unique within a case.")
        self.registered_at = self.registered_at.astimezone(timezone.utc)
        if self.email_created_at:
            self.email_created_at = self.email_created_at.astimezone(timezone.utc)
        return self


def normalise(row):
    p = row.payload
    return {"id": row.id, "displayName": "Applicant " + row.external_id, "declaredRegion": p.get("declared_region"),
            "createdAt": p["registered_at"], "emailCreatedAt": p.get("email_created_at"),
            "phoneVerified": p.get("phone_verified"), "phoneToken": p.get("phone_token"), "addressToken": p.get("address_token"),
            "emulatedDevice": p.get("emulated_device"), "deviceIntegrityMismatch": p.get("device_mismatch"),
            "profileRecords": [{"source": r["source"], "birthYear": r.get("birth_year"), "declaredRegion": r.get("region")} for r in p["profile_records"]],
            "deviceAttributes": {"reportedPlatform": "Supplied telemetry", "browserPlatform": "See source records", "environment": "Unknown" if p.get("emulated_device") is None else "Emulated" if p["emulated_device"] else "Standard"},
            "events": [{"id": e["event_id"], "timestamp": e["timestamp"], "deviceId": e["device_token"], "region": e.get("region"),
                        "formSeconds": e.get("form_seconds"), "editCount": e.get("edit_count"), "failedAttempts": e.get("failed_attempts"), "ipToken": "Not collected"}
                       for e in sorted(p["sessions"], key=lambda e: e["timestamp"])]}


def coverage(payload):
    checks = {"Profile comparison": any(sum(r.get(k) is not None for r in payload["profile_records"]) >= 2 for k in ("birth_year", "region")),
              "Email history": payload.get("email_created_at") is not None,
              "Phone verification": payload.get("phone_verified") is not None,
              "Device telemetry": payload.get("emulated_device") is not None and payload.get("device_mismatch") is not None,
              "Session region": payload.get("declared_region") is not None and any(e.get("region") for e in payload["sessions"]),
              "Form behaviour": any(e.get("form_seconds") is not None and e.get("edit_count") is not None for e in payload["sessions"]),
              "Relationship tokens": payload.get("phone_token") is not None and payload.get("address_token") is not None}
    percent = round(100 * sum(checks.values()) / len(checks))
    return {"percent": percent, "available": [k for k, v in checks.items() if v], "missing": [k for k, v in checks.items() if not v],
            "status": "Sufficient" if percent >= 80 else "Incomplete", "isConfidence": False}


def calculate(row, population, excluded=(), prepared=None):
    payload = normalise(row)
    quality = coverage(row.payload)
    if not payload["events"]:
        result = {"id": row.id, "score": None, "band": "Pending", "groups": [{**g, "raw": 0, "score": 0} for g in GROUPS],
                  "indicators": [], "mitigations": [], "links": [], "summary": {}, "explanation": "Waiting for sourced session evidence. No risk verdict has been assigned.",
                  "excluded": [], "anomaly": {"referenceN": BASELINE["n"]}}
    else:
        normalised, index = prepared if prepared else ([normalise(r) for r in population], None)
        result = assess(payload, normalised, BASELINE, excluded, index)
        if quality["status"] == "Incomplete":
            result["explanation"] = "The available evidence produces a " + result["band"].lower() + " policy score. Evidence is incomplete: " + ", ".join(quality["missing"]) + ". Request the missing evidence before concluding authenticity."
    def event_source(event):
        return {"record": event["event_id"], "caseId": row.id, "timestamp": event["timestamp"]}
    for indicator in result["indicators"]:
        indicator_id = indicator["id"]
        indicator["sourceRecords"] = [event_source(e) for e in row.payload["sessions"]]
        if indicator_id == "new-email":
            indicator["sourceRecords"] = [{"record": "email_created_at", "timestamp": row.payload["email_created_at"]}]
        elif indicator_id == "unverified-phone":
            indicator["sourceRecords"] = [{"record": "phone_verified", "value": row.payload["phone_verified"]}]
        elif indicator_id == "profile-conflicts":
            indicator["sourceRecords"] = [{"record": r["source"], "birthYear": r.get("birth_year"), "region": r.get("region")} for r in row.payload["profile_records"]]
        elif indicator_id in ("emulator", "device-integrity"):
            field = "emulated_device" if indicator_id == "emulator" else "device_mismatch"
            indicator["sourceRecords"] = [{"record": field, "value": row.payload[field]}]
        elif indicator_id == "shared-device":
            indicator["title"] = "Shared browser/device token"
            indicator["observed"] = indicator["observed"].replace("identities share a device", "applicant records share a browser/device token")
            indicator["reason"] = "An exact browser/device token occurs on multiple applicant records. This is identifier reuse, not verified physical-device identity."
            indicator["context"] = "Households, shared browsers and resettable or spoofed tokens require context. Sharing alone does not prove fraud."
            result["explanation"] = result["explanation"].replace("device used by multiple identities", "shared browser/device token")
            devices = {e["device_token"] for e in row.payload["sessions"]}
            indicator["sourceRecords"] = [{"record": e["event_id"], "caseId": peer.id, "timestamp": e["timestamp"], "deviceToken": e["device_token"]} for peer in population for e in peer.payload["sessions"] if e["device_token"] in devices]
        elif indicator_id == "failed-attempts":
            indicator["sourceRecords"] = [event_source(e) for e in row.payload["sessions"] if (e.get("failed_attempts") or 0) > 0]
        elif indicator_id == "region-mismatch":
            indicator["sourceRecords"] = [event_source(e) for e in row.payload["sessions"] if e.get("region") and e["region"] != row.payload.get("declared_region")]
        elif indicator_id in ("shared-phone", "shared-address"):
            field = "phone_token" if indicator_id == "shared-phone" else "address_token"
            indicator["sourceRecords"] = [{"caseId": peer.id, "record": field, "value": peer.payload[field]} for peer in population if peer.payload.get(field) == row.payload.get(field)]
        elif indicator_id == "registration-burst":
            devices = {e["device_token"] for e in row.payload["sessions"]}
            candidates = sorted([peer for peer in population if any(e["device_token"] in devices for e in peer.payload["sessions"])], key=lambda peer: datetime.fromisoformat(peer.payload["registered_at"]))
            window, left = [], 0
            for right in range(len(candidates)):
                while datetime.fromisoformat(candidates[right].payload["registered_at"]) - datetime.fromisoformat(candidates[left].payload["registered_at"]) > timedelta(minutes=30):
                    left += 1
                if right - left + 1 > len(window):
                    window = candidates[left:right + 1]
            indicator["sourceRecords"] = [{"caseId": peer.id, "record": "registered_at", "timestamp": peer.payload["registered_at"]} for peer in window]
        indicator["sourceQualification"] = "Fictional applicant identities. Observations may be supplied records or measured hosted activity; event provenance identifies their source. Client reports and supplied verification flags are not independently verified."
    return {**result, "version": POLICY, "referenceVersion": REFERENCE_VERSION, "evidenceRevision": row.evidence_revision,
            "coverage": quality, "advisoryOnly": True, "scoreIsProbability": False}


def population(db, org_id):
    return list(db.scalars(select(WorkspaceCase).where(WorkspaceCase.organisation_id == org_id).order_by(WorkspaceCase.created_at)))


def latest_assessments(db, org_id):
    ids = select(func.max(WorkspaceAssessment.id)).where(WorkspaceAssessment.organisation_id == org_id).group_by(WorkspaceAssessment.case_id)
    return {r.case_id: r for r in db.scalars(select(WorkspaceAssessment).where(WorkspaceAssessment.organisation_id == org_id, WorkspaceAssessment.id.in_(ids)))}


def reassess_population(db, org_id):
    rows = population(db, org_id)
    latest = latest_assessments(db, org_id)
    normalised = [normalise(row) for row in rows]
    prepared = (normalised, PopulationIndex(normalised))
    for row in rows:
        result = calculate(row, rows, prepared=prepared)
        previous = latest.get(row.id)
        # New links/evidence versions remain observable; unrelated ingestion must
        # not multiply every applicant's unchanged history.
        if previous is None or previous.policy_version != POLICY or previous.payload != result:
            db.add(WorkspaceAssessment(organisation_id=org_id, case_id=row.id, policy_version=POLICY, evidence_revision=row.evidence_revision, payload=result))


def persist_case(db, org_id, data, actor, source, batch_id=None):
    if db.scalar(select(WorkspaceCase).where(WorkspaceCase.organisation_id == org_id, WorkspaceCase.external_id == data.external_id)):
        raise HTTPException(409, "An applicant with this external ID already exists. Correct its evidence instead of creating a duplicate.")
    row = WorkspaceCase(id=uid(), organisation_id=org_id, external_id=data.external_id, payload=data.model_dump(mode="json"))
    db.add(row)
    db.flush()
    for event in data.sessions:
        event_data = event.model_dump(mode="json")
        db.add(EvidenceEvent(id=uid(), organisation_id=org_id, case_id=row.id, external_id=row.id + ":" + event.event_id,
                             source=source, payload={**event_data, "importBatchId": batch_id}))
    audit(db, org_id, actor, "case_created", {"externalId": row.external_id, "source": source, "importBatchId": batch_id}, row.id)
    return row


@router.get("/cases")
def cases(db: Session = Depends(get_db), current=Depends(principal)):
    rows = population(db, current["organisationId"])
    latest = latest_assessments(db, current["organisationId"])
    return [{"id": row.id, "externalId": row.external_id, "revision": row.revision, "status": row.review_status, "assignedTo": row.assigned_to,
             "createdAt": row.created_at, "assessment": latest[row.id].payload if row.id in latest else calculate(row, rows)} for row in rows]


@router.post("/cases", status_code=201)
def create_case(data: EvidenceInput, db: Session = Depends(get_db), current=Depends(writer)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    if db.scalar(select(func.count()).select_from(WorkspaceCase).where(WorkspaceCase.organisation_id == org_id)) >= 1000:
        raise HTTPException(409, "The current local workspace supports 1,000 applicants.")
    row = persist_case(db, org_id, data, current["id"], "analyst")
    reassess_population(db, org_id)
    db.commit()
    return {"id": row.id}


@router.get("/cases/{case_id}")
def case_detail(case_id: str, db: Session = Depends(get_db), current=Depends(principal)):
    org_id = current["organisationId"]
    row = scoped_case(db, org_id, case_id)
    history = list(db.scalars(select(WorkspaceAssessment).where(WorkspaceAssessment.organisation_id == org_id, WorkspaceAssessment.case_id == case_id).order_by(WorkspaceAssessment.id.desc()).limit(20)))
    events = list(db.scalars(select(EvidenceEvent).where(EvidenceEvent.organisation_id == org_id, EvidenceEvent.case_id == case_id).order_by(EvidenceEvent.received_at)))
    notes = list(db.scalars(select(WorkspaceAudit).where(WorkspaceAudit.organisation_id == org_id, WorkspaceAudit.case_id == case_id).order_by(WorkspaceAudit.id.desc()).limit(100)))
    return {"id": row.id, "externalId": row.external_id, "revision": row.revision, "evidenceRevision": row.evidence_revision, "status": row.review_status, "assignedTo": row.assigned_to,
            "evidence": row.payload, "identity": normalise(row), "assessment": history[0].payload if history else calculate(row, population(db, org_id)),
            "history": [{"id": r.id, "score": r.payload["score"], "band": r.payload["band"], "evidenceRevision": r.evidence_revision, "policyVersion": r.policy_version, "timestamp": r.created_at} for r in history],
            "events": [{"id": r.external_id, "source": r.source, "receivedAt": r.received_at, "payload": r.payload} for r in events],
            "audit": [{"id": r.id, "actor": r.actor, "action": r.action, "details": r.details, "timestamp": r.created_at} for r in notes]}


class Correction(StrictModel):
    revision: int = Field(ge=1)
    reason: str = Field(min_length=5, max_length=1000)
    evidence: EvidenceInput


@router.put("/cases/{case_id}/evidence")
def correct(case_id: str, data: Correction, db: Session = Depends(get_db), current=Depends(writer)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    row = scoped_case(db, org_id, case_id)
    if row.revision != data.revision:
        raise HTTPException(409, "The evidence changed. Reload this case before correcting it.")
    if row.external_id != data.evidence.external_id:
        raise HTTPException(422, "A correction cannot change the applicant's external ID.")
    previous = row.payload
    row.payload = data.evidence.model_dump(mode="json")
    row.revision += 1
    row.evidence_revision += 1
    audit(db, org_id, current["id"], "evidence_corrected", {"reason": data.reason, "previous": previous, "revision": row.revision}, row.id)
    db.add(EvidenceEvent(id=uid(), organisation_id=org_id, case_id=row.id, external_id="CORRECTION:" + uid(), source="analyst_correction", payload={"reason": data.reason, "revision": row.revision, "evidence": row.payload}))
    reassess_population(db, org_id)
    db.commit()
    return {"saved": True, "revision": row.revision}


class ReviewUpdate(StrictModel):
    revision: int = Field(ge=1)
    status: Literal["Unreviewed", "In review", "Needs evidence", "Review complete"]
    note: str = Field(default="", max_length=4000)
    assigned_to: str | None = None


@router.put("/cases/{case_id}/review")
def review(case_id: str, data: ReviewUpdate, db: Session = Depends(get_db), current=Depends(writer)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    row = scoped_case(db, org_id, case_id)
    if row.revision != data.revision:
        raise HTTPException(409, "The case changed. Reload before saving your review.")
    if data.assigned_to:
        member = db.get(Membership, (org_id, data.assigned_to))
        if not member or not member.active or member.role not in ("admin", "analyst"):
            raise HTTPException(422, "Assign this case to an active analyst in your organisation.")
    row.review_status, row.assigned_to = data.status, data.assigned_to
    row.revision += 1
    audit(db, org_id, current["id"], "review_saved", {"status": data.status, "note": data.note.strip(), "assignedTo": data.assigned_to, "revision": row.revision}, row.id)
    db.commit()
    return {"saved": True, "revision": row.revision}


class Sensitivity(StrictModel):
    excluded: list[str] = Field(default_factory=list, max_length=12)


@router.post("/cases/{case_id}/sensitivity")
def sensitivity(case_id: str, data: Sensitivity, db: Session = Depends(get_db), current=Depends(principal)):
    row = scoped_case(db, current["organisationId"], case_id)
    rows = population(db, current["organisationId"])
    original = calculate(row, rows)
    if set(data.excluded) - {i["id"] for i in original["indicators"]}:
        raise HTTPException(422, "An omitted indicator is not present in this assessment.")
    return calculate(row, rows, data.excluded)


@router.get("/cases/{case_id}/report")
def report(case_id: str, db: Session = Depends(get_db), current=Depends(principal)):
    return {"syntheticOnly": True, "advisoryOnly": True, "exportedAt": now(), "organisation": current["organisationName"],
            "case": case_detail(case_id, db, current), "referenceVersion": REFERENCE_VERSION, "scoreIsProbability": False}


class ImportRequest(StrictModel):
    format: Literal["json", "csv"]
    content: str = Field(min_length=1, max_length=1500000)
    filename: str = Field(default="dataset", min_length=1, max_length=100)


def parse_import(data):
    if data.format == "json":
        try:
            rows = json.loads(data.content)
        except json.JSONDecodeError:
            raise HTTPException(422, "The file is not valid JSON.")
    else:
        rows = []
        for row in csv.DictReader(io.StringIO(data.content)):
            clean = {k: v for k, v in row.items() if v not in (None, "")}
            for key in ("synthetic", "phone_verified", "emulated_device", "device_mismatch"):
                if key in clean:
                    if clean[key].lower() not in ("true", "false"):
                        raise HTTPException(422, "CSV boolean fields must contain true or false.")
                    clean[key] = clean[key].lower() == "true"
            for key in ("profile_records", "sessions"):
                if key in clean:
                    try:
                        clean[key] = json.loads(clean[key])
                    except json.JSONDecodeError:
                        raise HTTPException(422, "CSV sessions and profile_records cells must contain JSON arrays.")
            rows.append(clean)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise HTTPException(422, "Import a JSON array or CSV containing 1–100 applicants per batch.")
    return rows


def preview_import(db, org_id, data):
    rows = parse_import(data)
    existing = set(db.scalars(select(WorkspaceCase.external_id).where(WorkspaceCase.organisation_id == org_id)))
    seen, accepted, errors = set(), [], []
    for index, raw in enumerate(rows):
        try:
            item = EvidenceInput.model_validate(raw)
            if item.external_id in existing or item.external_id in seen:
                errors.append({"row": index + 1, "message": "Duplicate external ID: " + item.external_id})
            else:
                seen.add(item.external_id)
                accepted.append(item)
        except ValidationError as error:
            errors.append({"row": index + 1, "message": "; ".join(".".join(str(v) for v in e["loc"]) + ": " + e["msg"] for e in error.errors())})
    if len(existing) + len(accepted) > 1000:
        errors.append({"row": 0, "message": "This import exceeds the 1,000-applicant workspace limit."})
    return accepted, errors


@router.post("/imports/preview")
def preview(data: ImportRequest, db: Session = Depends(get_db), current=Depends(writer)):
    accepted, errors = preview_import(db, current["organisationId"], data)
    return {"valid": not errors, "acceptedCount": len(accepted), "errors": errors,
            "preview": [{"externalId": r.external_id, "sessions": len(r.sessions), "coverage": coverage(r.model_dump(mode="json"))} for r in accepted]}


@router.post("/imports", status_code=201)
def commit_import(data: ImportRequest, db: Session = Depends(get_db), current=Depends(writer)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    accepted, errors = preview_import(db, org_id, data)
    if errors:
        raise HTTPException(422, {"message": "No records imported. Fix the errors and preview again.", "errors": errors})
    batch = ImportBatch(id=uid(), organisation_id=org_id, actor=current["id"], filename=data.filename, imported_count=len(accepted))
    db.add(batch)
    for item in accepted:
        persist_case(db, org_id, item, current["id"], "dataset_import", batch.id)
    reassess_population(db, org_id)
    audit(db, org_id, current["id"], "import_completed", {"batchId": batch.id, "count": len(accepted)})
    db.commit()
    return {"id": batch.id, "importedCount": len(accepted)}


@router.get("/sample-dataset")
def sample_dataset(current=Depends(principal)):
    ids = {"CASE-001", "CASE-002", "CASE-003"}
    rows = [p for p in DATA["world"]["population"] if p["id"] in ids or p["phoneToken"] in {DATA["world"]["population"][1]["phoneToken"], DATA["world"]["population"][2]["phoneToken"]}]
    return [{"synthetic": True, "external_id": p["id"], "registered_at": p["createdAt"], "declared_region": p["declaredRegion"],
             "email_created_at": p["emailCreatedAt"], "phone_verified": p["phoneVerified"], "phone_token": p["phoneToken"], "address_token": p["addressToken"],
             "emulated_device": p["emulatedDevice"], "device_mismatch": p["deviceIntegrityMismatch"],
             "profile_records": [{"source": r["source"], "birth_year": r["birthYear"], "region": r["declaredRegion"]} for r in p["profileRecords"]],
             "sessions": [{"event_id": e["id"], "timestamp": e["timestamp"], "device_token": e["deviceId"], "region": e["region"],
                           "form_seconds": e["formSeconds"], "edit_count": e["editCount"], "failed_attempts": e["failedAttempts"]} for e in p["events"]]} for p in rows]


@router.get("/method")
def method(current=Depends(principal)):
    return {"policyVersion": POLICY, "referenceVersion": REFERENCE_VERSION, "baseline": BASELINE, "groups": GROUPS,
            "thresholds": {"Low": [0, 24], "Review": [25, 59], "High": [60, 100]}, "syntheticOnly": True,
            "scoreIsProbability": False, "referenceSource": "Separate fixed synthetic benchmark, never fitted on another organisation's applicants."}


@router.get("/validation")
def validation(current=Depends(principal)):
    from .benchmark import benchmark
    return benchmark()
