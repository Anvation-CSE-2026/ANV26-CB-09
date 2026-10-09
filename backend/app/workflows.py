"""Guided setup and analyst-owned evidence requests, not applicant messaging."""
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .database import (get_db, Membership, Integration, WorkspaceCase, WorkspaceAudit, EvidenceRequest, HostedAccess, now)
from .config import settings
from .evidence import StrictModel
from .workspaces import principal, writer, scoped_case, workspace_lock, uid, audit

router = APIRouter(prefix="/api/org", tags=["Workspace workflow"])
Category = Literal["Profile comparison", "Email history", "Phone verification", "Device telemetry", "Session region", "Form behaviour", "Relationship tokens", "Other"]


@router.get("/onboarding")
def onboarding(db: Session = Depends(get_db), current=Depends(principal)):
    org = current["organisationId"]
    def count(model, *conditions):
        return db.scalar(select(func.count()).select_from(model).where(model.organisation_id == org, *conditions))
    return {"members": count(Membership, Membership.active.is_(True)), "applicants": count(WorkspaceCase),
            "completedReviews": count(WorkspaceCase, WorkspaceCase.review_status == "Review complete"),
            "activeConnections": count(Integration, Integration.active.is_(True)),
            "serverCasesReceived": count(WorkspaceAudit, WorkspaceAudit.action == "case_created", WorkspaceAudit.details["source"].as_string() == "server_integration"),
            "openRequests": count(EvidenceRequest, EvidenceRequest.status == "Open"),
            "browserMeasurementEnabled": settings.allow_browser_telemetry,
            "hostedActivityEnabled": settings.allow_hosted_activity,
            "hostedSummariesReceived": count(HostedAccess, HostedAccess.completed_at.is_not(None))}


def payload(row):
    return {"id": row.id, "caseId": row.case_id, "category": row.category, "description": row.description,
            "status": row.status, "resolution": row.resolution, "assignedTo": row.assigned_to,
            "requestedBy": row.requested_by, "revision": row.revision, "dueAt": row.due_at,
            "createdAt": row.created_at, "updatedAt": row.updated_at}


@router.get("/cases/{case_id}/requests")
def requests(case_id: str, db: Session = Depends(get_db), current=Depends(principal)):
    scoped_case(db, current["organisationId"], case_id)
    return [payload(r) for r in db.scalars(select(EvidenceRequest).where(EvidenceRequest.organisation_id == current["organisationId"], EvidenceRequest.case_id == case_id).order_by(EvidenceRequest.created_at.desc()))]


class RequestInput(StrictModel):
    case_revision: int = Field(ge=1)
    category: Category
    description: str = Field(min_length=5, max_length=1000)
    assigned_to: str | None = None
    due_at: datetime | None = None

    @field_validator("description")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Describe the evidence needed in at least five characters.")
        return value

    @field_validator("due_at")
    @classmethod
    def due_timezone(cls, value):
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("Due dates require a timezone.")
            value = value.astimezone(timezone.utc)
            if value <= now():
                raise ValueError("Choose a future due date.")
        return value


@router.post("/cases/{case_id}/requests", status_code=201)
def create_request(case_id: str, data: RequestInput, db: Session = Depends(get_db), current=Depends(writer)):
    org = current["organisationId"]
    workspace_lock(db, org)
    case = scoped_case(db, org, case_id)
    if case.revision != data.case_revision:
        raise HTTPException(409, "This case changed. Reload before requesting evidence.")
    if data.assigned_to:
        member = db.get(Membership, (org, data.assigned_to))
        if not member or not member.active or member.role not in ("admin", "analyst"):
            raise HTTPException(422, "Choose an active analyst in this organisation.")
    if db.scalar(select(func.count()).select_from(EvidenceRequest).where(EvidenceRequest.organisation_id == org, EvidenceRequest.case_id == case_id)) >= 100:
        raise HTTPException(409, "This case has reached its 100-request history limit.")
    if db.scalar(select(EvidenceRequest.id).where(EvidenceRequest.organisation_id == org, EvidenceRequest.case_id == case_id, EvidenceRequest.category == data.category, EvidenceRequest.status == "Open")):
        raise HTTPException(409, "There is already an open request for this evidence category.")
    row = EvidenceRequest(id=uid(), organisation_id=org, case_id=case_id, requested_by=current["id"], assigned_to=data.assigned_to,
                          category=data.category, description=data.description, due_at=data.due_at)
    db.add(row)
    case.review_status = "Needs evidence"
    case.revision += 1
    audit(db, org, current["id"], "evidence_requested", {"requestId": row.id, "category": row.category, "description": row.description}, case_id)
    db.commit()
    return payload(row)


class RequestUpdate(StrictModel):
    revision: int = Field(ge=1)
    status: Literal["Resolved", "Cancelled"]
    resolution: str = Field(min_length=5, max_length=1000)

    @field_validator("resolution")
    @classmethod
    def nonblank(cls, value):
        if len(value.strip()) < 5:
            raise ValueError("Explain why the request is closed.")
        return value.strip()


@router.put("/cases/{case_id}/requests/{request_id}")
def close_request(case_id: str, request_id: str, data: RequestUpdate, db: Session = Depends(get_db), current=Depends(writer)):
    org = current["organisationId"]
    workspace_lock(db, org)
    scoped_case(db, org, case_id)
    row = db.scalar(select(EvidenceRequest).where(EvidenceRequest.organisation_id == org, EvidenceRequest.case_id == case_id, EvidenceRequest.id == request_id))
    if not row:
        raise HTTPException(404, "Evidence request not found in this case.")
    if row.revision != data.revision or row.status != "Open":
        raise HTTPException(409, "This request has already changed. Reload it before saving.")
    row.status, row.resolution, row.updated_at = data.status, data.resolution, now()
    row.revision += 1
    audit(db, org, current["id"], "evidence_request_closed", {"requestId": row.id, "status": row.status, "resolution": row.resolution}, case_id)
    db.commit()
    return payload(row)
