"""Per-symbol parquet feature cache keyed by FEATURE_COLUMNS hash."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from typing import Dict, List, Optional

import pandas as pd

from .config import settings
from .features import FEATURE_COLUMNS

WARMUP_BARS = 200
CACHE_COLUMNS: List[str] = ["time", "close", *FEATURE_COLUMNS]


def feature_version(columns: Optional[List[str]] = None) -> str:
    payload = "|".join(columns if columns is not None else FEATURE_COLUMNS)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def cache_root(models_dir: Optional[str] = None) -> str:
    return os.path.join(models_dir or settings.models_dir, "feature-cache")


def cache_dir(models_dir: Optional[str] = None, version: Optional[str] = None) -> str:
    return os.path.join(cache_root(models_dir), version or feature_version())


def cache_path(symbol: str, models_dir: Optional[str] = None, version: Optional[str] = None) -> str:
    safe = symbol.replace("/", "_").replace("\\", "_").upper()
    return os.path.join(cache_dir(models_dir, version), f"{safe}.parquet")


def _manifest_path(models_dir: Optional[str] = None, version: Optional[str] = None) -> str:
    return os.path.join(cache_dir(models_dir, version), "_last_times.json")


def load_last_times_manifest(
    models_dir: Optional[str] = None, version: Optional[str] = None
) -> Dict[str, int]:
    path = _manifest_path(models_dir, version)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return {}
        return {str(key).upper(): int(value) for key, value in payload.items()}
    except Exception:
        return {}


def _write_last_times_manifest(
    times: Dict[str, int], models_dir: Optional[str] = None, version: Optional[str] = None
) -> None:
    os.makedirs(cache_dir(models_dir, version), exist_ok=True)
    with open(_manifest_path(models_dir, version), "w", encoding="utf-8") as handle:
        json.dump(times, handle)


def feature_cache_populated(models_dir: Optional[str] = None) -> bool:
    path = cache_dir(models_dir)
    if not os.path.isdir(path):
        return False
    return any(name.endswith(".parquet") for name in os.listdir(path))


def wipe_feature_cache(models_dir: Optional[str] = None) -> None:
    root = cache_root(models_dir)
    shutil.rmtree(root, ignore_errors=True)


def load_symbol_cache(
    symbol: str, models_dir: Optional[str] = None, version: Optional[str] = None
) -> Optional[pd.DataFrame]:
    path = cache_path(symbol, models_dir, version)
    if not os.path.isfile(path):
        return None
    try:
        frame = pd.read_parquet(path)
    except Exception:
        return None
    if "time" not in frame.columns:
        return None
    missing = [column for column in CACHE_COLUMNS if column not in frame.columns]
    if missing:
        return None
    return frame[CACHE_COLUMNS].sort_values("time").reset_index(drop=True)


def save_symbol_cache(
    symbol: str,
    frame: pd.DataFrame,
    days: int,
    models_dir: Optional[str] = None,
    version: Optional[str] = None,
) -> None:
    if frame is None or frame.empty or "time" not in frame.columns:
        return
    kept = frame[CACHE_COLUMNS].copy()
    kept["time"] = kept["time"].astype("int64")
    if days > 0 and len(kept):
        cutoff = int(kept["time"].max()) - int(days) * 86_400_000
        kept = kept[kept["time"] >= cutoff]
    os.makedirs(os.path.dirname(cache_path(symbol, models_dir, version)), exist_ok=True)
    kept.sort_values("time").reset_index(drop=True).to_parquet(
        cache_path(symbol, models_dir, version), index=False
    )
    times = load_last_times_manifest(models_dir, version)
    times[symbol.replace("/", "_").replace("\\", "_").upper()] = int(kept["time"].max())
    _write_last_times_manifest(times, models_dir, version)


def append_features(
    cached: Optional[pd.DataFrame],
    rebuilt: pd.DataFrame,
    last_time: Optional[int],
) -> pd.DataFrame:
    """Keep cached rows through last_time and append rebuilt rows after it."""
    new_rows = rebuilt.copy()
    if last_time is not None:
        new_rows = new_rows[new_rows["time"] > last_time]
    if cached is None or cached.empty:
        return new_rows.reset_index(drop=True)
    older = cached if last_time is None else cached[cached["time"] <= last_time]
    if new_rows.empty:
        return older.reset_index(drop=True)
    return (
        pd.concat([older[CACHE_COLUMNS], new_rows[CACHE_COLUMNS]], ignore_index=True)
        .drop_duplicates(subset=["time"], keep="last")
        .sort_values("time")
        .reset_index(drop=True)
    )
