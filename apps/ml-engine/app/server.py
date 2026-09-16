"""FastAPI serving layer + periodic prediction loop.

Run: uvicorn app.server:app --host 0.0.0.0 --port 8000
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import jobs as ml_jobs
from . import lifecycle as ml_lifecycle
from . import manipulation as investigate
from .config import CORE_HORIZONS, DISCLAIMER, settings
from .data import load_universe
from .persistence import (
    list_cached,
    persist_latest_file,
    persist_prediction,
    publish_prediction,
    shutdown,
)
from .predict import missing_models_message, models_available, predict_symbol
from .promote import PromoteError, promote_horizon
from .registry import get_active, list_models
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
    active_models = {}
    for horizon in CORE_HORIZONS:
        entry = get_active(horizon)
        if entry:
            active_models[horizon] = {
                "modelId": entry.get("modelId"),
                "modelVersion": entry.get("modelVersion"),
                "artifactDir": entry.get("artifactDir"),
            }
    return {
        "status": "ok",
        "service": "ml-engine",
        "modelsTrained": models_available(),
        "manipulationModelsTrained": investigate.models_available(),
        "activeModels": active_models,
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
    """Holdout, walk-forward, ML backtest, and dataset-quality reports if present.

    Read-only surface of existing M2 artifacts — does not train or promote.
    """
    holdout = _read_json("holdout.json")
    walk_forward = _read_json("walkforward.json")
    ml_backtest = _read_json("ml-backtest.json")
    dataset_quality = _read_json("dataset-quality.json")
    return {
        "holdout": holdout,
        "walkForward": walk_forward,
        "mlBacktest": ml_backtest,
        "datasetQuality": dataset_quality,
        "present": {
            "holdout": bool(holdout),
            "walkForward": bool(walk_forward),
            "mlBacktest": bool(ml_backtest),
            "datasetQuality": bool(dataset_quality),
        },
        "note": (
            "Evaluation artifacts are advisory for ML promotion gates only. "
            "They do not authorize trades (Risk → Portfolio → Policy → Gate)."
        ),
        "disclaimer": DISCLAIMER,
    }


@app.get("/drift")
def get_drift() -> Dict[str, object]:
    """Read-only M4 drift reports written by assess_drift (per core horizon).

    Advisory only — never auto-retrains and never authorizes trades.
    """
    reports: Dict[str, object] = {}
    present: Dict[str, bool] = {}
    for horizon in CORE_HORIZONS:
        path = os.path.join(settings.models_dir, "drift", f"{horizon}.json")
        report: Dict[str, object] = {}
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            report = payload if isinstance(payload, dict) else {}
        reports[horizon] = report
        present[horizon] = bool(report)
    return {
        "horizons": reports,
        "present": present,
        "note": (
            "Drift status is ML serving metadata for Trade Intelligence usability only. "
            "It does not authorize trades (Risk → Portfolio → Policy → Gate)."
        ),
        "disclaimer": DISCLAIMER,
    }


@app.get("/reports")
def get_reports() -> Dict[str, object]:
    """Phase 5: catalog of existing ML report artifacts (presence only).

    Does not generate new reports, retrain, or authorize trades.
    """
    holdout = _read_json("holdout.json")
    walk_forward = _read_json("walkforward.json")
    ml_backtest = _read_json("ml-backtest.json")
    dataset_quality = _read_json("dataset-quality.json")
    accuracy_path = os.path.join(settings.models_dir, "accuracy.json")
    accuracy_present = os.path.exists(accuracy_path)
    drift_present = False
    drift_horizons: Dict[str, bool] = {}
    for horizon in CORE_HORIZONS:
        path = os.path.join(settings.models_dir, "drift", f"{horizon}.json")
        found = os.path.exists(path)
        drift_horizons[horizon] = found
        drift_present = drift_present or found
    cached = list_cached("", "", "", 1, 0)
    predictions_total = int(cached.get("total") or 0) if isinstance(cached, dict) else 0

    reports = [
        {
            "id": "datasetQuality",
            "title": "Dataset quality",
            "phase": "M2",
            "artifact": "dataset-quality.json",
            "present": bool(dataset_quality),
            "labPath": "/ml-lab/dataset",
            "blurb": "PIT / coverage / price-policy hard gates (promote input only).",
        },
        {
            "id": "holdout",
            "title": "Holdout evaluation",
            "phase": "M2",
            "artifact": "holdout.json",
            "present": bool(holdout),
            "labPath": "/ml-lab/validation",
            "blurb": "Out-of-sample holdout metrics used by promote gates.",
        },
        {
            "id": "walkForward",
            "title": "Walk-forward stability",
            "phase": "M2",
            "artifact": "walkforward.json",
            "present": bool(walk_forward),
            "labPath": "/ml-lab/validation",
            "blurb": "Fold mean / worst / std stability for promote.",
        },
        {
            "id": "mlBacktest",
            "title": "ML backtest",
            "phase": "M2/M3",
            "artifact": "ml-backtest.json",
            "present": bool(ml_backtest),
            "labPath": "/ml-lab/validation",
            "blurb": "Cost-aware / imbalance evaluation artifact when present.",
        },
        {
            "id": "drift",
            "title": "Serving drift",
            "phase": "M4",
            "artifact": "drift/{horizon}.json",
            "present": drift_present,
            "detail": drift_horizons,
            "labPath": "/ml-lab/monitoring",
            "blurb": "Feature / calibration drift stamps (TI usability only).",
        },
        {
            "id": "accuracy",
            "title": "Prediction accuracy",
            "phase": "M4",
            "artifact": "accuracy.json",
            "present": accuracy_present,
            "labPath": "/ml-lab/monitoring",
            "blurb": "Scored hit-rate track record (observational).",
        },
        {
            "id": "predictions",
            "title": "Latest predictions",
            "phase": "M4",
            "artifact": "latest-predictions.json / DB",
            "present": predictions_total > 0,
            "detail": {"cachedRows": predictions_total},
            "labPath": "/ml-lab/predictions",
            "blurb": "ACTIVE-model serving outputs for TI (not Gate).",
        },
        {
            "id": "tiBridge",
            "title": "ML → TI usability bridge",
            "phase": "M4",
            "artifact": "market-data prediction cache",
            "present": None,
            "external": True,
            "labPath": "/ml-lab/ti-bridge",
            "blurb": "Fresh + drift-compatible rows usable by Trade Intelligence (MDS).",
        },
        {
            "id": "registry",
            "title": "Model registry",
            "phase": "M1–M4",
            "artifact": "registry/models.json",
            "present": True,
            "labPath": "/ml-lab/registry",
            "blurb": "CANDIDATE / ACTIVE / RETIRED inventory + promote.",
        },
    ]
    return {
        "reports": reports,
        "counts": {
            "present": sum(1 for row in reports if row.get("present") is True),
            "missing": sum(1 for row in reports if row.get("present") is False),
            "external": sum(1 for row in reports if row.get("present") is None),
            "total": len(reports),
        },
        "note": (
            "Reports hub indexes existing M2–M4 artifacts only. "
            "It does not generate new reports or authorize trades "
            "(Risk → Portfolio → Policy → Gate)."
        ),
        "disclaimer": DISCLAIMER,
    }


_M4_PREDICTION_KEYS = (
    "modelId",
    "driftStatus",
    "calibratedProbabilities",
    "probabilities",
    "expectedReturn",
    "expectedMfe",
    "expectedMae",
    "expiresAt",
    "predictionTimestamp",
    "sourceDataTimestamp",
    "featureVersion",
    "datasetVersion",
    "freshnessStatus",
    "priceAdjustmentMode",
)


def _enrich_predictions_from_cache(predictions: List[Dict[str, object]]) -> List[Dict[str, object]]:
    """Overlay M4 serving fields from the in-memory/file cache onto slim DB rows."""
    if not predictions:
        return predictions
    cached = list_cached("", "", "", 100_000, 0).get("predictions") or []
    index = {
        (str(row.get("symbol")), str(row.get("horizon"))): row
        for row in cached
        if isinstance(row, dict)
    }
    for row in predictions:
        rich = index.get((str(row.get("symbol")), str(row.get("horizon"))))
        if not isinstance(rich, dict):
            continue
        for key in _M4_PREDICTION_KEYS:
            if key not in rich or rich[key] is None:
                continue
            # Overlay provenance even when DB returned a null/absent field.
            if key not in row or row.get(key) is None:
                row[key] = rich[key]
    return predictions


def _normalize_status(raw: object) -> str:
    status = str(raw or "candidate").strip().lower()
    if status in {"active", "candidate", "retired"}:
        return status.upper()
    return "CANDIDATE"


def _public_model(entry: Dict[str, object]) -> Dict[str, object]:
    return {
        "modelId": entry.get("modelId"),
        "horizon": entry.get("horizon"),
        "modelVersion": entry.get("modelVersion"),
        "featureVersion": entry.get("featureVersion"),
        "datasetVersion": entry.get("datasetVersion"),
        "algorithm": entry.get("algorithm"),
        "status": _normalize_status(entry.get("status")),
        "active": bool(entry.get("active")),
        "artifactDir": entry.get("artifactDir"),
        "createdAt": entry.get("createdAt"),
        "promotedAt": entry.get("promotedAt"),
        "metrics": entry.get("metrics") or {},
        "calibration": entry.get("calibration") or {},
        "trainingWindow": entry.get("trainingWindow") or {},
    }


@app.get("/registry")
def get_registry(horizon: str = "", status: str = "") -> Dict[str, object]:
    """List registered models (candidates, active, retired)."""
    rows = [_public_model(entry) for entry in list_models(horizon.upper() or None)]
    if status:
        wanted = status.strip().upper()
        rows = [row for row in rows if row.get("status") == wanted]
    rows.sort(key=lambda row: str(row.get("createdAt") or ""), reverse=True)
    return {"models": rows, "count": len(rows), "disclaimer": DISCLAIMER}


@app.get("/registry/active")
def get_registry_active() -> Dict[str, object]:
    """Active model per core horizon (empty entry when none promoted)."""
    active: Dict[str, object] = {}
    for horizon in CORE_HORIZONS:
        entry = get_active(horizon)
        active[horizon] = _public_model(entry) if entry else None
    return {"active": active, "disclaimer": DISCLAIMER}


class PromoteBody(BaseModel):
    horizon: str
    modelId: Optional[str] = None


@app.post("/promote")
def post_promote(body: PromoteBody) -> Dict[str, object]:
    """Promote a candidate to ACTIVE after server-side M2/M3 gates.

    UI never decides eligibility — gate failures return HTTP 400.
    Does not authorize trades.
    """
    horizon = body.horizon.strip().upper()
    if not horizon:
        raise HTTPException(status_code=400, detail="horizon is required")
    try:
        promoted = promote_horizon(horizon, body.modelId)
    except PromoteError as error:
        raise HTTPException(
            status_code=400,
            detail={"message": str(error), "code": "PROMOTE_GATES_FAILED"},
        ) from error
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {
        "model": _public_model(promoted),
        "message": "Promoted to ACTIVE after server gates.",
        "disclaimer": DISCLAIMER,
    }


@app.get("/overview")
def get_overview() -> Dict[str, object]:
    """ML Lab rollup: registry counts + job snapshot + evaluation presence."""
    models = list_models()
    counts = {"active": 0, "candidate": 0, "retired": 0, "total": len(models)}
    for entry in models:
        key = _normalize_status(entry.get("status")).lower()
        if key in counts:
            counts[key] += 1
    job_snap = ml_jobs.snapshot()
    job = job_snap.get("job") if isinstance(job_snap, dict) else None
    holdout = _read_json("holdout.json")
    walk_forward = _read_json("walkforward.json")
    ml_backtest = _read_json("ml-backtest.json")
    dataset_quality = _read_json("dataset-quality.json")
    active: Dict[str, object] = {}
    for horizon in CORE_HORIZONS:
        entry = get_active(horizon)
        active[horizon] = _public_model(entry) if entry else None
    return {
        "counts": counts,
        "activeByHorizon": active,
        "modelsTrained": bool(job_snap.get("modelsTrained")),
        "currentJob": (
            {
                "kind": job.get("kind"),
                "status": job.get("status"),
                "universe": job.get("universe"),
                "percent": job.get("percent"),
                "stage": job.get("stage"),
                "startedAt": job.get("startedAt"),
                "finishedAt": job.get("finishedAt"),
            }
            if isinstance(job, dict)
            else None
        ),
        "evaluationsPresent": {
            "holdout": bool(holdout),
            "walkForward": bool(walk_forward),
            "mlBacktest": bool(ml_backtest),
            "datasetQuality": bool(dataset_quality),
        },
        "note": (
            "Train registers CANDIDATE only. Promote to ACTIVE requires server-side gates. "
            "ML Lab does not authorize trades."
        ),
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
    """Latest prediction per symbol/horizon, paginated.

    Prefer on-disk/in-memory cache when it carries provenance (expiresAt).
    Slim DB rows without TTL must not hide a fresher usable cache.
    """
    page = max(page, 1)
    limit = min(max(limit, 1), 5000)
    offset = (page - 1) * limit

    cached = list_cached(search, horizon, direction, limit, offset)
    cached_with_ttl = sum(
        1 for row in (cached.get("predictions") or []) if isinstance(row, dict) and row.get("expiresAt")
    )
    # Full cache inventory (unpaginated count) when provenance is present.
    cached_all = list_cached(search, horizon, direction, 100_000, 0)
    cached_ttl_total = sum(
        1 for row in (cached_all.get("predictions") or []) if isinstance(row, dict) and row.get("expiresAt")
    )
    if cached_ttl_total > 0:
        print(
            f"[ML][PREDICTIONS_ALL] source=cache records={cached_all.get('total')} "
            f"withExpiresAt={cached_ttl_total} page={page}",
            flush=True,
        )
        return {
            "predictions": cached["predictions"],
            "total": cached["total"],
            "page": page,
            "limit": limit,
            "hasMore": offset + len(cached["predictions"]) < cached["total"],
            "disclaimer": DISCLAIMER,
            "source": "cache",
            "note": (
                "Predictions are advisory ML outputs for Trade Intelligence only — "
                "not trade authorization."
            ),
        }

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
            enriched = _enrich_predictions_from_cache(predictions)
            print(
                f"[ML][PREDICTIONS_ALL] source=db records={total} "
                f"pageExpiresAt={sum(1 for r in enriched if r.get('expiresAt'))}",
                flush=True,
            )
            return {
                "predictions": enriched,
                "total": total,
                "page": page,
                "limit": limit,
                "hasMore": offset + len(predictions) < total,
                "disclaimer": DISCLAIMER,
                "note": (
                    "Predictions are advisory ML outputs for Trade Intelligence only — "
                    "not trade authorization."
                ),
            }
    except Exception as error:
        print(f"[ml-engine] predictions/all db fallback: {error}")

    print(
        f"[ML][PREDICTIONS_ALL] source=cache_fallback records={cached.get('total')} "
        f"withExpiresAt={cached_with_ttl}",
        flush=True,
    )
    return {
        "predictions": cached["predictions"],
        "total": cached["total"],
        "page": page,
        "limit": limit,
        "hasMore": offset + len(cached["predictions"]) < cached["total"],
        "disclaimer": DISCLAIMER,
        "source": "cache",
        "note": (
            "Predictions are advisory ML outputs for Trade Intelligence only — "
            "not trade authorization."
        ),
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
        from .predict import clear_model_cache

        clear_model_cache()
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
    symbols: Optional[str] = None


@app.get("/jobs/current")
def current_job() -> Dict[str, object]:
    return ml_jobs.snapshot()


@app.post("/jobs")
def start_ml_job(body: JobStartBody) -> Dict[str, object]:
    try:
        job = ml_jobs.start(body.kind, body.universe, body.symbols)
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


@app.get("/lifecycle/latest")
def lifecycle_latest() -> Dict[str, object]:
    """Latest staged ML lifecycle run (observation for ML Lab Jobs)."""
    return ml_lifecycle.public_run()


@app.get("/lifecycle/runs/{run_id}")
def lifecycle_run(run_id: str) -> Dict[str, object]:
    run = ml_lifecycle.load_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Lifecycle run {run_id} not found")
    return ml_lifecycle.public_run(run)


@app.post("/train")
def trigger_training() -> Dict[str, str]:
    """Kick off full-universe direction training out-of-process."""
    try:
        ml_jobs.start("train_all")
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"status": "training started in background"}
