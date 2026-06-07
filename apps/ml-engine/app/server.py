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
from .persistence import persist_prediction, publish_prediction, shutdown
from .predict import models_available, predict_symbol

_background_task = None


async def prediction_loop() -> None:
    """Periodically score the universe and publish predictions.generated."""
    await asyncio.sleep(15)  # let the platform settle on boot
    while True:
        if models_available():
            symbols = load_universe()
            print(f"[ml-engine] scoring {len(symbols)} symbols")
            for symbol in symbols:
                try:
                    predictions = await asyncio.to_thread(predict_symbol, symbol)
                    for prediction in predictions:
                        await persist_prediction(prediction)
                        await publish_prediction(prediction)
                except Exception as error:  # noqa: BLE001
                    print(f"[ml-engine] scoring failed for {symbol}: {error}")
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
async def get_all_predictions(limit: int = 50) -> Dict[str, object]:
    """Fetch latest predictions for all stocks from database."""
    try:
        import asyncpg
        from .config import settings
        conn = await asyncpg.connect(settings.asyncpg_dsn)
        # Get latest prediction per symbol per horizon
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (symbol, horizon)
              symbol, horizon, direction, confidence, expected_move, model_version, created_at
            FROM predictions
            ORDER BY symbol, horizon, created_at DESC
            LIMIT $1
            """,
            limit * 2,  # fetch more to account for 2 horizons per symbol
        )
        await conn.close()

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
        return {"predictions": predictions, "disclaimer": DISCLAIMER}
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Database error: {str(error)}") from error


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
