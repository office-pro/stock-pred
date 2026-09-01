"""M1 trust tests: PIT enforcement, provenance TTL, registry, feature parity."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from app.pit import PitLeakageError, assert_no_pit_leakage, assert_panel_schema, find_pit_violations
from app.provenance import freshness_status, stamp_provenance
from app.registry import get_active, register_model


def test_pit_rejects_future_available_at():
    feature_ts = pd.to_datetime(["2024-08-20 10:00:00"], utc=True)
    # Earnings released after the feature bar — classic leakage.
    available_at = pd.to_datetime(["2024-08-20 16:05:00"], utc=True)
    violations = find_pit_violations(feature_ts, available_at, symbols=["TCS"])
    assert len(violations) == 1
    with pytest.raises(PitLeakageError, match="available_at"):
        assert_no_pit_leakage(feature_ts, available_at, symbols=["TCS"], context="earnings")


def test_pit_allows_known_at_or_before_bar():
    feature_ts = pd.to_datetime(["2024-08-20 10:00:00", "2024-08-21 10:00:00"], utc=True)
    available_at = pd.to_datetime(["2024-08-19 16:05:00", "2024-08-20 10:00:00"], utc=True)
    assert find_pit_violations(feature_ts, available_at) == []
    assert_no_pit_leakage(feature_ts, available_at, context="ok")


def test_panel_schema_requires_available_at():
    with pytest.raises(PitLeakageError, match="available_at"):
        assert_panel_schema(pd.DataFrame({"symbol": ["TCS"], "value": [1.0]}), context="news")


def test_provenance_ttl_marks_stale(monkeypatch):
    payload = {"symbol": "INFY", "horizon": "NEXT_DAY", "direction": "UP", "confidence": 80}
    now = datetime(2026, 8, 23, 4, 0, 0, tzinfo=timezone.utc)
    stamp_provenance(
        payload,
        model_version="ensemble-v1",
        feature_version="features.v1.4",
        dataset_version="dataset.v1",
        source_data_timestamp=now.timestamp() * 1000,
        prediction_timestamp=now,
        ttl_seconds=60,
    )
    assert payload["expiresAt"].endswith("Z")
    assert payload["featureVersion"] == "features.v1.4"
    assert freshness_status(payload, now=now) == "fresh"
    assert freshness_status(payload, now=now + timedelta(seconds=61)) == "stale"


def test_registry_activate_and_lookup(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config.settings, "models_dir", str(tmp_path))
    first = register_model(
        horizon="NEXT_DAY",
        model_version="v1",
        feature_version="features.v1.4",
        dataset_version="dataset.v1",
        activate=True,
        artifact_dir=str(tmp_path / "NEXT_DAY"),
    )
    second = register_model(
        horizon="NEXT_DAY",
        model_version="v2",
        feature_version="features.v1.4",
        dataset_version="dataset.v1",
        activate=True,
        artifact_dir=str(tmp_path / "NEXT_DAY"),
    )
    active = get_active("NEXT_DAY")
    assert active is not None
    assert active["modelId"] == second["modelId"]
    assert active["modelVersion"] == "v2"
    assert first["modelId"] != second["modelId"]
    assert (tmp_path / "registry" / "models.json").exists()


def test_feature_set_version_constant():
    from app.features import FEATURE_SET_VERSION

    assert isinstance(FEATURE_SET_VERSION, str)
    assert FEATURE_SET_VERSION.startswith("features.")
