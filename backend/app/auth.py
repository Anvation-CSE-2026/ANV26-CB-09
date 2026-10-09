import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from .config import settings
from .database import AuthSession, get_db


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("lens_session", "")
    record = db.get(AuthSession, digest(token)) if token else None
    if not record:
        raise HTTPException(401, "Open the sample workspace to continue.")
    expiry = record.expires_at
    expiry = expiry.replace(tzinfo=timezone.utc) if expiry.tzinfo is None else expiry.astimezone(timezone.utc)
    if expiry <= datetime.now(timezone.utc):
        raise HTTPException(401, "Open the sample workspace to continue.")
    return {"name": record.actor, "role": record.role, "id": record.actor}


def analyst(current=Depends(user)):
    if current["role"] not in ("analyst", "admin"):
        raise HTTPException(403, "Your account has read-only access.")
    return current


def demo_login(request: Request, response: Response, db: Session, role="analyst"):
    if settings.allow_public_samples:
        # Published examples are inspectable, but cannot grant anonymous analyst writes.
        role = "viewer"
    elif request.client.host not in ("127.0.0.1", "::1", "testclient"):
        raise HTTPException(403, "Local sample access is unavailable.")
    token = secrets.token_urlsafe(32)
    actor = "Demo analyst" if role == "analyst" else "Demo viewer"
    expires = datetime.now(timezone.utc) + timedelta(hours=8)
    previous = request.cookies.get("lens_session")
    if previous:
        old = db.get(AuthSession, digest(previous))
        if old:
            db.delete(old)
    db.add(AuthSession(token_hash=digest(token), actor=actor, role=role, expires_at=expires))
    db.commit()
    response.set_cookie("lens_session", token, httponly=True, samesite="strict", secure=settings.secure_cookies, max_age=28800, path="/api")
    return {"name": actor, "role": role, "id": actor}
