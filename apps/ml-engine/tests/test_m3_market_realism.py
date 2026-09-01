"""M3 tests: PIT universe membership, price policy, path labels, cost/imbalance gates."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.data import synthetic_candles
from app.dataset_quality import (
    DatasetQualityError,
    assert_dataset_quality,
    build_dataset_quality_report,
)
from app.eval_metrics import (
    assert_cost_aware_promote_ok,
    assert_imbalance_promote_ok,
    cost_aware_summary,
    imbalance_metrics,
)
from app.features import build_features, make_dataset
from app.historical_universe import (
    filter_times_by_membership,
    pit_violation_count,
    save_universe_snapshot,
)
from app.path_labels import assert_mfe_mae_consistency, path_label_frame
from app.price_policy import (
    CANONICAL_MODE,
    PRICE_POLICY_VERSION,
    PricePolicyError,
    assert_canonical_mode,
    ensure_adjusted_candles,
    read_mode_from_frame,
)


def test_pit_membership_filters_non_members(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config.settings, "models_dir", str(tmp_path))
    save_universe_snapshot(universe="nifty50", as_of="2022-01-01", symbols=["TCS", "INFY"])
    times = np.array(
        [
            int(pd.Timestamp("2022-06-01", tz="UTC").timestamp() * 1000),
            int(pd.Timestamp("2022-06-02", tz="UTC").timestamp() * 1000),
        ],
        dtype="int64",
    )
    ok = filter_times_by_membership(
        "TCS", times, universe="nifty50", fallback_symbols=["TCS", "INFY"]
    )
    assert all(ok)
    bad = filter_times_by_membership(
        "RELIANCE", times, universe="nifty50", fallback_symbols=["TCS", "INFY"]
    )
    assert not any(bad)
    assert (
        pit_violation_count(
            "RELIANCE", times, universe="nifty50", fallback_symbols=["TCS", "INFY"]
        )
        == 2
    )


def test_price_policy_stamps_adjusted_and_rejects_raw_mode():
    candles = synthetic_candles("HDFCBANK", 80)
    assert read_mode_from_frame(candles) == CANONICAL_MODE
    assert "close_adjusted" in candles.columns
    assert candles["close_adjusted"].notna().all()
    stamped = ensure_adjusted_candles(candles.copy(), symbol="HDFCBANK", synthetic=True)
    assert stamped.attrs.get("pricePolicyVersion") in (PRICE_POLICY_VERSION, None) or (
        "pricePolicyVersion" in stamped.columns
        and stamped["pricePolicyVersion"].iloc[0] == PRICE_POLICY_VERSION
    )
    with pytest.raises(PricePolicyError):
        assert_canonical_mode("RAW", context="test")


def test_mfe_mae_consistency_and_make_dataset_path_targets():
    candles = synthetic_candles("SBIN", 250)
    features = build_features(candles, {}, symbol="SBIN")
    paths = path_label_frame(features, 5)
    finite = paths.dropna()
    assert len(finite) > 50
    assert_mfe_mae_consistency(
        finite["forwardReturn"].to_numpy(),
        finite["maxFavorableExcursion"].to_numpy(),
        finite["maxAdverseExcursion"].to_numpy(),
    )
    x, y, fwd, times, path_targets = make_dataset(features, 5, 0.02)
    assert x.shape[0] == y.shape[0] == fwd.shape[0] == times.shape[0]
    assert path_targets["forwardReturn"].shape[0] == x.shape[0]
    assert_mfe_mae_consistency(
        path_targets["forwardReturn"],
        path_targets["maxFavorableExcursion"],
        path_targets["maxAdverseExcursion"],
    )


def test_cost_aware_and_imbalance_promote_gates():
    y_true = np.array([0, 0, 1, 1, 2, 2, 0, 2, 1, 0])
    y_pred = np.array([0, 1, 1, 1, 2, 2, 0, 2, 1, 0])
    metrics = imbalance_metrics(y_true, y_pred)
    assert "balancedAccuracy" in metrics
    assert_imbalance_promote_ok(metrics)

    sideways_only = imbalance_metrics(y_true, np.ones_like(y_true))
    with pytest.raises(ValueError, match="Imbalance"):
        assert_imbalance_promote_ok(sideways_only)

    good = cost_aware_summary(np.array([0.02, 0.015, 0.01, 0.03]))
    assert good["netPositive"] is True
    assert_cost_aware_promote_ok(good)

    bad = cost_aware_summary(np.array([-0.02, -0.01, -0.015]))
    assert bad["netPositive"] is False
    with pytest.raises(ValueError, match="Cost-aware"):
        assert_cost_aware_promote_ok(bad)


def test_dataset_quality_blocks_membership_and_price_mode():
    report = build_dataset_quality_report(
        x=np.ones((10, 3)),
        y=np.array([0, 1, 2, 0, 1, 2, 0, 1, 2, 1]),
        times=np.arange(10),
        pit_membership_violations=3,
        price_policy_mode=CANONICAL_MODE,
        price_policy_version=PRICE_POLICY_VERSION,
    )
    assert report["passed"] is False
    with pytest.raises(DatasetQualityError, match="membership"):
        assert_dataset_quality(report, context="m3")

    report2 = build_dataset_quality_report(
        x=np.ones((10, 3)),
        y=np.array([0, 1, 2, 0, 1, 2, 0, 1, 2, 1]),
        times=np.arange(10),
        price_policy_mode="RAW",
        price_policy_version=PRICE_POLICY_VERSION,
    )
    assert report2["passed"] is False
    with pytest.raises(DatasetQualityError):
        assert_dataset_quality(report2, context="price")
