import json
from pathlib import Path
import pytest
from backend.app.engine import assess, fit_baseline, evaluate, registration_burst, robust_distance

DATA = json.loads((Path(__file__).parents[1] / "data/seed.json").read_text())
PARITY = json.loads((Path(__file__).parents[1] / "data/parity.json").read_text())


@pytest.mark.parametrize("cohort,fixtures", [(DATA["world"]["population"], PARITY["assessments"]), (DATA["holdout"]["population"], PARITY["holdoutAssessments"])])
def test_python_policy_matches_original_for_every_case(cohort, fixtures):
    baseline = fit_baseline(DATA["references"])
    for p, original in zip(cohort, fixtures):
        r = assess(p, cohort, baseline)
        for key in ("id", "score", "band", "groups", "links", "burst", "explanation", "mitigations"):
            assert r[key] == original[key], (p["id"], key)
        assert [(i["id"], i["points"]) for i in r["indicators"]] == [(i["id"], i["points"]) for i in original["indicators"]]
        assert r["anomaly"]["distance"] == pytest.approx(original["anomaly"]["distance"])


def test_metrics_match_original_and_labels_never_affect_scores():
    baseline = fit_baseline(DATA["references"])
    assert evaluate(DATA["holdout"]["population"], DATA["holdout"]["truth"], baseline) == PARITY["metrics"]
    p = DATA["world"]["population"][2]
    assert assess({**p, "truth": "legitimate", "displayName": "Safe"}, DATA["world"]["population"], baseline)["score"] == 100


def test_sensitivity_applies_caps_without_mutating_case():
    population = DATA["world"]["population"]
    p = population[2]
    before = json.dumps(p)
    baseline = fit_baseline(DATA["references"])
    assert assess(p, population, baseline, ["unverified-phone"])["groups"][0]["score"] == 25
    ids = [i["id"] for i in assess(p, population, baseline)["indicators"]]
    assert assess(p, population, baseline, ids)["score"] == 0
    assert json.dumps(p) == before


def test_zero_dispersion_and_missing_observations():
    assert robust_distance(40, {"median": 10, "mad": 0}, 15) == 2
    with pytest.raises(ValueError, match="observation"):
        assess({"events": []}, [], {})
