from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import logging
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, update, text
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db, engine, Identity, Assessment, Review, Note, Audit, AuthSession, EvaluationLabel, now
from .auth import user, analyst, demo_login, digest
from .seed import seed_database, ensure_current_assessments, observations, DATA
from .engine import assess, fit_baseline, evaluate, GROUPS, VERSION
from .intake import SyntheticCaseInput, create_synthetic_case
from .workspaces import router as workspace_router
from .evidence import router as evidence_router
from .collection import router as collection_router
from .workflows import router as workflow_router
from .account_controls import router as account_router
from .hosted import router as hosted_router
from .runtime import install_runtime, start_logging

logger = logging.getLogger("identity_lens")


@asynccontextmanager
async def lifespan(app):
    start_logging()
    seed_database()
    ensure_current_assessments()
    yield
    engine.dispose()


app = FastAPI(title="Identity Lens API", version="3.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
origins = settings.allowed_origins.split(",")
app.include_router(workspace_router)
app.include_router(evidence_router)
app.include_router(collection_router)
app.include_router(workflow_router)
app.include_router(account_router)
app.include_router(hosted_router)


@app.middleware("http")
async def request_policy(request: Request, call_next):
    from starlette.responses import JSONResponse
    allowed_hosts = {"localhost", "127.0.0.1", "testserver"}
    if settings.public_host:
        allowed_hosts.add(settings.public_host)
    if request.url.hostname not in allowed_hosts:
        return JSONResponse({"detail": "This host is not configured for Identity Lens."}, status_code=403)
    collection_request = request.url.path.startswith("/api/collect/")
    origin = request.headers.get("origin")
    if origin and not collection_request and origin not in origins:
        return JSONResponse({"detail": "Untrusted request origin."}, status_code=403)
    if request.method == "OPTIONS":
        response = Response(status_code=204)
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Lens-Key"
            if not collection_request:
                response.headers["Access-Control-Allow-Credentials"] = "true"
        return response
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        if not collection_request and request.headers.get("origin") and request.headers["origin"] not in origins:
            return JSONResponse({"detail": "Untrusted request origin."}, status_code=403)
        if not collection_request and request.headers.get("sec-fetch-site") == "cross-site" and request.headers.get("origin") not in origins:
            return JSONResponse({"detail": "Cross-site writes are not permitted."}, status_code=403)
        limit = 2000000 if request.url.path.startswith("/api/org/imports") else 131072
        try:
            too_large = int(request.headers.get("content-length", "0")) > limit
        except ValueError:
            return JSONResponse({"detail": "Invalid content length."}, status_code=400)
        if too_large or len(await request.body()) > limit:
            return JSONResponse({"detail": "Request exceeds the size limit."}, status_code=413)
    response = await call_next(request)
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        if not collection_request:
            response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


install_runtime(app)


class SampleInput(BaseModel):
    role: Literal["analyst", "viewer"] = "analyst"
    model_config = ConfigDict(extra="forbid")


class SensitivityInput(BaseModel):
    excluded: list[str] = Field(default_factory=list, max_length=12)
    model_config = ConfigDict(extra="forbid")


class ReviewInput(BaseModel):
    status: Literal["Unreviewed", "In review", "Needs evidence", "Review complete"]
    note: str = Field(default="", max_length=4000)
    revision: int = Field(ge=0)
    model_config = ConfigDict(extra="forbid")


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "postgresql", "version": "3.0.0", "runtimeMode": settings.runtime_mode, "hostedActivityEnabled": settings.allow_hosted_activity, "capabilities": ["organisations", "evidence_ingestion", "audit_history", "account_controls", "hosted_activity"]}


@app.get("/api/auth/config")
def auth_config(request: Request, db: Session = Depends(get_db)):
    try:
        current = user(request, db)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        current = None
    return {"mode": "sample", "user": current}


@app.post("/api/auth/demo", include_in_schema=False)
@app.post("/api/auth/sample", summary="Open sample workspace", tags=["Sample cases"])
def login(data: SampleInput, request: Request, response: Response, db: Session = Depends(get_db)):
    if not settings.enable_sandbox:
        raise HTTPException(403, "The isolated sample sandbox is disabled.")
    return demo_login(request, response, db, data.role)


@app.get("/api/auth/me")
def me(current=Depends(user)):
    return current


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db), current=Depends(user)):
    token = request.cookies.get("lens_session")
    if token:
        record = db.get(AuthSession, digest(token))
        if record:
            db.delete(record)
            db.commit()
    response.delete_cookie("lens_session", path="/api")


def review_payload(db, identity_id):
    review = db.get(Review, identity_id)
    if not review:
        raise HTTPException(404, "Unknown case.")
    notes = db.scalars(select(Note).where(Note.identity_id == identity_id).order_by(Note.id.desc())).all()
    audit = db.scalars(select(Audit).where(Audit.identity_id == identity_id).order_by(Audit.id.desc()).limit(30)).all()
    return {"identityId": identity_id, "status": review.status, "revision": review.revision,
            "updatedAt": review.updated_at, "updatedBy": review.updated_by,
            "notes": [{"id": n.id, "text": n.text, "author": n.author, "createdAt": n.created_at} for n in notes],
            "history": [{"id": a.id, "actor": a.actor, "action": a.action, "details": a.details, "createdAt": a.created_at} for a in audit]}


def validation(db, baseline):
    labels = {r.identity_id: r.label for r in db.scalars(select(EvaluationLabel))}
    return evaluate(observations(db, "holdout"), labels, baseline)


