"""Long-only backtest of ML Buy chips with NSE delivery costs and slippage.

Uses the live ensemble artifacts. Does not retrain. Writes ml-backtest.json.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from typing import Dict, List

import numpy as np

from .config import HORIZONS, SEQUENCE_LENGTH, settings
from .costs import apply_slippage, round_trip_cost
from .data import attach_alt_data, load_candles, load_market_context, load_universe
from .features import FEATURE_COLUMNS, build_features
from .models.ensemble import blend_probabilities, decide
from .predict import get_models, missing_models_message, models_available
from .universes import add_universe_arg, normalize_universe

MIN_CONFIDENCE = 62.0
INITIAL_CAPITAL = 1_000_000.0
RISK_FRACTION = 0.01


def max_drawdown_pct(equity: List[float]) -> float | None:
    if len(equity) < 2:
        return None
    series = np.asarray(equity, dtype="float64")
    peak = np.maximum.accumulate(series)
    dd = np.where(peak > 0, (series - peak) / peak, 0.0)
    return round(float(dd.min()) * 100.0, 2)


def sharpe_ratio(returns: List[float]) -> float | None:
    if len(returns) < 2:
        return None
    arr = np.asarray(returns, dtype="float64")
    std = float(arr.std(ddof=0))
    if std == 0:
        return None
    return round(float(arr.mean() / std * math.sqrt(252)), 2)


def cagr_pct(start: float, end: float, days: int) -> float | None:
    if start <= 0 or days < 30:
        return None
    years = days / 365.25
    if years <= 0:
        return None
    return round(((end / start) ** (1 / years) - 1) * 100.0, 2)


def profit_factor(pnls: List[float]) -> float | None:
    gains = sum(p for p in pnls if p > 0)
    losses = sum(-p for p in pnls if p < 0)
    if losses <= 0:
        return None if gains <= 0 else 99.0
    return round(gains / losses, 2)


def backtest_symbol(symbol: str, horizon: str, models, market) -> List[dict]:
    config = HORIZONS[horizon]
    bars = int(config["bars"])
    try:
        candles = load_candles(symbol, 1500)
    except RuntimeError:
        return []
    if len(candles) < SEQUENCE_LENGTH + bars + 10:
        return []
    features = build_features(candles, market, symbol=symbol)
    matrix = np.nan_to_num(features[FEATURE_COLUMNS].to_numpy(dtype="float32"), nan=0.0)
    closes = features["close"].to_numpy(dtype="float64")
    times = features["time"].to_numpy(dtype="int64")
    trades: List[dict] = []
    index = SEQUENCE_LENGTH
    end = len(matrix) - bars - 1
    while index < end:
        window = matrix[: index + 1]
        x_scaled = models.scaler.transform(window)
        try:
            decision = decide(blend_probabilities(models.probabilities(x_scaled))[0])
        except Exception:  # noqa: BLE001
            index += 1
            continue
        if str(decision["direction"]) != "UP" or float(decision["confidence"]) < MIN_CONFIDENCE:
            index += 1
            continue
        entry_i = index + 1
        exit_i = min(entry_i + bars, len(closes) - 1)
        entry = apply_slippage(float(closes[entry_i]), "BUY")
        exit_px = apply_slippage(float(closes[exit_i]), "SELL")
        trades.append(
            {
                "symbol": symbol,
                "entryTime": int(times[entry_i]),
                "exitTime": int(times[exit_i]),
                "entry": entry,
                "exit": exit_px,
                "confidence": float(decision["confidence"]),
                "grossReturn": (exit_px / entry) - 1.0 if entry else 0.0,
            }
        )
        index = exit_i + 1
    return trades


def simulate_book(trades: List[dict], initial: float = INITIAL_CAPITAL) -> Dict[str, object]:
    cash = initial
    equity = [initial]
    pnls: List[float] = []
    returns: List[float] = []
    costs_paid = 0.0
    ordered = sorted(trades, key=lambda row: row["entryTime"])
    for trade in ordered:
        size = cash * RISK_FRACTION
        if size < 1000 or trade["entry"] <= 0:
            continue
        qty = size / trade["entry"]
        buy_notional = qty * trade["entry"]
        sell_notional = qty * trade["exit"]
        fees = round_trip_cost(buy_notional, sell_notional)
        pnl = sell_notional - buy_notional - fees
        cash += pnl
        costs_paid += fees
        pnls.append(pnl)
        returns.append(pnl / buy_notional if buy_notional else 0.0)
        equity.append(cash)
    wins = sum(1 for pnl in pnls if pnl > 0)
    days = 0
    if ordered:
        days = max(int((ordered[-1]["exitTime"] - ordered[0]["entryTime"]) / 86_400_000), 1)
    return {
        "initialCapital": initial,
        "finalCapital": round(cash, 2),
        "trades": len(pnls),
        "winRate": round(100.0 * wins / len(pnls), 2) if pnls else None,
        "profitFactor": profit_factor(pnls),
        "cagr": cagr_pct(initial, cash, days),
        "sharpe": sharpe_ratio(returns),
        "maxDrawdownPct": max_drawdown_pct(equity),
        "costsPaid": round(costs_paid, 2),
        "avgReturnPct": round(float(np.mean(returns)) * 100.0, 4) if returns else None,
        "days": days,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ML chip backtest with NSE delivery costs")
    parser.add_argument("--days", type=int, default=1500)
    parser.add_argument("--horizon", type=str, default="NEXT_WEEK")
    parser.add_argument("--symbols", type=str, default="")
    add_universe_arg(parser)
    args = parser.parse_args()
    if not models_available():
        raise RuntimeError(missing_models_message(args.universe))
    basket = normalize_universe(args.universe)
    horizon = args.horizon.upper()
    if horizon not in HORIZONS:
        raise ValueError(f"Unknown horizon {horizon}")
    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else load_universe(basket)
    )
    print(
        f"[ml-backtest] universe={basket} symbols={len(symbols)} horizon={horizon} "
        f"minConfidence={MIN_CONFIDENCE}",
        flush=True,
    )
    models = get_models(horizon)
    market = attach_alt_data(load_market_context(args.days))
    all_trades: List[dict] = []
    for i, symbol in enumerate(symbols):
        print(f"[ml-backtest] {i + 1}/{len(symbols)} {symbol}", flush=True)
        all_trades.extend(backtest_symbol(symbol, horizon, models, market))
    book = simulate_book(all_trades)
    report = {
        "universe": basket,
        "horizon": horizon,
        "minConfidence": MIN_CONFIDENCE,
        "costModel": "nse_delivery_cnc_plus_5bps_slippage",
        "disclaimer": "Paper research with estimated costs — not investment advice.",
        **book,
        "tradeCountRaw": len(all_trades),
    }
    os.makedirs(settings.models_dir, exist_ok=True)
    path = os.path.join(settings.models_dir, "ml-backtest.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps(book, indent=2), flush=True)
    print(f"[ml-backtest] wrote {path}", flush=True)
    print("[ml-backtest] done. This is not investment advice.")


if __name__ == "__main__":
    main()
