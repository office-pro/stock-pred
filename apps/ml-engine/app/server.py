"""FastAPI serving layer + periodic prediction loop.

Run: uvicorn app.server:app --host 0.0.0.0 --port 8000
"""
import asyncio
import subprocess
import sys
from contextlib import asynccontextmanager
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import DISCLAIMER, settings
from .data import load_universe
from .persistence import (
    list_cached,
    persist_latest_file,
    persist_prediction,
    publish_prediction,
    shutdown,
)
from .predict import models_available, predict_symbol
from .score import load_accuracy, score_all

_background_task = None
_scored_ledger = False


async def prediction_loop() -> None:
    """Periodically score the universe and publish predictions.generated."""
    global _scored_ledger
    await asyncio.sleep(15)  # let the platform settle on boot
    while True:
        if models_available():
            symbols = load_universe()[:200]
            print(f"[ml-engine] scoring {len(symbols)} symbols")
            scored = 0
            for symbol in symbols:
                try:
                    predictions = await asyncio.to_thread(predict_symbol, symbol)
                    for prediction in predictions:
                        await persist_prediction(prediction)
                        await publish_prediction(prediction)
                    scored += 1
                    if scored % 20 == 0:
                        persist_latest_file()
                        print(f"[ml-engine] cached {scored}/{len(symbols)} symbols")
                except Exception as error:  # noqa: BLE001
                    print(f"[ml-engine] scoring failed for {symbol}: {error}")
            persist_latest_file()
            print("[ml-engine] latest predictions cached to disk")
            if not _scored_ledger:
                try:
                    await asyncio.to_thread(score_all)
                    _scored_ledger = True
                    print("[ml-engine] outcome ledger refreshed")
                except Exception as error:  # noqa: BLE001
                    print(f"[ml-engine] outcome scoring failed: {error}")
        else:
            print("[ml-engine] no trained models found - run `python ml/train.py`")
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
            detail="Models are not trained yet. Run `python ml/train.py` first.",
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


@app.post("/train")
def trigger_training() -> Dict[str, str]:
    """Kick off training out-of-process so the API stays responsive."""
    subprocess.Popen(  # noqa: S603 - fixed argv, no shell
        [sys.executable, "-m", "app.train"],
    )
    return {"status": "training started in background"}
