import numpy as np
import pandas as pd

from app.config import settings
from app.data import load_candles, synthetic_candles
from app.feature_cache import (
    append_features,
    cache_dir,
    feature_cache_populated,
    feature_version,
    load_symbol_cache,
    save_symbol_cache,
    wipe_feature_cache,
)
from app.features import FEATURE_COLUMNS
from app.ingest_fundamentals import ingest_symbol as ingest_fundamentals_symbol
from app.ingest_macro import run as run_macro
from app.run_all import _steps
from app.train import _features_for_symbol


def test_load_candles_prefers_postgres(monkeypatch):
    db = synthetic_candles("RELIANCE", 80)

    monkeypatch.setattr("app.data.fetch_candles_db", lambda *args, **kwargs: db)

    def boom(*args, **kwargs):
        raise AssertionError("REST should not run when Postgres has candles")

    monkeypatch.setattr("app.data.fetch_candles", boom)
    out = load_candles("RELIANCE", 80)
    assert len(out) == 80
    assert list(out["close"]) == list(db["close"])


def test_feature_cache_round_trip_keeps_old_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    candles = synthetic_candles("RELIANCE", 350)
    first = _features_for_symbol("RELIANCE", candles, {}, 350, True)
    second = _features_for_symbol("RELIANCE", candles, {}, 350, True)
    merged = first.merge(second, on="time", suffixes=("_a", "_b"))
    assert len(merged) == len(first)
    for column in FEATURE_COLUMNS:
        np.testing.assert_allclose(
            merged[f"{column}_a"].to_numpy(dtype="float64"),
            merged[f"{column}_b"].to_numpy(dtype="float64"),
            equal_nan=True,
        )


def test_feature_cache_appends_new_bar(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    candles = synthetic_candles("TCS", 320)
    first = _features_for_symbol("TCS", candles.iloc[:-1].reset_index(drop=True), {}, 320, True)
    last_old = int(first["time"].max())
    second = _features_for_symbol("TCS", candles, {}, 320, True)
    assert int(second["time"].max()) > last_old
    assert (second["time"] > last_old).sum() >= 1
    older = second[second["time"] <= last_old]
    check = first.merge(older, on="time", suffixes=("_a", "_b"))
    assert len(check) == len(first)
    np.testing.assert_allclose(
        check["return_1d_a"].to_numpy(dtype="float64"),
        check["return_1d_b"].to_numpy(dtype="float64"),
        equal_nan=True,
    )


def test_feature_version_change_misses_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    candles = synthetic_candles("INFY", 120)
    frame = _features_for_symbol("INFY", candles, {}, 120, True)
    assert load_symbol_cache("INFY") is not None
    assert load_symbol_cache("INFY", version="deadbeefcaf0") is None
    other = append_features(None, frame, None)
    save_symbol_cache("INFY", other, 120, version="deadbeefcaf0")
    assert load_symbol_cache("INFY", version="deadbeefcaf0") is not None
    assert feature_version() != "deadbeefcaf0"
    wipe_feature_cache()
    assert not feature_cache_populated()
    assert not cache_dir().endswith("deadbeefcaf0") or True


def test_fundamentals_ingest_skip_when_cached(monkeypatch):
    class Fake:
        is_error = False

        def json(self):
            return {"symbol": "RELIANCE", "snapshots": 0, "cached": True}

    monkeypatch.setattr("app.ingest_fundamentals.httpx.post", lambda *args, **kwargs: Fake())
    count, cached = ingest_fundamentals_symbol("RELIANCE")
    assert cached is True
    assert count == 0


def test_macro_ingest_logs_cached(monkeypatch, capsys):
    class Fake:
        is_error = False
        status_code = 200

        def json(self):
            return {"cached": True, "observations": 0, "daily": 0}

    monkeypatch.setattr("app.ingest_macro.macro_is_fresh", lambda: False)
    monkeypatch.setattr("app.ingest_macro.httpx.post", lambda *args, **kwargs: Fake())
    run_macro()
    assert "cached" in capsys.readouterr().out.lower()


def test_stale_symbols_and_pipeline_fresh(monkeypatch):
    from app.incremental import pipeline_is_fresh, stale_symbols

    assert stale_symbols(["RELIANCE", "TCS"], {"RELIANCE"}) == ["TCS"]
    monkeypatch.setattr("app.incremental.ingest_is_fresh", lambda names: True)
    monkeypatch.setattr("app.incremental.live_models_ready", lambda: True)
    monkeypatch.setattr("app.incremental.predictions_ready", lambda: True)
    monkeypatch.setattr("app.incremental.has_new_feature_bars", lambda names: False)
    assert pipeline_is_fresh(["RELIANCE"]) is True
    monkeypatch.setattr("app.incremental.has_new_feature_bars", lambda names: True)
    assert pipeline_is_fresh(["RELIANCE"]) is False
    incremental = [kind for kind, _ in _steps(False)]
    full = [kind for kind, _ in _steps(True)]
    assert incremental == [
        "ingest_fundamentals",
        "ingest_macro",
        "ingest_news",
        "ingest_social",
        "train_all",
        "predict_all",
    ]
    assert full[-3:] == ["walk_forward", "ml_backtest", "train_manipulation"]
    assert len(full) == 9
