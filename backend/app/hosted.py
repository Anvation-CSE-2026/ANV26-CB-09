"""Company-managed, consented page interaction on fictional applicant records.

Links grant only a single bounded observation for an existing applicant. They are
not organisation credentials, identity verification or cross-site tracking.
"""
from datetime import timedelta, datetime
import secrets
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .database import HostedAccess, WorkspaceCase, Organisation, get_db, now
from .config import settings
from .workspaces import principal, writer, uid, digest, utc, audit, workspace_lock
from .evidence import StrictModel, SessionRecord, scoped_case
from .collection import BrowserSummary, append_sessions

router = APIRouter(tags=["Hosted applicant activity"])


def state(link):
    if link.revoked:
        return "Revoked"
    if link.completed_at:
        return "Received"
    if utc(link.expires_at) <= now():
        return "Expired"
    return "In progress" if link.started_at else "Awaiting applicant"


@router.get("/api/org/hosted-links")
def list_links(db: Session = Depends(get_db), current=Depends(principal)):
    rows = db.execute(select(HostedAccess, WorkspaceCase).join(WorkspaceCase, WorkspaceCase.id == HostedAccess.case_id)
        .where(HostedAccess.organisation_id == current["organisationId"])
        .order_by(HostedAccess.created_at.desc()).limit(100))
    return {"enabled": settings.allow_hosted_activity, "links": [
        {"id": link.id, "caseId": row.id, "externalId": row.external_id, "status": state(link),
         "createdAt": link.created_at, "expiresAt": link.expires_at, "completedAt": link.completed_at,
         "summary": link.summary} for link, row in rows]}


class NewLink(StrictModel):
    case_id: str = Field(min_length=1, max_length=36)
    synthetic: Literal[True]


@router.post("/api/org/hosted-links", status_code=201)
def new_link(data: NewLink, db: Session = Depends(get_db), current=Depends(writer)):
    if not settings.allow_hosted_activity:
        raise HTTPException(403, "Hosted activity is disabled by this instance's operator.")
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    row = scoped_case(db, org_id, data.case_id)
    if datetime.fromisoformat(row.payload["registered_at"]) > now():
        raise HTTPException(422, "Applicant registration is in the future. Correct its timestamp before collecting activity.")
    if len(row.payload["sessions"]) >= 100:
        raise HTTPException(409, "This applicant has reached its observation limit.")
    if db.scalar(select(func.count()).select_from(HostedAccess).where(HostedAccess.organisation_id == org_id,
            HostedAccess.expires_at > now(), HostedAccess.revoked.is_(False), HostedAccess.completed_at.is_(None))) >= 200:
        raise HTTPException(429, "Too many active links. Revoke unused links or wait for expiry.")
    if db.scalar(select(func.count()).select_from(HostedAccess).where(HostedAccess.case_id == row.id,
            HostedAccess.expires_at > now(), HostedAccess.revoked.is_(False), HostedAccess.completed_at.is_(None))) >= 5:
        raise HTTPException(429, "This applicant already has five active activity links.")
    token = secrets.token_urlsafe(32)
    link = HostedAccess(id=uid(), organisation_id=org_id, case_id=row.id, token_hash=digest(token),
        session_id=uid(), expires_at=now() + timedelta(minutes=30))
    db.add(link)
    audit(db, org_id, current["id"], "hosted_link_created", {"linkId": link.id, "expiresInMinutes": 30}, row.id)
    db.commit()
    return {"id": link.id, "token": token, "expiresAt": link.expires_at, "syntheticOnly": True}


@router.delete("/api/org/hosted-links/{identifier}")
def revoke(identifier: str, db: Session = Depends(get_db), current=Depends(writer)):
    workspace_lock(db, current["organisationId"])
    link = db.scalar(select(HostedAccess).where(HostedAccess.id == identifier, HostedAccess.organisation_id == current["organisationId"]).with_for_update())
    if not link:
        raise HTTPException(404, "Activity link not found in your organisation.")
    if not link.revoked:
        link.revoked = True
        audit(db, current["organisationId"], current["id"], "hosted_link_revoked", {"linkId": link.id}, link.case_id)
        db.commit()
    return {"revoked": True}


class AccessInput(StrictModel):
    token: str = Field(min_length=20, max_length=100)


