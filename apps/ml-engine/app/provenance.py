"""Prediction provenance + freshness helpers (M1)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

# Default TTL: 6h — daily models must not drive overnight-stale decisions silently.
DEFAULT_PREDICTION_TTL_SECONDS = int(os.getenv("ML_PREDICTION_TTL_SECONDS", "21600"))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp_provenance(
    prediction: Dict[str, Any],
    *,
    model_version: str,
    feature_version: str,
    dataset_version: str,
    source_data_timestamp: Optional[Any] = None,
    prediction_timestamp: Optional[datetime] = None,
    ttl_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    """Attach immutable provenance fields to a prediction dict (in place + return)."""
    now = prediction_timestamp or _utc_now()
    ttl = DEFAULT_PREDICTION_TTL_SECONDS if ttl_seconds is None else int(ttl_seconds)
    expires = now + timedelta(seconds=max(1, ttl))

    source_iso: Optional[str]
    if source_data_timestamp is None:
        source_iso = None
    elif isinstance(source_data_timestamp, datetime):
        source_iso = _iso(source_data_timestamp)
    elif isinstance(source_data_timestamp, (int, float)):
        # epoch ms or seconds
        value = float(source_data_timestamp)
        if value > 1e12:
            source_iso = _iso(datetime.fromtimestamp(value / 1000.0, tz=timezone.utc))
        else:
            source_iso = _iso(datetime.fromtimestamp(value, tz=timezone.utc))
    else:
        source_iso = str(source_data_timestamp)

    prediction["predictionTimestamp"] = _iso(now)
    prediction["sourceDataTimestamp"] = source_iso
    prediction["expiresAt"] = _iso(expires)
    prediction["modelVersion"] = model_version
    prediction["featureVersion"] = feature_version
    prediction["datasetVersion"] = dataset_version
    prediction["freshnessStatus"] = "fresh"
    return prediction


def freshness_status(
    prediction: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
) -> str:
    """Return fresh | stale | missing based on expiresAt."""
    expires_raw = prediction.get("expiresAt")
    if not expires_raw:
        return "missing"
    try:
        expires = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
    except ValueError:
        return "missing"
    current = now or _utc_now()
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return "fresh" if current <= expires else "stale"
