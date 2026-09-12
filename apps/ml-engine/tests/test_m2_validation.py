"""M2 tests: dataset quality, candidate lifecycle, WF stability, calibration."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest

from app.calibration import (
    DISCLAIMER,
    apply_calibrator,
    fit_multiclass_calibrator,
    probabilities_to_dict,
)
from app.dataset_quality import (
    DatasetQualityError,
    assert_dataset_quality,
    build_dataset_quality_report,
)
from app.promote_gates import (
    assert_walkforward_promotable,
    summarize_walkforward_stability,
)
from app.registry import get_active, latest_candidate, promote_model, register_model


def test_dataset_quality_blocks_empty():
    report = build_dataset_quality_report(
        x=np.zeros((0, 3)),
        y=np.array([], dtype=int),
        times=np.array([], dtype=int),
    )
    assert report["passed"] is False
    with pytest.raises(DatasetQualityError):
        assert_dataset_quality(report, context="test")


def test_dataset_quality_blocks_pit_violations():
    feature_ts = [datetime(2024, 8, 20, 10, 0, tzinfo=timezone.utc)]
    available = [datetime(2024, 8, 20, 16, 5, tzinfo=timezone.utc)]
    report = build_dataset_quality_report(
        x=np.ones((1, 2)),
        y=np.array([1]),
        times=np.array([1]),
        pit_feature_timestamps=feature_ts,
        pit_available_at=available,
        pit_symbols=["TCS"],
    )
    assert report["pitViolations"] >= 1
    assert report["passed"] is False
    with pytest.raises(DatasetQualityError, match="pit"):
        assert_dataset_quality(report, context="pit")


def test_register_candidate_not_active(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config.settings, "models_dir", str(tmp_path))
    entry = register_model(
        horizon="NEXT_DAY",
        model_version="v-test",
        feature_version="features.v1.4",
        dataset_version="dataset.v1",
        activate=False,
        artifact_dir=str(tmp_path / "NEXT_DAY"),
    )
    assert entry["active"] is False
    assert entry["status"] == "candidate"
    assert get_active("NEXT_DAY") is None
    assert latest_candidate("NEXT_DAY")["modelId"] == entry["modelId"]


def test_unstable_walkforward_blocks_promotion():
    report = summarize_walkforward_stability(
        {
            "horizon": "NEXT_DAY",
            "folds": [
                {"overallHitRate": 80},
                {"overallHitRate": 15},
                {"overallHitRate": 78},
                {"overallHitRate": 12},
                {"overallHitRate": 70},
            ],
        }
    )
    assert report["stability"]["passed"] is False
    with pytest.raises(ValueError, match="Walk-forward"):
        assert_walkforward_promotable(report)


def test_stable_walkforward_and_calibration_promote(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config.settings, "models_dir", str(tmp_path))
    entry = register_model(
        horizon="NEXT_WEEK",
        model_version="v-stable",
        feature_version="features.v1.4",
        dataset_version="dataset.v1",
        activate=False,
        artifact_dir=str(tmp_path / "NEXT_WEEK"),
    )
    wf = summarize_walkforward_stability(
        {
            "horizon": "NEXT_WEEK",
            "folds": [
                {"overallHitRate": 42},
                {"overallHitRate": 41},
                {"overallHitRate": 40},
                {"overallHitRate": 39},
                {"overallHitRate": 43},
            ],
        }
    )
    assert_walkforward_promotable(wf)

    rng = np.random.default_rng(1)
    raw = rng.dirichlet([2, 2, 2], size=150)
    y = raw.argmax(axis=1)
    calibrator = fit_multiclass_calibrator(y, raw)
    assert "brierCalibrated" in calibrator["metrics"]
    assert DISCLAIMER.lower().find("calibrated") >= 0

    promoted = promote_model(
        entry["modelId"],
        walkforward={"stability": wf["stability"]},
        calibration=calibrator,
        dataset_quality={"passed": True, "rows": 150},
    )
    assert promoted["active"] is True
    assert promoted["status"] == "active"
    active = get_active("NEXT_WEEK")
    assert active is not None
    assert active["modelId"] == entry["modelId"]
    assert active["calibration"].get("method")


def test_calibrated_probabilities_served():
    rng = np.random.default_rng(2)
    raw = rng.dirichlet([1, 1, 1], size=100)
    y = raw.argmax(axis=1)
    calibrator = fit_multiclass_calibrator(y, raw)
    out = apply_calibrator(raw[:1], calibrator)
    assert out.shape == (1, 3)
    assert abs(float(out.sum()) - 1.0) < 1e-6
    as_dict = probabilities_to_dict(out[0])
    assert set(as_dict) == {"DOWN", "SIDEWAYS", "UP"}
