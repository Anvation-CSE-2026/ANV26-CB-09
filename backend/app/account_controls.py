"""Account-owned password changes and session revocation. No email service."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, delete, update
from sqlalchemy.orm import Session
from .auth import digest
from .database import Account, WorkspaceSession, Organisation, Membership, EmailAction, get_db, now
from .workspaces import principal, throttle, verify_password, hash_password, utc, audit

router = APIRouter(prefix="/api/org/account", tags=["Account controls"])


def audit_account(db, account_id, action, details=None):
    for org_id in db.scalars(select(Membership.organisation_id).where(Membership.account_id == account_id, Membership.active.is_(True))):
        audit(db, org_id, account_id, action, details)


def session_id(row):
    # This identifier cannot be used as a session cookie or its database hash.
    return digest("revoke-session:" + row.token_hash)


@router.get("/sessions")
def sessions(request: Request, db: Session = Depends(get_db), current=Depends(principal)):
    current_hash = digest(request.cookies.get("lens_workspace", ""))
    return [{"id": session_id(row), "organisation": org.name, "expiresAt": row.expires_at,
             "current": row.token_hash == current_hash}
            for row, org in db.execute(select(WorkspaceSession, Organisation)
                .join(Organisation, Organisation.id == WorkspaceSession.organisation_id)
                .where(WorkspaceSession.account_id == current["id"], WorkspaceSession.expires_at > now())
                .order_by(WorkspaceSession.expires_at.desc()))]


@router.delete("/sessions/{identifier}")
def revoke_session(identifier: str, request: Request, response: Response, db: Session = Depends(get_db), current=Depends(principal)):
    db.scalar(select(Account).where(Account.id == current["id"]).with_for_update())
    row = next((row for row in db.scalars(select(WorkspaceSession).where(WorkspaceSession.account_id == current["id"])) if session_id(row) == identifier), None)
    if not row:
        raise HTTPException(404, "Session not found for your account.")
    is_current = row.token_hash == digest(request.cookies.get("lens_workspace", ""))
    db.delete(row)
    audit_account(db, current["id"], "account_session_revoked", {"currentSession": is_current})
    db.commit()
    if is_current:
        response.delete_cookie("lens_workspace", path="/api")
    return {"signedOut": is_current}


@router.post("/sessions/revoke-others")
def revoke_others(request: Request, db: Session = Depends(get_db), current=Depends(principal)):
    db.scalar(select(Account).where(Account.id == current["id"]).with_for_update())
    own_hash = digest(request.cookies.get("lens_workspace", ""))
    count = db.execute(delete(WorkspaceSession).where(WorkspaceSession.account_id == current["id"], WorkspaceSession.token_hash != own_hash)).rowcount
    audit_account(db, current["id"], "other_account_sessions_revoked", {"count": count})
    db.commit()
    return {"revoked": count}


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=12, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)
    model_config = ConfigDict(extra="forbid")


@router.post("/password")
def change_password(data: PasswordChange, request: Request, response: Response, db: Session = Depends(get_db), current=Depends(principal)):
    throttle(db, request)
    account = db.scalar(select(Account).where(Account.id == current["id"]).with_for_update())
    if not verify_password(data.current_password, account.password_hash):
        raise HTTPException(401, "Your current password is incorrect.")
    if data.current_password == data.new_password:
        raise HTTPException(422, "Choose a new password different from your current password.")
    account.password_hash = hash_password(data.new_password)
    db.execute(delete(WorkspaceSession).where(WorkspaceSession.account_id == account.id))
    # Retired email-recovery links cannot survive a password change.
    db.execute(update(EmailAction).where(EmailAction.account_id == account.id, EmailAction.used_at.is_(None)).values(used_at=now()))
    audit_account(db, account.id, "account_password_changed")
    db.commit()
    response.delete_cookie("lens_workspace", path="/api")
    return {"message": "Password changed. All sessions have been signed out. Sign in again with your new password."}
