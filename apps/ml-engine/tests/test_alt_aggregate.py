from datetime import datetime, timedelta, timezone

from app.alt_aggregate import aggregate_social_daily
from app.nlp import score_headline


def test_social_spike_is_1d_over_20d_baseline():
    start = datetime(2024, 6, 1, tzinfo=timezone.utc)
    posts = []
    for day in range(20):
        posts.append(
            {
                "symbol": "ABC",
                "author": f"u{day}",
                "text": f"quiet day {day}",
                "available_at": start + timedelta(days=day),
                "sentiment": 0.0,
            }
        )
    burst = start + timedelta(days=19)
    for index in range(9):
        posts.append(
            {
                "symbol": "ABC",
                "author": f"bot{index % 2}",
                "text": "buy now buy now buy now",
                "available_at": burst,
                "sentiment": 0.8,
            }
        )
    rows = {row["asOfDate"]: row for row in aggregate_social_daily(posts)}
    last = rows[burst.replace(hour=0, minute=0, second=0).isoformat()]
    assert last["attentionSpike"] > 1.0
    assert last["coordination"] > 0.0
    assert last["mentions1d"] == 10.0


def test_score_headline_fields_are_json_safe():
    scored = score_headline("Company announces buyback after profit growth")
    assert scored["eventType"] in {"BUYBACK", "PROFIT_GROWTH"}
    assert -1.0 <= float(scored["sentiment"]) <= 1.0
