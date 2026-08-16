"""Walk-forward score of trained models against official candles.

Uses the same ±1% / ±2% labels as training. Writes:
  ml-models/outcomes.json
  ml-models/accuracy.json
"""
from __future__ import annotations

import json
import os
from typing import Dict, List

import numpy as np

from .config import HORIZONS, SEQUENCE_LENGTH, settings
from .data import load_candles, load_market_context, load_universe
from .features import FEATURE_COLUMNS, build_features
from .models.ensemble import blend_probabilities, decide, expected_move
from .persistence import persist_outcomes_sync
from .predict import get_models, models_available


def _action(direction: str) -> str:
    if direction == "UP":
        return "BUY"
    if direction == "DOWN":
        return "SELL"
    return "HOLD"


def _bucket(confidence: float) -> str:
    if confidence < 65:
        return "55-65"
    if confidence < 75:
        return "65-75"
    return "75+"


def _hit_rate(correct: int, predicted: int) -> float | None:
    if predicted <= 0:
        return None
    return round(100.0 * correct / predicted, 2)


def summarize(outcomes: List[dict], horizon: str) -> dict:
    by_action = {
        "BUY": {"predicted": 0, "correct": 0, "hitRate": None},
        "SELL": {"predicted": 0, "correct": 0, "hitRate": None},
        "HOLD": {"predicted": 0, "correct": 0, "hitRate": None},
    }
    buckets = {
        "55-65": {"label": "55-65", "minConfidence": 55, "maxConfidence": 65, "predicted": 0, "correct": 0},
        "65-75": {"label": "65-75", "minConfidence": 65, "maxConfidence": 75, "predicted": 0, "correct": 0},
        "75+": {"label": "75+", "minConfidence": 75, "maxConfidence": 100, "predicted": 0, "correct": 0},
    }
    pnls: List[float] = []
    sessions = set()
    for row in outcomes:
        if row["horizon"] != horizon:
            continue
        action = row["predicted"]
        by_action.setdefault(action, {"predicted": 0, "correct": 0, "hitRate": None})
        by_action[action]["predicted"] += 1
        if row.get("correct"):
            by_action[action]["correct"] += 1
        key = _bucket(float(row["confidence"]))
        buckets[key]["predicted"] += 1
        if row.get("correct"):
            buckets[key]["correct"] += 1
        if row.get("actualReturn") is not None:
            signed = float(row["actualReturn"]) * 100.0
            if action == "SELL":
                signed = -signed
            if action != "HOLD":
                pnls.append(signed)
        sessions.add(row.get("predictedAt"))

    total_pred = sum(item["predicted"] for item in by_action.values())
    total_ok = sum(item["correct"] for item in by_action.values())
    for item in by_action.values():
        item["hitRate"] = _hit_rate(item["correct"], item["predicted"])
    calibration = []
    for item in buckets.values():
        calibration.append({**item, "hitRate": _hit_rate(item["correct"], item["predicted"])})
    return {
        "horizon": horizon,
        "sessions": len(sessions),
        "overallHitRate": _hit_rate(total_ok, total_pred),
        "byAction": by_action,
        "calibration": calibration,
        "avgPnlPercent": round(float(np.mean(pnls)), 4) if pnls else None,
        "scoredCalls": total_pred,
    }


