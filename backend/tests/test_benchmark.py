from backend.app.benchmark import benchmark, confusion


def test_synthetic_evaluation_reports_real_counts_and_limitations():
    result = benchmark()
    assert result["referenceCount"] == 240
    assert result["cohortCount"] == 240
    assert result["knownLabelCount"] + result["ambiguousCount"] == 240
    assert sum(result["ambiguousBands"].values()) == result["ambiguousCount"]
    assert result["syntheticOnly"] and not result["realWorldAccuracyEstablished"]
    assert len(result["experiments"]) == 6
    for experiment in result["experiments"]:
        assert sum(experiment[k] for k in ("tp", "fp", "fn", "tn")) == result["knownLabelCount"]
        for metric in ("precision", "recall", "falsePositiveRate"):
            assert experiment[metric] is None or 0 <= experiment[metric] <= 1
    assert any("already been inspected" in limit for limit in result["limitations"])


def test_no_predictions_does_not_claim_perfect_precision_and_ambiguity_is_excluded():
    result = confusion({"L": False, "F": False, "A": True}, {"L": "legitimate", "F": "suspicious", "A": "ambiguous"})
    assert result == {"tp": 0, "fp": 0, "fn": 1, "tn": 1, "evaluated": 2, "precision": None, "recall": 0, "falsePositiveRate": 0}
