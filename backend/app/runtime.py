"""Bounded operational metadata logs. Never log inputs, tokens, account IDs or IPs."""
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import time
from uuid import uuid4
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse
from .config import settings

LOG_PATH = Path(__file__).resolve().parents[2] / ".local/logs/requests.jsonl"
log = logging.getLogger("identity_lens.requests")
log.setLevel(logging.INFO)
log.propagate = False


class PrivateRotatingFileHandler(RotatingFileHandler):
    def _open(self):
        descriptor = os.open(self.baseFilename, os.O_CREAT | os.O_APPEND | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, "a", encoding=self.encoding, errors=self.errors)


def start_logging():
    if log.handlers:
        return
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Exclusive initial creation; no permissive interval for a new private file.
    descriptor = os.open(LOG_PATH, os.O_CREAT | os.O_APPEND | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
    os.close(descriptor)
    os.chmod(LOG_PATH, 0o600)
    handler = PrivateRotatingFileHandler(LOG_PATH, maxBytes=1024 * 1024, backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(handler)


def install_runtime(app):
    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, error):
        # FastAPI's default response includes raw input; omit it for credentials/evidence.
        return JSONResponse({"detail": [{"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]} for item in error.errors()]}, status_code=422)

    @app.middleware("http")
    async def metadata(request, call_next):
        request_id = uuid4().hex
        started = time.perf_counter()
        error_type = None
        try:
            response = await call_next(request)
        except Exception as error:
            error_type = type(error).__name__
            response = JSONResponse({"detail": "Identity Lens could not complete this request. Try again or check the private server logs."}, status_code=503 if request.url.path == "/api/health" else 500)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        if settings.runtime_mode == "presentation":
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        route = request.scope.get("route")
        route_template = getattr(route, "path", "unmatched")
        event = {"timestamp": datetime.now(timezone.utc).isoformat(), "requestId": request_id, "method": request.method,
                 "route": route_template, "status": response.status_code, "durationMs": round((time.perf_counter() - started) * 1000, 2)}
        if error_type:
            event["errorType"] = error_type
        log.info(json.dumps(event, separators=(",", ":")))
        return response
