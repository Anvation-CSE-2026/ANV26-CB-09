"""Server integration and short-lived, origin-bound browser collection tickets."""
from datetime import timedelta
import secrets
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from pydantic import ValidationError
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .database import get_db, Integration, WorkspaceCase, EvidenceEvent, CollectionTicket, now
from .workspaces import integration_principal, principal, writer, uid, utc, digest, audit, workspace_lock
from .evidence import (StrictModel, EvidenceInput, SessionRecord, persist_case, reassess_population,
                       scoped_case, normalise, calculate, population)
from .config import settings

router = APIRouter(tags=["Connected evidence collection"])


@router.post("/api/ingest/check")
def check_connection(db: Session = Depends(get_db), integration=Depends(integration_principal)):
    from .database import Organisation
    organisation = db.get(Organisation, integration["organisationId"])
    db.commit()
    return {"connected": True, "organisationName": organisation.name, "integrationName": integration["name"], "syntheticOnly": True}


@router.post("/api/ingest/cases", status_code=201)
def submit_case(data: EvidenceInput, db: Session = Depends(get_db), integration=Depends(integration_principal)):
    org_id = integration["organisationId"]
    workspace_lock(db, org_id)
    existing = db.scalar(select(WorkspaceCase).where(WorkspaceCase.organisation_id == org_id, WorkspaceCase.external_id == data.external_id))
    if existing:
        supplied = data.model_dump(mode="json")
        previous_events = {event["event_id"]: event for event in existing.payload["sessions"]}
        same_profile = {k: v for k, v in existing.payload.items() if k != "sessions"} == {k: v for k, v in supplied.items() if k != "sessions"}
        if same_profile and all(previous_events.get(event["event_id"]) == event for event in supplied["sessions"]):
            db.commit()
            return {"id": existing.id, "duplicate": True}
        raise HTTPException(409, "This external ID already exists with different evidence.")
    if len(population(db, org_id)) >= 1000:
        raise HTTPException(409, "Workspace applicant limit reached.")
    row = persist_case(db, org_id, data, integration["integrationId"], "server_integration")
    reassess_population(db, org_id)
    db.commit()
    return {"id": row.id, "duplicate": False}


class SessionsInput(StrictModel):
    synthetic: Literal[True]
    sessions: list[SessionRecord] = Field(min_length=1, max_length=100)


def append_sessions(db, row, sessions, actor, source):
    payload = dict(row.payload)
    payload["sessions"] = list(payload["sessions"])
    existing = {e["event_id"]: e for e in payload["sessions"]}
    accepted = 0
    for session in sessions:
        data = session.model_dump(mode="json")
        if session.event_id in existing:
            if existing[session.event_id] != data:
                raise HTTPException(409, "An event ID cannot be reused with different evidence.")
            continue
        if len(payload["sessions"]) >= 100:
            raise HTTPException(409, "This applicant has reached the 100-session evidence limit.")
        payload["sessions"].append(data)
        existing[session.event_id] = data
        db.add(EvidenceEvent(id=uid(), organisation_id=row.organisation_id, case_id=row.id,
                             external_id=row.id + ":" + session.event_id, source=source, payload=data))
        accepted += 1
    if accepted:
        try:
            EvidenceInput.model_validate(payload)
        except ValidationError:
            raise HTTPException(422, "Sessions must follow registration and satisfy the evidence schema.")
        row.payload = payload
        row.revision += 1
        row.evidence_revision += 1
        audit(db, row.organisation_id, actor, "sessions_received", {"count": accepted, "source": source}, row.id)
        reassess_population(db, row.organisation_id)
    return accepted


@router.post("/api/ingest/cases/{external_id}/sessions")
def submit_sessions(external_id: str, data: SessionsInput, db: Session = Depends(get_db), integration=Depends(integration_principal)):
    org_id = integration["organisationId"]
    workspace_lock(db, org_id)
    row = db.scalar(select(WorkspaceCase).where(WorkspaceCase.organisation_id == org_id, WorkspaceCase.external_id == external_id))
    if not row:
        raise HTTPException(404, "Applicant not found in this integration's workspace.")
    count = append_sessions(db, row, data.sessions, integration["integrationId"], "server_integration")
    db.commit()
    return {"accepted": count, "duplicates": len(data.sessions) - count, "revision": row.revision}


class TicketInput(StrictModel):
    synthetic: Literal[True]
    external_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")
    browser_token: str = Field(pattern=r"^DEV-[A-Z0-9-]{1,80}$")


@router.post("/api/ingest/collection-tickets", status_code=201)
def ticket(data: TicketInput, db: Session = Depends(get_db), integration=Depends(integration_principal)):
    if not settings.allow_browser_telemetry:
        raise HTTPException(403, "Browser measurement is disabled. The CY-04 submission accepts synthetic event streams. Enable only with an approved data scope.")
    row = db.scalar(select(WorkspaceCase).where(WorkspaceCase.organisation_id == integration["organisationId"], WorkspaceCase.external_id == data.external_id))
    if not row:
        raise HTTPException(404, "Applicant not found.")
    if db.scalar(select(func.count()).select_from(CollectionTicket).where(CollectionTicket.case_id == row.id, CollectionTicket.expires_at > now())) >= 20:
        raise HTTPException(429, "Too many active collection sessions for this applicant.")
    secret, session_id = secrets.token_urlsafe(32), uid()
    row_ticket = CollectionTicket(token_hash=digest(secret), integration_id=integration["integrationId"], case_id=row.id,
                                  session_id=session_id, browser_token=data.browser_token, expires_at=now() + timedelta(minutes=30))
    db.add(row_ticket)
    audit(db, integration["organisationId"], integration["integrationId"], "collection_ticket_created", {"sessionId": session_id}, row.id)
    db.commit()
    return {"ticket": secret, "sessionId": session_id, "expiresAt": row_ticket.expires_at,
            "collectionEndpoint": "/api/collect/events", "allowedEvent": "form_completed", "clientEvidenceTrusted": False}


