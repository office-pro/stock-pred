"""FastAPI serving layer + periodic prediction loop.

Run: uvicorn app.server:app --host 0.0.0.0 --port 8000
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import jobs as ml_jobs
from . import manipulation as investigate
from .config import DISCLAIMER, settings
from .data import load_universe
from .persistence import (
    list_cached,
    persist_latest_file,
    persist_prediction,
    publish_prediction,
    shutdown,
)
from .predict import missing_models_message, models_available, predict_symbol
from .score import load_accuracy, score_all

_background_task = None
_scored_ledger = False


MANIPULATION_DISCLAIMER = (
    "Unusual vs this stock's history — not a finding of market abuse."
)


async def prediction_loop() -> None:
    """Periodically score the universe and publish predictions.generated."""
    global _scored_ledger
    await asyncio.sleep(15)  # let the platform settle on boot
    while True:
        direction_ok = models_available()
        investigate_ok = investigate.models_available()
        if direction_ok or investigate_ok:
            symbols = load_universe()
            if settings.predict_universe_limit > 0:
                symbols = symbols[: settings.predict_universe_limit]
            print(f"[ml-engine] scoring {len(symbols)} symbols")
            scored = 0
            for symbol in symbols:
                try:
                    if direction_ok:
                        predictions = await asyncio.to_thread(predict_symbol, symbol)
                        for prediction in predictions:
                            await persist_prediction(prediction)
                            await publish_prediction(prediction)
                    if investigate_ok:
                        await asyncio.to_thread(investigate.predict_symbol, symbol)
                    scored += 1
                    if scored % 20 == 0:
                        persist_latest_file()
                        if investigate_ok:
                            investigate.persist_latest_file()
                        print(f"[ml-engine] cached {scored}/{len(symbols)} symbols")
                except Exception as error:  # noqa: BLE001
                    print(f"[ml-engine] scoring failed for {symbol}: {error}")
            persist_latest_file()
            if investigate_ok:
                investigate.persist_latest_file()
            print("[ml-engine] latest predictions cached to disk")
            if not _scored_ledger:
                try:
                    await asyncio.to_thread(score_all)
                    _scored_ledger = True
                    print("[ml-engine] outcome ledger refreshed")
                except Exception as error:  # noqa: BLE001
                    print(f"[ml-engine] outcome scoring failed: {error}")
        else:
            print(f"[ml-engine] no trained models found - {missing_models_message()}")
        await asyncio.sleep(settings.prediction_interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _background_task
    _background_task = asyncio.create_task(prediction_loop())
    yield
    _background_task.cancel()
    await shutdown()


app = FastAPI(title="StockPred ML Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # internal service; the gateway fronts public traffic
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, object]:
    return {
        "status": "ok",
        "service": "ml-engine",
        "modelsTrained": models_available(),
        "manipulationModelsTrained": investigate.models_available(),
    }


def _read_json(name: str) -> Dict[str, object]:
    path = os.path.join(settings.models_dir, name)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


@app.get("/evaluations")
def get_evaluations() -> Dict[str, object]:
    """Holdout, walk-forward, and costed ML backtest reports if present."""
    return {
        "holdout": _read_json("holdout.json"),
        "walkForward": _read_json("walkforward.json"),
        "mlBacktest": _read_json("ml-backtest.json"),
        "disclaimer": DISCLAIMER,
    }


@app.get("/predictions/all")
async def get_all_predictions(
    limit: int = 50,
    page: int = 1,
    search: str = "",
    horizon: str = "",
    direction: str = "",
) -> Dict[str, object]:
    """Latest prediction per symbol/horizon, paginated."""
    page = max(page, 1)
    limit = min(max(limit, 1), 5000)
    offset = (page - 1) * limit
    try:
        import asyncpg

        conn = await asyncpg.connect(settings.asyncpg_dsn)
        rows = await conn.fetch(
            """
            WITH latest AS (
              SELECT DISTINCT ON (symbol, horizon)
                symbol, horizon, direction, confidence, expected_move, model_version, created_at
              FROM predictions
              WHERE ($1 = '' OR symbol ILIKE '%' || $1 || '%')
                AND ($2 = '' OR horizon = $2)
                AND ($3 = '' OR direction = $3)
              ORDER BY symbol, horizon, created_at DESC
            )
            SELECT *, COUNT(*) OVER() AS total
            FROM latest
            ORDER BY confidence DESC
            LIMIT $4 OFFSET $5
            """,
            search.upper(),
            horizon,
            direction,
            limit,
            offset,
        )
        await conn.close()

        total = int(rows[0]["total"]) if rows else 0
        predictions = [
            {
                "symbol": row["symbol"],
                "horizon": row["horizon"],
                "direction": row["direction"],
                "confidence": float(row["confidence"]),
                "expectedMove": float(row["expected_move"]),
                "modelVersion": row["model_version"],
                "createdAt": row["created_at"].isoformat(),
            }
            for row in rows
        ]
        if predictions:
            return {
                "predictions": predictions,
                "total": total,
                "page": page,
                "limit": limit,
                "hasMore": offset + len(predictions) < total,
                "disclaimer": DISCLAIMER,
            }
    except Exception as error:
        print(f"[ml-engine] predictions/all db fallback: {error}")

    cached = list_cached(search, horizon, direction, limit, offset)
    return {
        "predictions": cached["predictions"],
        "total": cached["total"],
        "page": page,
        "limit": limit,
        "hasMore": offset + len(cached["predictions"]) < cached["total"],
        "disclaimer": DISCLAIMER,
        "source": "cache",
    }


@app.get("/predictions/accuracy")
def get_accuracy(horizon: str = "NEXT_DAY") -> Dict[str, object]:
    payload = load_accuracy(horizon or None)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail="Accuracy has not been scored yet. Run `python -m app.score`.",
        )
    payload["disclaimer"] = DISCLAIMER
    return payload


@app.post("/predictions/score")
def trigger_score() -> Dict[str, object]:
    try:
        return score_all()
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/predictions/{symbol}")
async def get_predictions(symbol: str) -> Dict[str, object]:
    if not models_available():
        raise HTTPException(
            status_code=503,
            detail=missing_models_message(),
        )
    try:
        predictions: List[Dict[str, object]] = await asyncio.to_thread(
            predict_symbol, symbol.upper()
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    for prediction in predictions:
        await persist_prediction(prediction)
        await publish_prediction(prediction)
    return {"symbol": symbol.upper(), "predictions": predictions, "disclaimer": DISCLAIMER}


@app.get("/manipulation/all")
def get_all_manipulation(limit: int = 5000) -> Dict[str, object]:
    limit = min(max(limit, 1), 5000)
    return {
        "scores": investigate.list_scores(limit),
        "disclaimer": MANIPULATION_DISCLAIMER,
    }


@app.get("/manipulation/{symbol}")
async def get_manipulation(symbol: str) -> Dict[str, object]:
    if not investigate.models_available():
        raise HTTPException(
            status_code=503,
            detail="Unusual-activity models are not trained yet. Run `python ml/train-manipulation.py`.",
        )
    try:
        score = await asyncio.to_thread(investigate.predict_symbol, symbol.upper())
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    investigate.persist_latest_file()
    return {**score, "disclaimer": MANIPULATION_DISCLAIMER}


class JobStartBody(BaseModel):
    kind: str
    universe: str = "all"


@app.get("/jobs/current")
def current_job() -> Dict[str, object]:
    return ml_jobs.snapshot()


@app.post("/jobs")
def start_ml_job(body: JobStartBody) -> Dict[str, object]:
    try:
        job = ml_jobs.start(body.kind, body.universe)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    slim = {key: value for key, value in job.items() if key != "lines"}
    return {"job": slim, "available": ml_jobs.catalog(), "universes": ml_jobs.universe_catalog()}


@app.post("/jobs/current/cancel")
def cancel_ml_job() -> Dict[str, object]:
    try:
        return ml_jobs.cancel()
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/train")
def trigger_training() -> Dict[str, str]:
    """Kick off full-universe direction training out-of-process."""
    try:
        ml_jobs.start("train_all")
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"status": "training started in background"}
