# Historical Intelligence Multi-Engine — Implementation Report

## Gate status (FROZEN)

**Overall: PARTIAL PASS — implementation complete, evidence gate not fully passed.**

```text
Implementation completeness ≠ predictive validation
```

| Wave                           | Status                       |
| ------------------------------ | ---------------------------- |
| A Historical Core              | PASS                         |
| B Evidence Layer               | PASS                         |
| C Reliability Infrastructure   | PASS                         |
| D ML Improvement Proof         | INCONCLUSIVE                 |
| E Batch / Continuous / UI      | PASS                         |
| F Crown / Regression           | PASS                         |
| Prediction Quality Gate        | PARTIAL                      |
| Improvement vs Existing Engine | **IMPROVEMENT NOT VERIFIED** |
| **Overall**                    | **PARTIAL PASS**             |

Do **not** upgrade to PASS because unit tests/typecheck are green. Do **not** reopen A–F architecture.

### Gaps (never fabricate)

| Gap                                | Status                              |
| ---------------------------------- | ----------------------------------- |
| Survivorship-safe NIFTY membership | UNAVAILABLE                         |
| Corporate-action adjusted history  | UNAVAILABLE (`AS_PROVIDED_CANDLES`) |
| New ML training + lift             | IMPROVEMENT NOT VERIFIED            |
| Batch-time historical matches      | UNAVAILABLE (no N×MDS at finalize)  |

Correct statement until matched walk-forward returns **IMPROVED**:

> **IMPROVEMENT NOT VERIFIED** — infrastructure exists to _test_ improvement; improvement is not proven.

Authorization unchanged: Historical / BullRun / Evidence / ML / FE → ProfessionalTrader → Recommendation → evaluateTrade() → Risk → Portfolio → Policy → Gate → Execution.

---

## Proof milestone (this deliverable)

See [historical-validation-ml-proof.md](./historical-validation-ml-proof.md).

| Deliverable                                                    | Status                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| MDS candle → `assessHistoricalIntelligence` on bull-run detail | Done                                                                             |
| Matched WF protocol + gross/net verdicts                       | Done (`historical-prediction-proof.v1`)                                          |
| Validation UI surfaces verdict + frozen PARTIAL PASS           | Done                                                                             |
| Claim upgraded to IMPROVED                                     | **Only if** artifact verdict = IMPROVED (not claimed by shipping this milestone) |

---

## 1. Files changed / added (A–F + proof)

### New

- `packages/shared-types/src/historical-intelligence.ts`
- `packages/shared-utils/src/trader-agent/historical-intelligence-engine.ts`
- `packages/shared-utils/src/trader-agent/evidence-validation-layer.ts`
- `packages/shared-utils/src/trader-agent/prediction-reliability.ts`
- `packages/shared-utils/src/trader-agent/historical-intelligence.spec.ts`
- `packages/shared-utils/src/trader-agent/historical-prediction-proof.ts`
- `apps/trader-agent/src/agent/historical-prediction-proof-store.ts`
- `apps/frontend-react/src/pages/IntelligenceValidationPage.tsx`
- `docs/historical-intelligence-implementation-report.md`
- `docs/historical-validation-ml-proof.md`

### Modified

- shared-types index, bull-run-v2 report fields
- bull-run-v2-engine (analogue distribution feed)
- batch-research-report (evidence packages)
- professional-trader-engine (confidence ≠ probability; evidence/historical narrative)
- continuous-intelligence-engine (`planTargetedIntelligenceRefresh`)
- MDS `b9-b17-intelligence.service` + `market.controller` (candle-backed historical + analogues route)
- api-gateway proxies (`historical-analogues`, `historical-prediction-proof`)
- MarketOverviewPage (Why/Evidence)
- App.tsx route `/intelligence-validation`
- api.ts report types + proof query

## 2–20. Summary

ML comparative lift remains **IMPROVEMENT NOT VERIFIED** until a matched walk-forward run returns **IMPROVED**. Shipping the protocol and wiring does not by itself prove better predictions.