def access(db, token, lock=False):
    if not settings.allow_hosted_activity:
        raise HTTPException(403, "Hosted activity is disabled by this instance's operator.")
    initial = db.scalar(select(HostedAccess).where(HostedAccess.token_hash == digest(token)))
    if not initial:
        raise HTTPException(401, "This activity link is invalid or expired. Ask your organisation for a new link.")
    if lock:
        workspace_lock(db, initial.organisation_id)
        initial = db.scalar(select(HostedAccess).where(HostedAccess.id == initial.id).with_for_update().execution_options(populate_existing=True))
    if initial.revoked or utc(initial.expires_at) <= now():
        raise HTTPException(401, "This activity link is invalid or expired. Ask your organisation for a new link.")
    return initial


def first_party(request):
    # Never accept a missing or foreign Origin for public writes, including non-browser callers.
    if request.headers.get("origin") not in settings.allowed_origins.split(","):
        raise HTTPException(403, "Hosted activity must come from this application's allowed origin.")


@router.post("/api/hosted/info")
def information(data: AccessInput, request: Request, db: Session = Depends(get_db)):
    first_party(request)
    link = access(db, data.token)
    row = scoped_case(db, link.organisation_id, link.case_id)
    org = db.get(Organisation, link.organisation_id)
    return {"organisationName": org.name, "externalId": row.external_id, "expiresAt": link.expires_at,
        "status": state(link), "storageScope": digest("hosted-browser:" + org.id)[:24], "syntheticOnly": True,
        "clientEvidenceTrusted": False, "signals": ["page form duration", "non-sensitive field-change count", "first-party browser token"]}


class StartInput(AccessInput):
    synthetic: Literal[True]
    notice_acknowledged: Literal[True]
    browser_token: str = Field(pattern=r"^DEV-[A-Z0-9-]{1,80}$")


@router.post("/api/hosted/cancel")
def cancel(data: AccessInput, request: Request, db: Session = Depends(get_db)):
    first_party(request)
    link = access(db, data.token, True)
    if link.completed_at:
        raise HTTPException(409, "Activity was already received. No further collection is active.")
    link.revoked = True
    audit(db, link.organisation_id, "Hosted applicant", "hosted_activity_stopped", {"linkId": link.id, "summaryReceived": False}, link.case_id)
    db.commit()
    return {"stopped": True, "summaryReceived": False}


@router.post("/api/hosted/start")
def start(data: StartInput, request: Request, db: Session = Depends(get_db)):
    first_party(request)
    link = access(db, data.token, True)
    if link.completed_at:
        raise HTTPException(409, "This activity link has already been completed. Request a new link for another session.")
    if link.started_at and link.browser_token != data.browser_token:
        raise HTTPException(409, "This link has already started in another browser storage context. Request a new link.")
    if not link.started_at:
        link.started_at, link.browser_token = now(), data.browser_token
        audit(db, link.organisation_id, "Hosted applicant", "hosted_activity_started", {"linkId": link.id, "noticeAcknowledged": True, "trust": "client_reported"}, link.case_id)
        db.commit()
    return {"started": True, "expiresAt": link.expires_at, "collectionEndpoint": "/api/hosted/complete", "clientEvidenceTrusted": False}


@router.post("/api/hosted/complete")
def complete(data: BrowserSummary, request: Request, db: Session = Depends(get_db)):
    first_party(request)
    link = access(db, data.ticket, True)
    if not link.started_at:
        raise HTTPException(409, "Acknowledge the collection notice and start this activity first.")
    summary = {"formSeconds": data.form_seconds, "editCount": data.edit_count, "trust": "client_reported"}
    if link.completed_at:
        if link.summary != summary:
            raise HTTPException(409, "This completed link cannot receive different observations.")
        return {"accepted": 0, "duplicate": True, "trust": "client_reported"}
    if data.form_seconds > (now() - utc(link.started_at)).total_seconds() + 5:
        raise HTTPException(422, "Reported duration exceeds the elapsed hosted activity window.")
    row = scoped_case(db, link.organisation_id, link.case_id)
    session = SessionRecord(event_id=link.session_id, timestamp=now(), device_token=link.browser_token,
        form_seconds=data.form_seconds, edit_count=data.edit_count, failed_attempts=None, region=None)
    accepted = append_sessions(db, row, [session], "Hosted applicant", "hosted_client_reported")
    link.completed_at, link.summary = now(), summary
    audit(db, link.organisation_id, "Hosted applicant", "hosted_activity_received",
        {"linkId": link.id, "noticeAcknowledged": True, "trust": "client_reported", "observedHere": True}, row.id)
    db.commit()
    return {"accepted": accepted, "duplicate": False, "trust": "client_reported"}
