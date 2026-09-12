"""File-backed model registry (M1 + M2 promotion).

M1 stamps versions. M2 adds explicit promote_model() after walk-forward
stability + calibration gates. Training registers candidates only.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .config import settings

_lock = threading.Lock()


def _registry_dir() -> str:
    path = os.path.join(settings.models_dir, "registry")
    os.makedirs(path, exist_ok=True)
    return path


def _registry_path() -> str:
    return os.path.join(_registry_dir(), "models.json")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _load() -> Dict[str, Any]:
    path = _registry_path()
    if not os.path.exists(path):
        return {"schemaVersion": "ml-registry.v1", "models": [], "active": {}}
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {"schemaVersion": "ml-registry.v1", "models": [], "active": {}}
    payload.setdefault("schemaVersion", "ml-registry.v1")
    payload.setdefault("models", [])
    payload.setdefault("active", {})
    return payload


def _save(payload: Dict[str, Any]) -> None:
    path = _registry_path()
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp, path)


def register_model(
    *,
    horizon: str,
    model_version: str,
    feature_version: str,
    dataset_version: str,
    model_id: Optional[str] = None,
    algorithm: str = "ensemble-trees",
    training_window: Optional[Dict[str, Any]] = None,
    metrics: Optional[Dict[str, Any]] = None,
    status: str = "candidate",
    activate: bool = False,
    artifact_dir: Optional[str] = None,
    calibration: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append a registry entry. Default is candidate (not served)."""
    entry = {
        "modelId": model_id or str(uuid.uuid4()),
        "modelVersion": model_version,
        "featureVersion": feature_version,
        "datasetVersion": dataset_version,
        "horizon": horizon,
        "algorithm": algorithm,
        "trainingWindow": training_window or {},
        "metrics": metrics or {},
        "calibration": calibration or {},
        "status": "active" if activate else status,
        "active": bool(activate),
        "artifactDir": artifact_dir,
        "createdAt": _utc_now(),
    }
    with _lock:
        payload = _load()
        if activate:
            _retire_active(payload, horizon)
            payload["active"][horizon] = entry["modelId"]
            entry["active"] = True
            entry["status"] = "active"
        payload["models"].append(entry)
        _save(payload)
    return entry


def _retire_active(payload: Dict[str, Any], horizon: str) -> None:
    for existing in payload["models"]:
        if existing.get("horizon") == horizon and existing.get("active"):
            existing["active"] = False
            if existing.get("status") == "active":
                existing["status"] = "retired"


def get_active(horizon: str) -> Optional[Dict[str, Any]]:
    with _lock:
        payload = _load()
        model_id = payload.get("active", {}).get(horizon)
        if not model_id:
            for entry in reversed(payload.get("models", [])):
                if entry.get("horizon") == horizon and entry.get("active"):
                    return entry
            return None
        for entry in payload.get("models", []):
            if entry.get("modelId") == model_id:
                return entry
    return None


def get_model(model_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        payload = _load()
        for entry in payload.get("models", []):
            if entry.get("modelId") == model_id:
                return entry
    return None


def list_models(horizon: Optional[str] = None) -> List[Dict[str, Any]]:
    with _lock:
        payload = _load()
        rows = list(payload.get("models", []))
    if horizon:
        rows = [row for row in rows if row.get("horizon") == horizon]
    return rows


def latest_candidate(horizon: str) -> Optional[Dict[str, Any]]:
    for entry in reversed(list_models(horizon)):
        if entry.get("status") == "candidate" or (
            not entry.get("active") and entry.get("status") != "retired"
        ):
            return entry
    return None


def promote_model(
    model_id: str,
    *,
    walkforward: Dict[str, Any],
    calibration: Optional[Dict[str, Any]] = None,
    dataset_quality: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Promote a candidate to active after M2 gates already validated by caller."""
    with _lock:
        payload = _load()
        target = None
        for entry in payload["models"]:
            if entry.get("modelId") == model_id:
                target = entry
                break
        if target is None:
            raise KeyError(f"modelId not found: {model_id}")
        horizon = str(target["horizon"])
        _retire_active(payload, horizon)
        target["active"] = True
        target["status"] = "active"
        target["promotedAt"] = _utc_now()
        metrics = dict(target.get("metrics") or {})
        metrics["walkforward"] = walkforward
        if dataset_quality is not None:
            metrics["datasetQuality"] = dataset_quality
        target["metrics"] = metrics
        if calibration is not None:
            target["calibration"] = {
                "method": calibration.get("method"),
                "metrics": calibration.get("metrics"),
                "disclaimer": calibration.get("disclaimer"),
            }
        payload["active"][horizon] = model_id
        _save(payload)
        return dict(target)
