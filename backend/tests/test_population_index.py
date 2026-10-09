import copy
import pytest
from backend.tests.test_engine import DATA
from backend.app.engine import PopulationIndex, assess, fit_baseline, shared_entities, registration_burst


@pytest.mark.parametrize("cohort", [DATA["world"]["population"], DATA["holdout"]["population"]])
def test_index_preserves_every_assessment_field(cohort):
    baseline = fit_baseline(DATA["references"])
    index = PopulationIndex(cohort)
    for p in cohort:
        assert assess(p, cohort, baseline, index=index) == assess(p, cohort, baseline)


def test_index_uses_exact_tokens_and_never_propagates_labels():
    population = copy.deepcopy(DATA["world"]["population"][:3])
    p = population[0]
    population[1]["events"] = copy.deepcopy(p["events"])
    population[1]["phoneToken"] = p["phoneToken"]
    population[1]["truth"] = "fraud"
    index = PopulationIndex(population)
    assert shared_entities(p, population, index) == shared_entities(p, population)
    assert registration_burst(p, population, index) == registration_burst(p, population)
    population[1]["events"][0]["deviceId"] += "-DIFFERENT"
    refreshed = PopulationIndex(population)
    assert shared_entities(p, population, refreshed) == shared_entities(p, population)
    assert not hasattr(index, "truth")


def test_batch_preparation_preserves_source_records_and_missingness():
    from backend.tests.test_challenges import case
    from backend.app.evidence import normalise, calculate
    rows = [case("INDEX-A", shared=True), case("INDEX-B", offset=2, shared=True), case("INDEX-C", sparse=True)]
    normalised = [normalise(row) for row in rows]
    prepared = (normalised, PopulationIndex(normalised))
    for row in rows:
        assert calculate(row, rows, prepared=prepared) == calculate(row, rows)
