# Historical Validation & ML Proof

## Status (honest)

| Item                                       | Status                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| A–F architecture                           | **FROZEN** at PARTIAL PASS                                               |
| Matched walk-forward protocol              | **IMPLEMENTED** (`historical-prediction-proof.v1`)                       |
| Candle → historical analogues (MDS detail) | **WIRED** (bull-run path + `/intelligence/historical-analogues/:symbol`) |
| Batch N×MDS historical recompute           | **NOT DONE** (by design — UNAVAILABLE at finalize)                       |
| Survivorship / corp-action                 | **UNKNOWN** / **AS_PROVIDED_CANDLES**                                    |
| Regime×horizon calibration                 | **UNAVAILABLE** until labeled store ≥ min-sample                         |
| Improvement claim                          | **IMPROVEMENT NOT VERIFIED** until verdict = **IMPROVED**                |

Authorization unchanged: advisory engines → ProfessionalTrader → Recommendation → `evaluateTrade()` → Risk → Portfolio → Policy → Gate → Execution.

---

## Matched protocol

Baseline and enhanced arms share:

- same close series / evaluation folds
- same horizon (`3M`)
- same universe treatment (`UNKNOWN` membership)
- same price basis (`AS_PROVIDED_CANDLES`)
- same cost haircut (`ROUND_TRIP_HAIRCUT`, default 20 bps round-trip)
- same leakage rule (as-of index only; no future bars)

**Baseline:** empirical candle P(max fwd ≥ 0) → directional hit.  
**Enhanced:** historical-analogue forward distribution when sample-sufficient; else baseline (no fabrication).

Verdicts:

- `IMPROVED` — gross hit-rate lift ≥ 1pp and net not worse
- `NOT_IMPROVED` — enhanced underperforms by ≥ 1pp
- `INCONCLUSIVE` — under-sampled, delta within ±1pp, or protocol mismatch

Only `IMPROVED` may replace **IMPROVEMENT NOT VERIFIED**.

---

## How to run

1. Unit harness: `packages/shared-utils` → `historical-intelligence.spec.ts` (`runMatchedHistoricalPredictionProof`).
2. Agent: `POST /agent/historical-prediction-proof` with `{ symbol, closes[], universe? }` → persists `apps/trader-agent/data/historical-prediction-proof-latest.json`.
3. Read: `GET /agent/historical-prediction-proof` (gateway + Validation UI).

NIFTY50 multi-symbol offline proof is the next evidence step after single-series protocol is green; NIFTY500 stays NOT VERIFIED without data coverage.

---

## Files

- `packages/shared-utils/src/trader-agent/historical-prediction-proof.ts`
- `apps/trader-agent/src/agent/historical-prediction-proof-store.ts`
- MDS `b9-b17-intelligence.service` bull-run historical attach
- `apps/frontend-react/src/pages/IntelligenceValidationPage.tsx`
- `docs/historical-intelligence-implementation-report.md` (gate table frozen)
