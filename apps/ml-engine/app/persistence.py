"""Best-effort persistence (Postgres) and event publishing (Kafka).

The ml-engine owns the predictions domain, so it writes its own rows
(table is created by the shared Prisma migration) and emits
`predictions.generated` envelopes compatible with @stockpred/shared-events.
"""
import json
import time
import uuid
from typing import Dict, Optional

from .config import settings

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


async def persist_prediction(prediction: Dict[str, object]) -> Optional[str]:
    pool = await get_pool()
    if pool is None:
        return None
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
