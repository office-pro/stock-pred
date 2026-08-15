from app.score import summarize


def test_summarize_hit_rate_and_calibration():
    outcomes = [
        {
            "horizon": "NEXT_DAY",
            "predicted": "BUY",
            "confidence": 60,
            "actualReturn": 0.02,
            "correct": True,
            "predictedAt": 1,
        },
        {
            "horizon": "NEXT_DAY",
            "predicted": "BUY",
            "confidence": 80,
            "actualReturn": -0.005,
            "correct": False,
            "predictedAt": 2,
        },
        {
            "horizon": "NEXT_DAY",
            "predicted": "SELL",
            "confidence": 70,
            "actualReturn": -0.03,
            "correct": True,
            "predictedAt": 3,
        },
        {
            "horizon": "NEXT_WEEK",
            "predicted": "HOLD",
            "confidence": 50,
            "actualReturn": 0.0,
            "correct": True,
            "predictedAt": 4,
        },
    ]
    summary = summarize(outcomes, "NEXT_DAY")
    assert summary["scoredCalls"] == 3
    assert summary["overallHitRate"] == 66.67
    assert summary["byAction"]["BUY"]["predicted"] == 2
    assert summary["byAction"]["BUY"]["correct"] == 1
    assert summary["byAction"]["SELL"]["hitRate"] == 100.0
    buckets = {item["label"]: item for item in summary["calibration"]}
    assert buckets["55-65"]["predicted"] == 1
    assert buckets["75+"]["predicted"] == 1
    assert summary["avgPnlPercent"] is not None