@app.get("/api/bootstrap")
def bootstrap(db: Session = Depends(get_db), current=Depends(user)):
    population = observations(db)
    baseline = fit_baseline(observations(db, "reference"))
    records = db.scalars(select(Assessment).order_by(Assessment.id)).all()
    results = {r.identity_id: r.payload for r in records if r.version == VERSION}
    return {"population": population, "assessments": list(results.values()), "baseline": baseline,
            "metrics": validation(db, baseline), "groups": GROUPS, "modelVersion": VERSION,
            "asOf": DATA["asOf"], "seed": DATA["seed"], "showcases": DATA["showcases"],
            "referenceCount": baseline["n"], "holdoutCount": len(DATA["holdout"]["population"]),
            "reviews": {r.identity_id: {"status": r.status, "revision": r.revision} for r in db.scalars(select(Review))},
            "user": current, "syntheticOnly": True}


@app.get("/api/cases/{identity_id}/review")
def read_review(identity_id: str, db: Session = Depends(get_db), current=Depends(user)):
    return review_payload(db, identity_id)


@app.post("/api/cases", status_code=201)
def create_case(data: SyntheticCaseInput, db: Session = Depends(get_db), current=Depends(analyst)):
    return create_synthetic_case(db, data, current["name"])


@app.put("/api/cases/{identity_id}/review")
def save_review(identity_id: str, data: ReviewInput, db: Session = Depends(get_db), current=Depends(analyst)):
    if not db.get(Review, identity_id):
        raise HTTPException(404, "Unknown case.")
    result = db.execute(update(Review).where(Review.identity_id == identity_id, Review.revision == data.revision)
                        .values(status=data.status, revision=data.revision + 1, updated_by=current["name"], updated_at=now()))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Another analyst updated this case. Reload the review before saving.")
    note = data.note.strip()
    if note:
        db.add(Note(identity_id=identity_id, text=note, author=current["name"]))
    db.add(Audit(identity_id=identity_id, actor=current["name"], action="review_saved",
                 details={"status": data.status, "revision": data.revision + 1, "noteAdded": bool(note)}))
    db.commit()
    return review_payload(db, identity_id)


@app.post("/api/cases/{identity_id}/sensitivity")
def sensitivity(identity_id: str, data: SensitivityInput, db: Session = Depends(get_db), current=Depends(user)):
    population = observations(db)
    p = next((p for p in population if p["id"] == identity_id), None)
    if not p:
        raise HTTPException(404, "Unknown case.")
    baseline = fit_baseline(observations(db, "reference"))
    original = assess(p, population, baseline)
    if set(data.excluded) - {i["id"] for i in original["indicators"]}:
        raise HTTPException(422, "An omitted indicator is not part of this case.")
    return assess(p, population, baseline, data.excluded)


@app.post("/api/cases/{identity_id}/reassess")
def reassess(identity_id: str, db: Session = Depends(get_db), current=Depends(analyst)):
    db.execute(text("SELECT pg_advisory_xact_lock(2404)"))
    population = observations(db)
    p = next((p for p in population if p["id"] == identity_id), None)
    if not p:
        raise HTTPException(404, "Unknown case.")
    result = assess(p, population, fit_baseline(observations(db, "reference")))
    db.add(Assessment(identity_id=identity_id, version=VERSION, payload=result))
    db.add(Audit(identity_id=identity_id, actor=current["name"], action="reassessed", details={"version": VERSION, "score": result["score"]}))
    db.commit()
    return result


@app.get("/api/cases/{identity_id}/report")
def report(identity_id: str, db: Session = Depends(get_db), current=Depends(user)):
    p = db.get(Identity, identity_id)
    if not p or p.cohort != "observed":
        raise HTTPException(404, "Unknown case.")
    record = db.scalar(select(Assessment).where(Assessment.identity_id == identity_id).order_by(Assessment.id.desc()).limit(1))
    return {"syntheticOnly": True, "advisoryOnly": True, "asOf": DATA["asOf"], "seed": DATA["seed"],
            "identity": p.payload, "assessment": record.payload, "review": review_payload(db, identity_id),
            "method": {"modelVersion": VERSION, "baseline": fit_baseline(observations(db, "reference")),
            "thresholds": {"low": [0, 24], "review": [25, 59], "high": [60, 100]}, "scoreIsProbability": False}}


@app.get("/identity-lens.js", include_in_schema=False)
def collector_script():
    return FileResponse(Path(__file__).parents[2] / "frontend/public/identity-lens.js", media_type="application/javascript")


@app.get("/docs", include_in_schema=False)
def api_reference():
    return FileResponse(Path(__file__).parents[2] / "frontend/public/api-reference.html")


@app.get("/api-reference.js", include_in_schema=False)
def reference_script():
    return FileResponse(Path(__file__).parents[2] / "frontend/public/api-reference.js", media_type="application/javascript")


@app.get("/api-reference.css", include_in_schema=False)
def reference_style():
    return FileResponse(Path(__file__).parents[2] / "frontend/public/api-reference.css", media_type="text/css")


dist = Path(__file__).parents[2] / "dist"
if dist.exists():
    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")


@app.get("/", include_in_schema=False)
def frontend_index():
    if not (dist / "index.html").exists():
        raise HTTPException(503, "Build the frontend before starting presentation mode.")
    return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sandbox", include_in_schema=False)
@app.get("/sandbox/", include_in_schema=False)
def sandbox_index():
    if not settings.enable_sandbox:
        raise HTTPException(404, "The sample sandbox is disabled.")
    return frontend_index()
