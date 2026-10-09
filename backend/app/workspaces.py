"""Authenticated organisation workflows. Tenant context comes from membership."""
from datetime import timedelta, timezone
import hashlib
import hmac
import secrets
from uuid import uuid4
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, func, case
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .database import (get_db, now, Organisation, Account, Membership, WorkspaceSession,
                       Invitation, Integration, WorkspaceCase, WorkspaceAssessment,
                       WorkspaceAudit, ImportBatch, AuthThrottle)
from .auth import digest
from .config import settings

router = APIRouter(prefix="/api/org", tags=["Organisation workspace"])


def uid():
    return str(uuid4())


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def hash_password(password):
    salt = secrets.token_bytes(16)
    result = hashlib.scrypt(password.encode(), salt=salt, n=131072, r=8, p=1, dklen=32, maxmem=268435456)
    return "scrypt$" + salt.hex() + "$" + result.hex()


def verify_password(password, encoded):
    try:
        algorithm, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=131072, r=8, p=1, dklen=32, maxmem=268435456)
        return hmac.compare_digest(result.hex(), expected)
    except (ValueError, TypeError):
        return False


def throttle(db, request):
    stamp = now()
    key = digest("auth:" + (request.client.host if request.client else "unknown"))
    statement = insert(AuthThrottle).values(key=key, attempts=1, reset_at=stamp + timedelta(minutes=15))
    statement = statement.on_conflict_do_update(index_elements=[AuthThrottle.key], set_={
        "attempts": case((AuthThrottle.reset_at <= stamp, 1), else_=AuthThrottle.attempts + 1),
        "reset_at": case((AuthThrottle.reset_at <= stamp, stamp + timedelta(minutes=15)), else_=AuthThrottle.reset_at),
    }).returning(AuthThrottle.attempts)
    attempts = db.scalar(statement)
    db.commit()
    if attempts > 15:
        raise HTTPException(429, "Too many account attempts. Try again in fifteen minutes.")


def audit(db, organisation_id, actor, action, details=None, case_id=None):
    db.add(WorkspaceAudit(organisation_id=organisation_id, actor=actor, action=action, details=details or {}, case_id=case_id))


