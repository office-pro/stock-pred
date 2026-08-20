"""Roll raw news/social events into daily PIT feature rows."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from .nlp import is_earnings_event

DAY = timedelta(days=1)


def utc_day(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    ts = ts.astimezone(timezone.utc)
    return datetime(ts.year, ts.month, ts.day, tzinfo=timezone.utc)


def mean(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def stdev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    var = sum((item - avg) ** 2 for item in values) / len(values)
    return var**0.5


def clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def aggregate_news_daily(mentions: Iterable[Dict[str, object]]) -> List[Dict[str, object]]:
    """mentions: symbol, available_at, sentiment, eventType, eventStrength."""
    by_symbol: Dict[str, List[Dict[str, object]]] = {}
    for row in mentions:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        by_symbol.setdefault(symbol, []).append(row)
    out: List[Dict[str, object]] = []
    for symbol, rows in by_symbol.items():
        parsed = []
        for row in rows:
            raw = row.get("available_at") or row.get("published_at")
            if isinstance(raw, datetime):
                when = raw
            else:
                when = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            parsed.append({**row, "_when": when, "_day": utc_day(when)})
        days = sorted({item["_day"] for item in parsed})
        for day in days:
            def window(days_back: int) -> List[Dict[str, object]]:
                start = day - timedelta(days=days_back - 1)
                return [item for item in parsed if start <= item["_day"] <= day]

            d1 = window(1)
            d7 = window(7)
            d30 = window(30)
            sent1 = [float(item.get("sentiment") or 0) for item in d1]
            sent7 = [float(item.get("sentiment") or 0) for item in d7]
            sent30 = [float(item.get("sentiment") or 0) for item in d30]
            pos7 = sum(1 for item in d7 if float(item.get("sentiment") or 0) > 0.15)
            neg7 = sum(1 for item in d7 if float(item.get("sentiment") or 0) < -0.15)
            high = sum(1 for item in d7 if float(item.get("eventStrength") or 0) >= 0.7)
            momentum = sum(
                float(item.get("eventStrength") or 0) * (1 if float(item.get("sentiment") or 0) >= 0 else -1)
                for item in d7
            )
            earn = [
                float(item.get("sentiment") or 0)
                for item in d7
                if is_earnings_event(str(item.get("eventType") or ""))
            ]
            sent_7 = mean(sent7)
            sent_30 = mean(sent30)
            out.append(
                {
                    "symbol": symbol,
                    "asOfDate": day.isoformat(),
                    "availableAt": day.isoformat(),
                    "newsCount1d": float(len(d1)),
                    "newsCount7d": float(len(d7)),
                    "newsCount30d": float(len(d30)),
                    "newsSent1d": mean(sent1),
                    "newsSent7d": sent_7,
                    "newsSent30d": sent_30,
                    "newsSentStd7d": stdev(sent7),
                    "newsSentChange7d": mean(sent1) - sent_7,
                    "newsSentTrend30d": sent_7 - sent_30,
                    "newsPos7d": float(pos7),
                    "newsNeg7d": float(neg7),
                    "newsHighImpact7d": float(high),
                    "newsEventMomentum7d": clip(momentum, -50.0, 50.0),
                    "earningsSentiment": mean(earn),
                }
            )
    return out


def aggregate_social_daily(posts: Iterable[Dict[str, object]]) -> List[Dict[str, object]]:
    """posts: symbol, available_at, sentiment, author, text, trends optional."""
    by_symbol: Dict[str, List[Dict[str, object]]] = {}
    for row in posts:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        by_symbol.setdefault(symbol, []).append(row)
    out: List[Dict[str, object]] = []
    for symbol, rows in by_symbol.items():
        parsed = []
        for row in rows:
            raw = row.get("available_at") or row.get("created_at")
            if isinstance(raw, datetime):
                when = raw
            else:
                when = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            parsed.append({**row, "_when": when, "_day": utc_day(when)})
        days = sorted({item["_day"] for item in parsed})
        for day in days:
            def window(days_back: int) -> List[Dict[str, object]]:
                start = day - timedelta(days=days_back - 1)
                return [item for item in parsed if start <= item["_day"] <= day]

            d1 = window(1)
            d7 = window(7)
            d20 = window(20)
            mentions_1d = float(len(d1))
            mentions_7d = float(len(d7))
            baseline = max(len(d20) / 20.0, 0.05)
            spike = clip(mentions_1d / (baseline * 20 / max(len(d20), 1) if d20 else 1.0), 0.0, 50.0)
            if baseline > 0:
                spike = clip(mentions_1d / max(baseline, 0.05), 0.0, 50.0)
            growth = clip((mentions_1d - baseline) / max(baseline, 0.05), -50.0, 50.0)
            authors = {str(item.get("author") or "") for item in d1 if item.get("author")}
            sent1 = [float(item.get("sentiment") or 0) for item in d1]
            sent7 = [float(item.get("sentiment") or 0) for item in d7]
            prev7 = window(14)
            prev_only = [item for item in prev7 if item["_day"] < day - timedelta(days=6)]
            sent_prev = [float(item.get("sentiment") or 0) for item in prev_only]
            bull = sum(1 for item in d7 if float(item.get("sentiment") or 0) > 0.15)
            bear = sum(1 for item in d7 if float(item.get("sentiment") or 0) < -0.15)
            texts = [str(item.get("text") or item.get("title") or "").strip().lower()[:80] for item in d1]
            unique_texts = len(set(t for t in texts if t))
            coord = 0.0
            if len(d1) >= 4 and unique_texts:
                coord = clip(1.0 - unique_texts / max(len(d1), 1), 0.0, 1.0)
            trends = [float(item.get("trends") or 0) for item in d7 if item.get("trends") is not None]
            trends_prev = [float(item.get("trends") or 0) for item in prev_only if item.get("trends") is not None]
            out.append(
                {
                    "symbol": symbol,
                    "asOfDate": day.isoformat(),
                    "availableAt": day.isoformat(),
                    "mentions1d": mentions_1d,
                    "mentions7d": mentions_7d,
                    "mentionGrowth": growth,
                    "attentionSpike": spike,
                    "uniqueAuthors1d": float(len(authors)),
                    "sentiment1d": mean(sent1),
                    "sentimentChange": mean(sent1) - mean(sent_prev or sent7),
                    "bullRatio7d": bull / max(len(d7), 1),
                    "bearRatio7d": bear / max(len(d7), 1),
                    "coordination": coord,
                    "trendsScore7d": mean(trends) / 100.0 if trends else 0.0,
                    "trendsChange7d": (mean(trends) - mean(trends_prev)) / 100.0 if trends else 0.0,
                }
            )
    return out
