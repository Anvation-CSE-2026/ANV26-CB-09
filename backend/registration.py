"""Separately running synthetic registration connector; keys never reach its browser.

No visitor tracking, verification provider or fraud verdict is exposed here.
"""
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import Field, model_validator
from backend.app.evidence import StrictModel, EvidenceInput, SessionRecord

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".local/registration.env"
app = FastAPI(title="Identity Lens synthetic registration connector", docs_url=None, redoc_url=None, openapi_url=None)
PORT = int(os.environ.get("LENS_REGISTRATION_PORT", "4180"))


def connection_config():
    values = dotenv_values(CONFIG) if CONFIG.exists() else {}
    base = os.environ.get("LENS_REGISTRATION_API", values.get("LENS_REGISTRATION_API", "http://127.0.0.1:8000")).rstrip("/")
    key = os.environ.get("LENS_REGISTRATION_KEY", values.get("LENS_REGISTRATION_KEY", ""))
    parsed = urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise HTTPException(503, "This local connector only supports an explicitly configured loopback API.")
    if not key or not key.startswith("lens_"):
        raise HTTPException(503, "Run npm run registration:configure in the project terminal first.")
    return base, key


def client_for(base, key):
    return httpx.Client(base_url=base, headers={"X-Lens-Key": key}, timeout=15, follow_redirects=False)


@app.middleware("http")
async def local_only(request: Request, call_next):
    if request.url.hostname not in ("localhost", "127.0.0.1", "testserver"):
        return JSONResponse({"detail": "The registration connector is localhost-only."}, status_code=403)
    if request.method == "POST":
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site submissions are not accepted."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in (f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"):
            return JSONResponse({"detail": "Untrusted submission origin."}, status_code=403)
        if len(await request.body()) > 32000:
            return JSONResponse({"detail": "Submission exceeds the size limit."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    return response


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend/registration/index.html")


@app.get("/registration.css")
def stylesheet():
    return FileResponse(ROOT / "frontend/registration/registration.css", media_type="text/css")


@app.get("/registration.js")
def javascript():
    return FileResponse(ROOT / "frontend/registration/registration.js", media_type="application/javascript")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "identity-lens-registration", "syntheticOnly": True}


@app.get("/api/connection")
def connection():
    base, key = connection_config()
    try:
        with client_for(base, key) as client:
            response = client.post("/api/ingest/check")
        if response.status_code != 200:
            raise HTTPException(503, "The connection key is invalid or revoked. Ask the workspace administrator to configure it again.")
        return response.json()
    except httpx.HTTPError:
        raise HTTPException(503, "Identity Lens is unavailable. Start the main application before this connector.")


class Registration(StrictModel):
    synthetic: Literal[True]
    external_id: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")
    registered_at: datetime
    region: Literal["North", "South", "East", "West"] | None = None
    birth_year: int | None = Field(default=None, ge=1900, le=2026)
    email_age_days: int | None = Field(default=None, ge=0, le=36500)
    phone_verified: bool | None = None
    phone_token: str | None = Field(default=None, pattern=r"^PHONE-[A-Z0-9-]{1,80}$")
    address_token: str | None = Field(default=None, pattern=r"^ADDR-[A-Z0-9-]{1,80}$")
    emulated_device: bool | None = None
    device_mismatch: bool | None = None
    add_session: bool = False
    device_token: str | None = Field(default=None, pattern=r"^DEV-[A-Z0-9-]{1,80}$")
    observed_region: Literal["North", "South", "East", "West"] | None = None
    form_seconds: float | None = Field(default=None, ge=0, le=1800)
    edit_count: int | None = Field(default=None, ge=0, le=200)
    failed_attempts: int | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def integrity(self):
        if self.registered_at.tzinfo is None:
            raise ValueError("Registration time requires a timezone.")
        self.registered_at = self.registered_at.astimezone(timezone.utc)
        if self.add_session and not self.device_token:
            raise ValueError("A synthetic session requires a DEV- token.")
        return self


@app.post("/api/register")
def register(data: Registration):
    base, key = connection_config()
    evidence = EvidenceInput(synthetic=True, external_id=data.external_id, registered_at=data.registered_at, declared_region=data.region,
        email_created_at=data.registered_at - timedelta(days=data.email_age_days) if data.email_age_days is not None else None,
        phone_verified=data.phone_verified, phone_token=data.phone_token, address_token=data.address_token,
        emulated_device=data.emulated_device, device_mismatch=data.device_mismatch,
        profile_records=[{"source": "Connected synthetic registration", "birth_year": data.birth_year, "region": data.region}])
    try:
        with client_for(base, key) as client:
            received = client.post("/api/ingest/cases", json=evidence.model_dump(mode="json"))
            if received.status_code not in (200, 201):
                message = "This applicant ID already has different evidence. Reuse identical data for a retry or ask an analyst to correct the record." if received.status_code == 409 else "Evidence was not accepted. Check the connection and supplied fields."
                raise HTTPException(409 if received.status_code == 409 else 502, message)
            accepted = 0
            if data.add_session:
                event = SessionRecord(event_id="REG-" + hashlib.sha256(data.external_id.encode()).hexdigest()[:20], timestamp=data.registered_at + timedelta(seconds=max(1, data.form_seconds or 1)), device_token=data.device_token,
                    region=data.observed_region, form_seconds=data.form_seconds, edit_count=data.edit_count, failed_attempts=data.failed_attempts)
                sessions = client.post(f"/api/ingest/cases/{data.external_id}/sessions", json={"synthetic": True, "sessions": [event.model_dump(mode="json")]})
                if sessions.status_code != 200:
                    raise HTTPException(502, "The applicant record was saved but session evidence was not accepted. Retry identical data; the analyst can inspect the pending record.")
                accepted = sessions.json()["accepted"]
            # Applicants must not receive internal fraud scores or graph details.
            return {"submitted": True, "externalId": data.external_id, "syntheticOnly": True, "observationsAccepted": accepted, "duplicateRegistration": received.json().get("duplicate", False)}
    except httpx.HTTPError:
        raise HTTPException(503, "Delivery could not be confirmed. Retry the same ID and evidence; identical events are deduplicated.")


def configure():
    key = getpass.getpass("Paste the organisation's server integration key (hidden): ").strip()
    if not key.startswith("lens_") or len(key) < 30 or "\n" in key:
        raise SystemExit("Use the key from Identity Lens → Connections.")
    with client_for("http://127.0.0.1:8000", key) as client:
        response = client.post("/api/ingest/check")
    if response.status_code != 200:
        raise SystemExit("The key was not accepted. Start Identity Lens and use an active integration key.")
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    if CONFIG.exists():
        raise SystemExit("A connector is already configured. Move .local/registration.env aside before configuring a replacement.")
    descriptor = os.open(CONFIG, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("LENS_REGISTRATION_API=http://127.0.0.1:8000\nLENS_REGISTRATION_KEY=" + key + "\n")
    print("Connected to", response.json()["organisationName"] + ". Run npm run registration:start; open http://localhost:4180.")
    print("The key is held in this connector's private local server configuration, not the browser or Identity Lens database.")


if __name__ == "__main__":
    configure()