def principal(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("lens_workspace", "")
    session = db.get(WorkspaceSession, digest(token)) if token else None
    if not session or utc(session.expires_at) <= now():
        raise HTTPException(401, "Sign in to your organisation workspace.")
    member = db.get(Membership, (session.organisation_id, session.account_id))
    if not member or not member.active:
        raise HTTPException(401, "Your workspace access has ended.")
    account = db.get(Account, session.account_id)
    organisation = db.get(Organisation, session.organisation_id)
    return {"id": account.id, "name": account.display_name, "username": account.username,
            "role": member.role, "organisationId": organisation.id, "organisationName": organisation.name}


def writer(current=Depends(principal)):
    if current["role"] not in ("admin", "analyst"):
        raise HTTPException(403, "Your organisation role is read-only.")
    return current


def administrator(current=Depends(principal)):
    if current["role"] != "admin":
        raise HTTPException(403, "Only organisation administrators can manage access and integrations.")
    return current


def workspace_lock(db, org_id):
    # Separate organisations never share a population lock or graph search.
    db.scalar(select(Organisation).where(Organisation.id == org_id).with_for_update())


def scoped_case(db, org_id, case_id):
    result = db.scalar(select(WorkspaceCase).where(WorkspaceCase.id == case_id, WorkspaceCase.organisation_id == org_id))
    if not result:
        raise HTTPException(404, "Case not found in this workspace.")
    return result


def open_session(db, request, response, org_id, account_id):
    old_token = request.cookies.get("lens_workspace")
    old = db.get(WorkspaceSession, digest(old_token)) if old_token else None
    if old:
        db.delete(old)
    token = secrets.token_urlsafe(32)
    db.add(WorkspaceSession(token_hash=digest(token), organisation_id=org_id, account_id=account_id,
                            expires_at=now() + timedelta(hours=8)))
    db.commit()
    response.set_cookie("lens_workspace", token, httponly=True, secure=settings.secure_cookies,
                        samesite="strict", path="/api", max_age=28800)


class Credentials(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9._-]{3,60}$")
    password: str = Field(min_length=12, max_length=128)
    model_config = ConfigDict(extra="forbid")

    @field_validator("username")
    @classmethod
    def normalise(cls, value):
        return value.lower()


class Register(Credentials):
    display_name: str = Field(min_length=2, max_length=80)
    organisation_name: str = Field(min_length=2, max_length=100)

    @field_validator("display_name", "organisation_name")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Use at least two non-whitespace characters.")
        return value


@router.post("/register", status_code=201)
def register(data: Register, request: Request, response: Response, db: Session = Depends(get_db)):
    throttle(db, request)
    if db.scalar(select(Account).where(Account.username == data.username)):
        raise HTTPException(409, "That username is unavailable.")
    account = Account(id=uid(), username=data.username, display_name=data.display_name.strip(), password_hash=hash_password(data.password))
    organisation = Organisation(id=uid(), name=data.organisation_name.strip())
    db.add_all([account, organisation])
    db.flush()
    db.add(Membership(organisation_id=organisation.id, account_id=account.id, role="admin"))
    audit(db, organisation.id, account.id, "organisation_created")
    try:
        open_session(db, request, response, organisation.id, account.id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That username is unavailable.")
    return {"organisationId": organisation.id, "accountId": account.id}


@router.post("/login")
def login(data: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    throttle(db, request)
    account = db.scalar(select(Account).where(Account.username == data.username).with_for_update())
    # Perform the same memory-hard operation even when the account does not exist.
    encoded = account.password_hash if account else "scrypt$" + "00" * 16 + "$" + "00" * 32
    valid = verify_password(data.password, encoded)
    if not account or not valid:
        raise HTTPException(401, "Username or password is incorrect.")
    member = db.scalar(select(Membership).where(Membership.account_id == account.id, Membership.active.is_(True)).order_by(Membership.organisation_id))
    if not member:
        raise HTTPException(403, "This account has no active workspace membership.")
    open_session(db, request, response, member.organisation_id, account.id)
    return {"organisationId": member.organisation_id}


@router.get("/me")
def me(current=Depends(principal)):
    return current


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("lens_workspace")
    session = db.get(WorkspaceSession, digest(token)) if token else None
    if session:
        db.delete(session)
        db.commit()
    response.delete_cookie("lens_workspace", path="/api")


@router.get("/workspaces")
def workspaces(db: Session = Depends(get_db), current=Depends(principal)):
    return [{"id": org.id, "name": org.name, "role": member.role} for org, member in db.execute(
        select(Organisation, Membership).join(Membership, Membership.organisation_id == Organisation.id)
        .where(Membership.account_id == current["id"], Membership.active.is_(True)))]


class Switch(BaseModel):
    organisation_id: str
    model_config = ConfigDict(extra="forbid")


@router.post("/switch")
def switch(data: Switch, request: Request, response: Response, db: Session = Depends(get_db), current=Depends(principal)):
    member = db.get(Membership, (data.organisation_id, current["id"]))
    if not member or not member.active:
        raise HTTPException(404, "Workspace not found.")
    open_session(db, request, response, data.organisation_id, current["id"])
    return {"organisationId": data.organisation_id}


@router.get("/team")
def team(db: Session = Depends(get_db), current=Depends(principal)):
    return [{"id": account.id, "name": account.display_name, "username": account.username, "role": member.role, "active": member.active}
            for account, member in db.execute(select(Account, Membership).join(Membership, Membership.account_id == Account.id)
                                              .where(Membership.organisation_id == current["organisationId"]))]


class MemberUpdate(BaseModel):
    role: str = Field(pattern=r"^(admin|analyst|viewer)$")
    active: bool
    model_config = ConfigDict(extra="forbid")


@router.put("/team/{account_id}")
def update_member(account_id: str, data: MemberUpdate, db: Session = Depends(get_db), current=Depends(administrator)):
    org_id = current["organisationId"]
    workspace_lock(db, org_id)
    member = db.get(Membership, (org_id, account_id))
    if not member:
        raise HTTPException(404, "Member not found.")
    if member.active and member.role == "admin" and (not data.active or data.role != "admin"):
        count = db.scalar(select(func.count()).select_from(Membership).where(Membership.organisation_id == org_id, Membership.active.is_(True), Membership.role == "admin"))
        if count <= 1:
            raise HTTPException(409, "The workspace must retain an active administrator.")
    member.role, member.active = data.role, data.active
    if not data.active:
        for session in db.scalars(select(WorkspaceSession).where(WorkspaceSession.organisation_id == org_id, WorkspaceSession.account_id == account_id)):
            db.delete(session)
    audit(db, org_id, current["id"], "membership_updated", {"accountId": account_id, **data.model_dump()})
    db.commit()
    return {"saved": True}


class InviteInput(BaseModel):
    role: str = Field(pattern=r"^(analyst|viewer|admin)$")
    model_config = ConfigDict(extra="forbid")


@router.post("/invitations", status_code=201)
def invite(data: InviteInput, db: Session = Depends(get_db), current=Depends(administrator)):
    token = secrets.token_urlsafe(32)
    invitation = Invitation(id=uid(), organisation_id=current["organisationId"], token_hash=digest(token), role=data.role, expires_at=now() + timedelta(hours=48))
    db.add(invitation)
    audit(db, current["organisationId"], current["id"], "invitation_created", {"invitationId": invitation.id, "role": data.role})
    db.commit()
    return {"id": invitation.id, "token": token, "expiresAt": invitation.expires_at, "role": invitation.role}


@router.get("/invitations")
def invitations(db: Session = Depends(get_db), current=Depends(administrator)):
    return [{"id": row.id, "role": row.role, "expiresAt": row.expires_at, "used": row.used_at is not None, "revoked": row.revoked}
            for row in db.scalars(select(Invitation).where(Invitation.organisation_id == current["organisationId"]))]


@router.delete("/invitations/{invitation_id}")
def revoke_invite(invitation_id: str, db: Session = Depends(get_db), current=Depends(administrator)):
    invitation = db.scalar(select(Invitation).where(Invitation.id == invitation_id, Invitation.organisation_id == current["organisationId"]))
    if not invitation:
        raise HTTPException(404, "Invitation not found.")
    invitation.revoked = True
    audit(db, current["organisationId"], current["id"], "invitation_revoked", {"invitationId": invitation_id})
    db.commit()
    return {"saved": True}


class Join(Credentials):
    token: str = Field(min_length=20, max_length=100)
    display_name: str = Field(min_length=2, max_length=80)

    @field_validator("display_name")
    @classmethod
    def nonblank(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("Use at least two non-whitespace characters.")
        return value.strip()


@router.post("/join")
def join(data: Join, request: Request, response: Response, db: Session = Depends(get_db)):
    throttle(db, request)
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == digest(data.token)).with_for_update())
    if not invitation or invitation.revoked or invitation.used_at or utc(invitation.expires_at) <= now():
        raise HTTPException(410, "Invitation is invalid, expired or already used.")
    account = db.scalar(select(Account).where(Account.username == data.username))
    if account and not verify_password(data.password, account.password_hash):
        raise HTTPException(401, "Username or password is incorrect.")
    if not account:
        account = Account(id=uid(), username=data.username, display_name=data.display_name.strip(), password_hash=hash_password(data.password))
        db.add(account)
        db.flush()
    if db.get(Membership, (invitation.organisation_id, account.id)):
        raise HTTPException(409, "This account already belongs to the workspace.")
    db.add(Membership(organisation_id=invitation.organisation_id, account_id=account.id, role=invitation.role))
    invitation.used_at = now()
    audit(db, invitation.organisation_id, account.id, "invitation_accepted", {"role": invitation.role})
    open_session(db, request, response, invitation.organisation_id, account.id)
    return {"organisationId": invitation.organisation_id}


class IntegrationInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    origins: list[str] = Field(min_length=1, max_length=10)
    model_config = ConfigDict(extra="forbid")

    @field_validator("origins")
    @classmethod
    def validate_origins(cls, values):
        clean = []
        for origin in values:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                raise ValueError("Use exact origins such as https://accounts.example.org.")
            if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
                raise ValueError("External origins require HTTPS.")
            clean.append(origin.rstrip("/"))
        return list(dict.fromkeys(clean))


@router.post("/integrations", status_code=201)
def create_integration(data: IntegrationInput, db: Session = Depends(get_db), current=Depends(administrator)):
    secret = "lens_" + secrets.token_urlsafe(32)
    row = Integration(id=uid(), organisation_id=current["organisationId"], name=data.name.strip(), origins=data.origins,
                      key_hash=digest(secret), key_prefix=secret[:12])
    db.add(row)
    audit(db, current["organisationId"], current["id"], "integration_created", {"integrationId": row.id})
    db.commit()
    return {"id": row.id, "secret": secret, "prefix": row.key_prefix}


@router.get("/integrations")
def integrations(db: Session = Depends(get_db), current=Depends(administrator)):
    return [{"id": row.id, "name": row.name, "origins": row.origins, "prefix": row.key_prefix, "active": row.active, "lastUsedAt": row.last_used_at}
            for row in db.scalars(select(Integration).where(Integration.organisation_id == current["organisationId"]).order_by(Integration.created_at.desc()))]


@router.delete("/integrations/{integration_id}")
def revoke_integration(integration_id: str, db: Session = Depends(get_db), current=Depends(administrator)):
    row = db.scalar(select(Integration).where(Integration.id == integration_id, Integration.organisation_id == current["organisationId"]))
    if not row:
        raise HTTPException(404, "Integration not found.")
    row.active = False
    audit(db, current["organisationId"], current["id"], "integration_revoked", {"integrationId": integration_id})
    db.commit()
    return {"saved": True}


def integration_principal(request: Request, db: Session = Depends(get_db)):
    if request.headers.get("origin"):
        raise HTTPException(403, "Use integration keys on your server. Browsers must use short-lived collection tickets.")
    token = request.headers.get("x-lens-key", "")
    row = db.scalar(select(Integration).where(Integration.key_hash == digest(token), Integration.active.is_(True))) if token else None
    if not row:
        raise HTTPException(401, "An active server integration key is required.")
    row.last_used_at = now()
    return {"organisationId": row.organisation_id, "integrationId": row.id, "name": row.name, "origins": row.origins}


@router.get("/audit")
def audit_history(db: Session = Depends(get_db), current=Depends(principal)):
    return [{"id": row.id, "caseId": row.case_id, "actor": row.actor, "action": row.action, "details": row.details, "timestamp": row.created_at}
            for row in db.scalars(select(WorkspaceAudit).where(WorkspaceAudit.organisation_id == current["organisationId"]).order_by(WorkspaceAudit.id.desc()).limit(100))]


@router.get("/imports")
def imports(db: Session = Depends(get_db), current=Depends(principal)):
    return [{"id": row.id, "filename": row.filename, "count": row.imported_count, "timestamp": row.created_at}
            for row in db.scalars(select(ImportBatch).where(ImportBatch.organisation_id == current["organisationId"]).order_by(ImportBatch.created_at.desc()).limit(50))]
