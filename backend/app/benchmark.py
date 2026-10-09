"""Controlled synthetic evaluation. Labels are used only after scoring."""
from functools import lru_cache
from .seed import DATA
from .engine import assess, fit_baseline, GROUPS, VERSION


def confusion(predictions, truth):
    known = [id for id, label in truth.items() if label in ("legitimate", "suspicious")]
    tp = sum(predictions[id] and truth[id] == "suspicious" for id in known)
    fp = sum(predictions[id] and truth[id] == "legitimate" for id in known)
    fn = sum(not predictions[id] and truth[id] == "suspicious" for id in known)
    tn = sum(not predictions[id] and truth[id] == "legitimate" for id in known)
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "evaluated": len(known),
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "falsePositiveRate": fp / (fp + tn) if fp + tn else None}


@lru_cache(maxsize=1)
def benchmark():
    population, truth = DATA["holdout"]["population"], DATA["holdout"]["truth"]
    baseline = fit_baseline(DATA["references"])
    assessments = {p["id"]: assess(p, population, baseline) for p in population}
    experiments = [{"name": "Full scoring policy", "predictions": {id: r["score"] >= 60 for id, r in assessments.items()}}]
    naive = {p["id"]: any(len({r[k] for r in p["profileRecords"] if r.get(k) is not None}) > 1 for k in ("birthYear", "declaredRegion")) for p in population}
    experiments.append({"name": "Profile-conflict baseline", "predictions": naive})
    for group in GROUPS:
        predictions = {id: sum(g["score"] for g in result["groups"] if g["key"] != group["key"]) >= 60 for id, result in assessments.items()}
        experiments.append({"name": "Without " + group["label"], "predictions": predictions})
    rows = [{"name": e["name"], **confusion(e["predictions"], truth)} for e in experiments]
    ambiguous = [id for id, label in truth.items() if label == "ambiguous"]
    return {"policyVersion": VERSION, "referenceCount": len(DATA["references"]), "cohortCount": len(population),
            "knownLabelCount": rows[0]["evaluated"], "ambiguousCount": len(ambiguous), "threshold": 60, "experiments": rows,
            "ambiguousBands": {band: sum(assessments[id]["band"] == band for id in ambiguous) for band in ("Low", "Review", "High")},
            "syntheticOnly": True, "realWorldAccuracyEstablished": False,
            "method": "Reference fitting excludes evaluation cases. Binary precision/recall uses legitimate and suspicious generator labels only; ambiguous cases are reported separately. A scoring-group ablation removes one group's contribution while keeping the same observations and threshold.",
            "limitations": ["Generator and policy share assumptions.", "This evaluation cohort has already been inspected and used for regression.", "Policy weights are manually chosen.", "Results do not establish performance on real applicants."]}
