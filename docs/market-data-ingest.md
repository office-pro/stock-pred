# Market data ingest contract

Status: **implemented** (labels + session helpers). Does **not** replace the trading quote-age gate.

## Modes

| Mode                  | When                                                                     | Live entry?               |
| --------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `LIVE_INGEST`         | Yahoo live provider, or quick-start simulated ticks                      | Only if quote also `LIVE` |
| `EOD_INGEST`          | Official bhavcopy / index closes (no live ticks)                         | Never                     |
| `HISTORICAL_BACKFILL` | Multi-session bhavcopy history job (logged; process mode stays LIVE/EOD) | Never                     |

Process mode is resolved at market-data startup via `resolveActiveIngestMode`. Quotes stamp `ingestMode` on every `StockQuote`.

## Freshness status

| Status          | Meaning                                               | `liveUsable` |
| --------------- | ----------------------------------------------------- | ------------ |
| `LIVE`          | NSE cash session open and quote age ≤ 60s             | true         |
| `CLOSED_MARKET` | Session closed; EOD/latest session OK for ML/analysis | false        |
| `STALE`         | Session open but quote too old / missing timestamp    | false        |

Helpers: `@stockpred/shared-utils` — `classifyQuoteStatus`, `isUsableForLiveTrading`, `isUsableForAnalysis`, `isNseCashSessionOpen`.

## Trading gate (unchanged)

Risk / evaluate still rejects on quote age > **60_000 ms** (`DATA_STALE`). `liveUsable` is a label for consumers; it does **not** bypass that gate.

## Ops endpoint

`GET /market/data-contract` (gateway: `/api/market/data-contract`) returns:

```text
ingestMode
nseCashSessionOpen
quoteStatus          // LIVE | CLOSED_MARKET | STALE (sample symbol)
liveUsable
sampleSymbol
sampleUpdatedAt
note
```

These fields are **data status only** — not trade authorization. Risk still enforces 60s quote age.

## P5 note

When the market is closed, EOD/historical ingestion can still run, but it **does not** satisfy live quote freshness for Agent Desk APPROVE → fill.