class BrowserSummary(StrictModel):
    ticket: str = Field(min_length=20, max_length=100)
    event_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")
    type: Literal["form_completed"]
    form_seconds: float = Field(ge=0, le=1800)
    edit_count: int = Field(ge=0, le=200)
    collection_notice_acknowledged: Literal[True]


@router.post("/api/collect/events")
def collect(data: BrowserSummary, request: Request, db: Session = Depends(get_db)):
    if not settings.allow_browser_telemetry:
        raise HTTPException(403, "Browser measurement is disabled for this synthetic-only submission.")
    stored = db.scalar(select(CollectionTicket).where(CollectionTicket.token_hash == digest(data.ticket)).with_for_update())
    if not stored or utc(stored.expires_at) <= now():
        raise HTTPException(401, "Collection ticket is invalid or expired.")
    integration = db.get(Integration, stored.integration_id)
    if not integration or not integration.active:
        raise HTTPException(401, "Integration has been revoked.")
    origin = request.headers.get("origin")
    if not origin or origin not in integration.origins:
        raise HTTPException(403, "This origin is not registered for this collection ticket.")
    org_id = integration.organisation_id
    workspace_lock(db, org_id)
    row = scoped_case(db, org_id, stored.case_id)
    event_id = stored.session_id
    if stored.completed_at:
        return {"accepted": 0, "duplicate": True}
    session = SessionRecord(event_id=event_id, timestamp=now(), device_token=stored.browser_token,
                            form_seconds=data.form_seconds, edit_count=data.edit_count, failed_attempts=None)
    count = append_sessions(db, row, [session], integration.id, "browser_client_reported")
    stored.completed_at = now()
    audit(db, org_id, integration.id, "browser_summary_received", {"sessionId": stored.session_id, "trust": "client_reported", "region": "unknown", "noticeAcknowledged": True}, row.id)
    db.commit()
    return {"accepted": count, "duplicate": False, "trust": "client_reported"}


@router.get("/api/org/collection-status")
def collection_status(current=Depends(principal)):
    return {"browserMeasurementEnabled": settings.allow_browser_telemetry, "dataScope": "synthetic", "sdkPath": "/identity-lens.js",
            "signals": ["form completion duration", "field-change count", "first-party browser token"],
            "notCollected": ["typed values", "passwords", "OTP values", "precise location", "IP addresses"],
            "limitations": ["Browser tokens can be reset or spoofed.", "Browser summaries are client-reported.", "Email age, phone verification and emulator status require supplied evidence."]}


class ReplayInput(StrictModel):
    scenario: Literal["ordinary", "shared_household", "coordinated_ring", "sparse_history"]


@router.post("/api/org/collection/replay", status_code=201)
def replay(data: ReplayInput, db: Session = Depends(get_db), current=Depends(writer)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    group = uid().split("-")[0].upper()
    count = 5 if data.scenario == "coordinated_ring" else 2 if data.scenario == "shared_household" else 1
    if len(population(db, org_id)) + count > 1000:
        raise HTTPException(409, "Workspace applicant limit reached.")
    start = now() - timedelta(hours=1)
    created = []
    for index in range(count):
        suspicious = data.scenario == "coordinated_ring"
        sparse = data.scenario == "sparse_history"
        timestamp = start + timedelta(minutes=index * (2 if suspicious else 60))
        profile = [{"source": "Synthetic registration", "birth_year": 1995, "region": "North"}]
        if not sparse:
            profile.append({"source": "Synthetic verification", "birth_year": 1998 if suspicious else 1995, "region": "South" if suspicious else "North"})
        evidence = EvidenceInput(synthetic=True, external_id=f"LAB-{group}-{index + 1}", registered_at=timestamp,
                                 declared_region="North", email_created_at=None if sparse else timestamp - timedelta(days=2 if suspicious or data.scenario == "shared_household" else 180),
                                 phone_verified=None if sparse else not suspicious, phone_token=f"PHONE-LAB-{group}", address_token=f"ADDR-LAB-{group}",
                                 emulated_device=None if sparse else suspicious, device_mismatch=None if sparse else suspicious, profile_records=profile)
        row = persist_case(db, org_id, evidence, current["id"], "synthetic_replay")
        event = SessionRecord(event_id=f"LAB-EVENT-{group}-{index}", timestamp=timestamp + timedelta(minutes=4), device_token=f"DEV-LAB-{group}",
                              region="South" if suspicious else "North", form_seconds=18 if suspicious else 50 if data.scenario == "shared_household" else 190,
                              edit_count=0 if suspicious else 4, failed_attempts=15 if suspicious else 4 if data.scenario == "shared_household" else 0)
        # Store the same event schema used by the connected server integration.
        payload = dict(row.payload)
        payload["sessions"] = [event.model_dump(mode="json")]
        row.payload = payload
        db.add(EvidenceEvent(id=uid(), organisation_id=org_id, case_id=row.id, external_id=f"REPLAY-{group}-{index}", source="synthetic_replay", payload=event.model_dump(mode="json")))
        created.append(row.id)
    reassess_population(db, org_id)
    audit(db, org_id, current["id"], "synthetic_replay_completed", {"scenario": data.scenario, "caseIds": created})
    db.commit()
    return {"caseIds": created, "source": "synthetic_replay", "measuredFromVisitor": False}