def score_horizon(horizon: str, symbols: List[str], lookback: int = 20) -> List[dict]:
    config = HORIZONS[horizon]
    bars = int(config["bars"])
    threshold = float(config["threshold"])
    try:
        models = get_models(horizon)
    except FileNotFoundError:
        return []
    market = load_market_context(120)
    outcomes: List[dict] = []

    for symbol in symbols:
        try:
            candles = load_candles(symbol, 120)
        except RuntimeError:
            continue
        if len(candles) < SEQUENCE_LENGTH + bars + 5:
            continue
        features = build_features(candles, market)
        matrix = np.nan_to_num(features[FEATURE_COLUMNS].to_numpy(dtype="float32"), nan=0.0)
        closes = features["close"].to_numpy()
        times = features["time"].to_numpy()
        end = len(matrix) - bars
        start = max(SEQUENCE_LENGTH, end - lookback)
        for index in range(start, end):
            window = matrix[: index + 1]
            if window.shape[0] < SEQUENCE_LENGTH:
                continue
            x_scaled = models.scaler.transform(window)
            latest = x_scaled[-1:]
            try:
                probas = {
                    "xgboost": models.xgb.predict_proba(latest),
                    "lightgbm": models.lgbm.predict_proba(latest),
                    "lstm": models.lstm.predict_proba_last(x_scaled),
                    "transformer": models.transformer.predict_proba_last(x_scaled),
                }
                blended = blend_probabilities(probas)[0]
                decision = decide(blended)
            except Exception:  # noqa: BLE001
                continue
            actual = float(closes[index + bars] / closes[index] - 1.0)
            true_dir = "UP" if actual > threshold else "DOWN" if actual < -threshold else "SIDEWAYS"
            predicted = _action(str(decision["direction"]))
            true_action = _action(true_dir)
            outcomes.append(
                {
                    "symbol": symbol,
                    "horizon": horizon,
                    "predicted": predicted,
                    "confidence": float(decision["confidence"]),
                    "entry": float(closes[index]),
                    "actualReturn": actual,
                    "correct": predicted == true_action,
                    "predictedAt": int(times[index]),
                    "scoredAt": int(times[index + bars]),
                }
            )
            if horizon == "NEXT_WEEK":
                expected5 = expected_move(str(decision["direction"]), models.metadata.get("class_moves", {}))
                for label, fwd in (("RETURN_5D", 5), ("RETURN_10D", 10), ("RETURN_20D", 20)):
                    if index + fwd >= len(closes):
                        continue
                    realized = float(closes[index + fwd] / closes[index] - 1.0)
                    expected = expected5 * (fwd / 5.0)
                    outcomes.append(
                        {
                            "symbol": symbol,
                            "horizon": label,
                            "predicted": predicted,
                            "confidence": float(decision["confidence"]),
                            "entry": float(closes[index]),
                            "actualReturn": realized,
                            "expectedMove": expected,
                            "correct": (expected >= 0 and realized >= 0) or (expected < 0 and realized < 0),
                            "predictedAt": int(times[index]),
                            "scoredAt": int(times[index + fwd]),
                        }
                    )
    return outcomes


def score_all(limit_symbols: int = 80, lookback: int = 20, symbols: List[str] | None = None) -> Dict[str, object]:
    if not models_available():
        raise RuntimeError("No trained models - run python -m app.train first")
    names = symbols if symbols else load_universe()[:limit_symbols]
    outcomes: List[dict] = []
    accuracy: Dict[str, object] = {}
    for horizon in HORIZONS:
        print(f"[score] walk-forward {horizon} on {len(names)} symbols")
        rows = score_horizon(horizon, names, lookback)
        if not rows:
            print(f"[score] {horizon} skipped (no model or no rows)")
            continue
        outcomes.extend(rows)
        accuracy[horizon] = summarize(rows, horizon)
        print(f"[score] {horizon} hitRate={accuracy[horizon]['overallHitRate']} n={len(rows)}")
        if horizon == "NEXT_WEEK":
            for label in ("RETURN_5D", "RETURN_10D", "RETURN_20D"):
                extra = summarize(rows, label)
                if extra.get("scoredCalls"):
                    accuracy[label] = extra
                    print(f"[score] {label} hitRate={extra['overallHitRate']} n={extra['scoredCalls']}")

    os.makedirs(settings.models_dir, exist_ok=True)
    outcomes_path = os.path.join(settings.models_dir, "outcomes.json")
    accuracy_path = os.path.join(settings.models_dir, "accuracy.json")
    with open(outcomes_path, "w", encoding="utf8") as handle:
        json.dump(outcomes, handle)
    with open(accuracy_path, "w", encoding="utf8") as handle:
        json.dump(accuracy, handle, indent=2)
    persist_outcomes_sync(outcomes)
    return accuracy


def load_accuracy(horizon: str | None = None) -> dict:
    path = os.path.join(settings.models_dir, "accuracy.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf8") as handle:
        payload = json.load(handle)
    if horizon:
        return payload.get(horizon, {})
    return payload


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--symbols", type=str, default="")
    args = parser.parse_args()
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] if args.symbols else None
    result = score_all(limit_symbols=args.limit, symbols=symbols)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
