from __future__ import annotations

import json
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.config import CORE_HORIZONS
from app.features import FEATURE_COLUMNS, FEATURE_SET_VERSION


def _artifact(directory):
    directory.mkdir(parents=True)
    (directory / "metadata.json").write_text(
        json.dumps({"feature_version": FEATURE_SET_VERSION, "model_version": "t"}),
        encoding="utf-8",
    )
    (directory / "xgboost.json").write_text("{}", encoding="utf-8")
    (directory / "lightgbm.txt").write_text("", encoding="utf-8")


def test_no_active_get_models_raises(tmp_path, monkeypatch):
    import app.predict as predict

    monkeypatch.setattr(predict.settings, "models_dir", str(tmp_path))
    predict.clear_model_cache()
    with pytest.raises(FileNotFoundError, match="No ACTIVE"):
        predict.get_models("NEXT_DAY")


def test_candidate_is_never_served(tmp_path, monkeypatch):
    import app.predict as predict
    from app.registry import register_model

    monkeypatch.setattr(predict.settings, "models_dir", str(tmp_path))
    artifact_dir = tmp_path / "NEXT_DAY" / "candidates" / "candidate"
    _artifact(artifact_dir)
    register_model(
        model_id="candidate",
        horizon="NEXT_DAY",
        model_version="t",
        feature_version=FEATURE_SET_VERSION,
        dataset_version="d",
        artifact_dir=str(artifact_dir),
    )
    predict.clear_model_cache()
    with pytest.raises(FileNotFoundError, match="No ACTIVE"):
        predict.get_models("NEXT_DAY")
    assert predict.models_available() is False


def test_promoted_registry_artifact_is_loaded(tmp_path, monkeypatch):
    import app.predict as predict
    from app.registry import promote_model, register_model

    monkeypatch.setattr(predict.settings, "models_dir", str(tmp_path))
    artifact_dir = tmp_path / "NEXT_DAY" / "candidates" / "promoted"
    _artifact(artifact_dir)
    entry = register_model(
        model_id="promoted",
        horizon="NEXT_DAY",
        model_version="t",
        feature_version=FEATURE_SET_VERSION,
        dataset_version="d",
        artifact_dir=str(artifact_dir),
    )
    promote_model(entry["modelId"], walkforward={})

    class StubModels:
        def __init__(self, horizon, resolved_dir, registry_entry):
            self.horizon = horizon
            self.artifact_dir = resolved_dir
            self.model_id = registry_entry["modelId"]

    monkeypatch.setattr(predict, "HorizonModels", StubModels)
    predict.clear_model_cache()
    loaded = predict.get_models("NEXT_DAY")
    assert loaded.model_id == "promoted"
    assert loaded.artifact_dir == str(artifact_dir)


def test_drift_outcomes_below_minimum_are_insufficient(tmp_path, monkeypatch):
    from app.drift import assess_drift
    from app.config import settings

    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    monkeypatch.setenv("ML_DRIFT_MIN_OUTCOMES", "50")
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir()
    (artifact_dir / "feature-baseline.json").write_text(
        json.dumps(
            {
                "schemaVersion": "feature-baseline.v1",
                "featureNames": ["a", "b"],
                "mean": [0.0, 0.0],
                "std": [1.0, 1.0],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "outcomes.json").write_text(
        json.dumps([{"horizon": "NEXT_DAY", "actualReturn": 0.02}]),
        encoding="utf-8",
    )
    report = assess_drift("NEXT_DAY", str(artifact_dir), np.array([0.0, 0.0]))
    assert report["status"] == "insufficient_data"
    assert report["calibrationDrift"]["status"] == "insufficient_data"
    assert report["calibrationDrift"]["brier"] is None


def test_high_feature_shift_wins_over_insufficient_outcomes(tmp_path, monkeypatch):
    from app.config import settings
    from app.drift import assess_drift

    monkeypatch.setattr(settings, "models_dir", str(tmp_path))
    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir()
    (artifact_dir / "feature-baseline.json").write_text(
        json.dumps(
            {
                "schemaVersion": "feature-baseline.v1",
                "featureNames": ["a", "b"],
                "mean": [0.0, 0.0],
                "std": [1.0, 1.0],
            }
        ),
        encoding="utf-8",
    )
    report = assess_drift("NEXT_DAY", str(artifact_dir), np.array([20.0, 20.0]))
    assert report["status"] == "incompatible"
    assert report["featureDrift"]["status"] == "incompatible"


def test_prediction_stamps_active_model_id(tmp_path, monkeypatch):
    import app.predict as predict
    from app.price_policy import CANONICAL_MODE

    feature_frame = pd.DataFrame(
        np.zeros((30, len(FEATURE_COLUMNS))), columns=FEATURE_COLUMNS
    )
    feature_frame["time"] = np.arange(30) * 86_400_000
    candle_frame = pd.DataFrame(
        {
            "close": [100.0],
            "time": [feature_frame["time"].iloc[-1]],
            "priceAdjustmentMode": [CANONICAL_MODE],
        }
    )
    models = SimpleNamespace(
        model_id="active-id",
        artifact_dir=str(tmp_path),
        registry_entry={"modelId": "active-id"},
        metadata={
            "feature_version": FEATURE_SET_VERSION,
            "model_version": "t",
            "dataset_version": "d",
            "class_moves": {},
            "priceAdjustmentMode": CANONICAL_MODE,
        },
        scaler=SimpleNamespace(transform=lambda matrix: matrix),
        calibrator=None,
        path_regressors={},
        probabilities=lambda _matrix: {
            "xgboost": np.array([[0.2, 0.3, 0.5]]),
            "lightgbm": np.array([[0.2, 0.3, 0.5]]),
            "lstm": None,
            "transformer": None,
        },
    )
    monkeypatch.setattr(predict, "HORIZONS", {"NEXT_DAY": {"bars": 1, "threshold": 0.01}})
    monkeypatch.setattr(predict, "load_candles", lambda *_args, **_kwargs: candle_frame)
    monkeypatch.setattr(predict, "load_market_context", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(predict, "attach_alt_data", lambda value: value)
    monkeypatch.setattr(predict, "build_features", lambda *_args, **_kwargs: feature_frame)
    monkeypatch.setattr(predict, "get_models", lambda _horizon: models)
    monkeypatch.setattr(
        predict,
        "assess_drift",
        lambda *_args, **_kwargs: {"status": "insufficient_data"},
    )
    payload = predict.predict_symbol("TCS")[0]
    assert payload["modelId"] == "active-id"
    assert payload["driftStatus"] == "insufficient_data"
    assert payload["confidence"] == 50.0
    assert payload["calibratedProbabilities"] is None
