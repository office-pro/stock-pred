"""Best-effort persistence (Postgres) and event publishing (Kafka).

The ml-engine owns the predictions domain, so it writes its own rows
(table is created by the shared Prisma migration) and emits
`predictions.generated` envelopes compatible with @stockpred/shared-events.
"""
import json
import time
import uuid
from typing import Dict, List, Optional

from .config import settings

_latest: Dict[tuple, Dict[str, object]] = {}
_LATEST_PATH = None


def _latest_path() -> str:
    import os

    return os.path.join(settings.models_dir, "latest-predictions.json")


def cache_prediction(prediction: Dict[str, object]) -> None:
    key = (str(prediction.get("symbol")), str(prediction.get("horizon")))
    _latest[key] = prediction


def list_cached(
    search: str = "",
    horizon: str = "",
    direction: str = "",
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, object]:
    rows = list(_latest.values())
    if not rows:
        rows = _load_latest_file()
    search_u = search.upper()
    filtered = []
    for row in rows:
        if search_u and search_u not in str(row.get("symbol", "")).upper():
            continue
        if horizon and row.get("horizon") != horizon:
            continue
        if direction and row.get("direction") != direction:
            continue
        filtered.append(row)
    filtered.sort(key=lambda item: float(item.get("confidence") or 0), reverse=True)
    total = len(filtered)
    page = filtered[offset : offset + limit]
    return {"predictions": page, "total": total}


def persist_latest_file() -> None:
    import json
    import os

    os.makedirs(settings.models_dir, exist_ok=True)
    with open(_latest_path(), "w", encoding="utf8") as handle:
        json.dump(list(_latest.values()), handle)


def _load_latest_file() -> List[Dict[str, object]]:
    import json
    import os

    path = _latest_path()
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf8") as handle:
        rows = json.load(handle)
    if not isinstance(rows, list):
        return []
    for row in rows:
        cache_prediction(row)
    return rows

try:
    import asyncpg
except ImportError:  # pragma: no cover
    asyncpg = None

try:
    from aiokafka import AIOKafkaProducer
except ImportError:  # pragma: no cover
    AIOKafkaProducer = None

_pool = None
_producer = None


async def get_pool():
    global _pool
    if _pool is None and asyncpg is not None:
        try:
            _pool = await asyncpg.create_pool(settings.asyncpg_dsn, min_size=1, max_size=4)
        except Exception as error:  # noqa: BLE001
            print(f"[ml-engine] database unavailable: {error}")
    return _pool


async def get_producer():
    global _producer
    if _producer is None and AIOKafkaProducer is not None:
        try:
            producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_brokers)
            await producer.start()
            _producer = producer
        except Exception as error:  # noqa: BLE001
            print(f"[ml-engine] kafka unavailable: {error}")
    return _producer


async def persist_outcomes(rows: List[Dict[str, object]]) -> None:
    """Best-effort write of scored advisories to prediction_outcomes."""
    if not rows:
        return
    pool = await get_pool()
    if pool is None:
        return
    try:
        async with pool.acquire() as connection:
            for row in rows:
                symbol = str(row.get("symbol", ""))
                if not symbol:
                    continue
                await connection.execute(
                    """
                    INSERT INTO stocks (id, symbol, name, exchange, sector, indices, created_at, updated_at)
                    VALUES ($1, $2, $2, 'NSE', 'Unknown', '{}', NOW(), NOW())
                    ON CONFLICT (symbol) DO NOTHING
                    """,
                    str(uuid.uuid4()),
                    symbol,
                )
                scored_ms = row.get("scoredAt")
                scored_at = None
                if scored_ms is not None:
                    from datetime import datetime, timezone

                    scored_at = datetime.fromtimestamp(int(scored_ms) / 1000.0, tz=timezone.utc)
                await connection.execute(
                    """
                    INSERT INTO prediction_outcomes
                      (id, symbol, horizon, predicted, confidence, entry, target, stop_loss,
                       quantity, actual_return, correct, predicted_at, scored_at, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
                    """,
                    str(uuid.uuid4()),
                    symbol,
                    str(row.get("horizon")),
                    str(row.get("predicted")),
                    float(row.get("confidence") or 0),
                    float(row.get("entry") or 0),
                    row.get("target"),
                    row.get("stopLoss"),
                    int(row.get("quantity") or 0),
                    row.get("actualReturn"),
                    bool(row.get("correct")) if row.get("correct") is not None else None,
                    int(row.get("predictedAt") or 0),
                    scored_at,
                )
    except Exception as error:  # noqa: BLE001
        print(f"[ml-engine] outcome persist failed: {error}")


def persist_outcomes_sync(rows: List[Dict[str, object]]) -> None:
    if not rows:
        return
    try:
        import asyncio

        asyncio.run(persist_outcomes(rows))
    except RuntimeError:
        try:
            import asyncio

            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(persist_outcomes(rows))
                return
            loop.run_until_complete(persist_outcomes(rows))
        except Exception as error:  # noqa: BLE001
            print(f"[ml-engine] outcome persist skipped: {error}")
    except Exception as error:  # noqa: BLE001
        print(f"[ml-engine] outcome persist skipped: {error}")


async def persist_prediction(prediction: Dict[str, object]) -> Optional[str]:
    cache_prediction(prediction)
    pool = await get_pool()
    if pool is None:
        return str(uuid.uuid4())
    row_id = str(uuid.uuid4())
    try:
        async with pool.acquire() as connection:
            await connection.execute(
                """
                INSERT INTO stocks (id, symbol, name, exchange, sector, indices, created_at, updated_at)
                VALUES ($1, $2, $2, 'NSE', 'Unknown', '{}', NOW(), NOW())
                ON CONFLICT (symbol) DO NOTHING
                """,
                str(uuid.uuid4()),
                prediction["symbol"],
            )
            await connection.execute(
                """
                INSERT INTO predictions
                  (id, symbol, horizon, direction, confidence, expected_move, model_version, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                """,
                row_id,
                prediction["symbol"],
                prediction["horizon"],
                prediction["direction"],
                float(prediction["confidence"]),
                float(prediction["expectedMove"]),
                str(prediction.get("modelVersion", settings.model_version)),
            )
        return row_id
    except Exception as error:  # noqa: BLE001
        print(f"[ml-engine] persist failed: {error}")
        return None


async def publish_prediction(prediction: Dict[str, object]) -> None:
    producer = await get_producer()
    if producer is None:
        return
    envelope = {
        "id": str(uuid.uuid4()),
        "topic": "predictions.generated",
        "payload": {**prediction, "generatedAt": int(time.time() * 1000)},
        "producedAt": int(time.time() * 1000),
        "version": 1,
    }
    try:
        await producer.send_and_wait(
            "predictions.generated",
            json.dumps(envelope).encode("utf-8"),
            key=str(prediction["symbol"]).encode("utf-8"),
        )
    except Exception as error:  # noqa: BLE001
        print(f"[ml-engine] publish failed: {error}")


async def shutdown() -> None:
    global _pool, _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
    if _pool is not None:
        await _pool.close()
        _pool = None
