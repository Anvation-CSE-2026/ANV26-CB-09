import json
from pathlib import Path
from sqlalchemy import select, func, text
from .database import Identity, Observation, EntityLink, Assessment, Review, EvaluationLabel, SessionLocal
from .engine import assess, fit_baseline, VERSION

DATA = json.loads((Path(__file__).parents[1] / "data/seed.json").read_text())


def seed_database():
    with SessionLocal.begin() as db:
        db.execute(text("SELECT pg_advisory_xact_lock(2404)"))
        if db.scalar(select(func.count()).select_from(Identity)):
            return
        for cohort, population in [("observed", DATA["world"]["population"]), ("reference", DATA["references"]), ("holdout", DATA["holdout"]["population"])]:
            for p in population:
                # Source evidence lives in PostgreSQL; the JSON snapshot remains reproducible.
                db.add(Identity(id=p["id"], cohort=cohort, payload=p))
        db.flush()
        for cohort, population in [("observed", DATA["world"]["population"]), ("reference", DATA["references"]), ("holdout", DATA["holdout"]["population"])]:
            for p in population:
                for e in p["events"]:
                    db.add(Observation(id=e["id"], identity_id=p["id"], device_token=e["deviceId"], timestamp=e["timestamp"], payload=e))
                for kind, tokens in [("device", set(e["deviceId"] for e in p["events"])), ("phone", {p["phoneToken"]}), ("address", {p["addressToken"]})]:
                    for token in tokens:
                        db.add(EntityLink(identity_id=p["id"], kind=kind, token=token))
                if cohort == "observed":
                    db.add(Review(identity_id=p["id"]))
                if cohort == "holdout":
                    db.add(EvaluationLabel(identity_id=p["id"], label=DATA["holdout"]["truth"][p["id"]]))
        baseline = fit_baseline(DATA["references"])
        for p in DATA["world"]["population"]:
            db.add(Assessment(identity_id=p["id"], version=VERSION, payload=assess(p, DATA["world"]["population"], baseline)))


def observations(db, cohort="observed"):
    # Order matches the original seeded population for stable evidence ordering.
    rows = {r.id: r.payload for r in db.scalars(select(Identity).where(Identity.cohort == cohort))}
    source = DATA["world"]["population"] if cohort == "observed" else DATA["references"] if cohort == "reference" else DATA["holdout"]["population"]
    source_ids = {p["id"] for p in source}
    return [rows[p["id"]] for p in source if p["id"] in rows] + [rows[id] for id in sorted(rows) if id not in source_ids]


def ensure_current_assessments():
    with SessionLocal.begin() as db:
        db.execute(text("SELECT pg_advisory_xact_lock(2404)"))
        population = observations(db)
        baseline = fit_baseline(observations(db, "reference"))
        existing = set(db.scalars(select(Assessment.identity_id).where(Assessment.version == VERSION)))
        for p in population:
            if p["id"] not in existing:
                db.add(Assessment(identity_id=p["id"], version=VERSION, payload=assess(p, population, baseline)))
