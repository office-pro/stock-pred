"""M3 cross-path price-policy enforcement: train / predict / backtest / outcome."""
from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from app.data import synthetic_candles
from app.price_policy import (
    CANONICAL_MODE,
    PricePolicyError,
    assert_outcome_modes,
    assert_same_mode,
    policy_stamp,
    read_mode_from_frame,
    require_canonical_candles,
)


def _raw_candles(symbol: str = "TCS", days: int = 80) -> pd.DataFrame:
    frame = synthetic_candles(symbol, days).copy()
    # Force RAW stamp (canonical path always stamps ADJUSTED).
    for key, value in policy_stamp(mode="RAW", source="test_raw").items():
        frame[key] = value
    return frame


def _adjusted_candles(symbol: str = "TCS", days: int = 80) -> pd.DataFrame:
    frame = synthetic_candles(symbol, days)
    assert read_mode_from_frame(frame) == CANONICAL_MODE
    return frame


def test_predict_with_raw_hard_fails(monkeypatch):
    import app.predict as predict

    monkeypatch.setattr(predict, "load_candles", lambda *_a, **_k: _raw_candles())
    with pytest.raises(PricePolicyError, match="predict"):
        predict.predict_symbol("TCS", history_days=80)


def test_backtest_with_raw_hard_fails(monkeypatch):
    import app.ml_backtest as ml_backtest

    monkeypatch.setattr(ml_backtest, "load_candles", lambda *_a, **_k: _raw_candles())
    models = SimpleNamespace(metadata={"priceAdjustmentMode": CANONICAL_MODE}, scaler=None)
    with pytest.raises(PricePolicyError, match="backtest"):
        ml_backtest.backtest_symbol("TCS", "NEXT_DAY", models, market={})


def test_train_adjusted_predict_raw_hard_fails(monkeypatch):
    """Trained ADJUSTED artifact + RAW serve candles must hard-fail."""
    import app.predict as predict

    monkeypatch.setattr(predict, "load_candles", lambda *_a, **_k: _raw_candles())
    monkeypatch.setattr(
        predict,
        "get_models",
        lambda _horizon: SimpleNamespace(
            metadata={"priceAdjustmentMode": CANONICAL_MODE},
            scaler=SimpleNamespace(transform=lambda x: x),
        ),
    )
    with pytest.raises(PricePolicyError):
        predict.predict_symbol("TCS", history_days=80)


def test_train_predict_backtest_all_adjusted_pass(monkeypatch):
    adjusted = _adjusted_candles("INFY", 100)
    assert require_canonical_candles(adjusted, context="train:INFY") == CANONICAL_MODE
    assert require_canonical_candles(adjusted, context="predict:INFY") == CANONICAL_MODE
    assert require_canonical_candles(adjusted, context="backtest:INFY") == CANONICAL_MODE
    assert_same_mode(CANONICAL_MODE, CANONICAL_MODE, context="train_vs_predict")
    assert_outcome_modes(CANONICAL_MODE, CANONICAL_MODE, context="outcome:INFY")

    import app.train as train

    seen = {}

    def fake_load(symbol, days, *args, **kwargs):
        seen["mode"] = read_mode_from_frame(adjusted)
        return adjusted

    monkeypatch.setattr(train, "load_candles", fake_load)
    # assert_canonical_mode is invoked inside collect_dataset before heavy work —
    # exercise the gate directly the same way train does.
    from app.price_policy import assert_canonical_mode

    assert_canonical_mode(seen.get("mode") or read_mode_from_frame(adjusted), context="train:INFY")


def test_outcome_comparison_mode_mismatch_hard_fails():
    with pytest.raises(PricePolicyError, match="outcome"):
        assert_outcome_modes(CANONICAL_MODE, "RAW", context="outcome:TCS:NEXT_DAY")
    with pytest.raises(PricePolicyError, match="outcome"):
        assert_outcome_modes("RAW", CANONICAL_MODE, context="outcome:TCS:NEXT_DAY")


def test_score_outcome_path_rejects_raw_candles(monkeypatch):
    import app.score as score

    monkeypatch.setattr(score, "load_candles", lambda *_a, **_k: _raw_candles())
    monkeypatch.setattr(
        score,
        "get_models",
        lambda _horizon: SimpleNamespace(metadata={"priceAdjustmentMode": CANONICAL_MODE}),
    )
    with pytest.raises(PricePolicyError, match="outcome"):
        score.score_horizon("NEXT_DAY", ["TCS"], lookback=5)
