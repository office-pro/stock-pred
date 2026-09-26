# Frozen-seam Consume + Hardening — Completion Report

**Date:** 2026-09-17  
**Plan:** Multi-Asset Consume Frozen Seam + Hardening (LOCKED)  
**Seam status:** CLOSED/FROZEN — adapters not redesigned

## Verdict

| Gate                                                                                  | Result                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Offline runtime validation                                                            | **PASS** (21/21)                                                                   |
| Crown unit tests (frozen-seam-consume / multi-asset / session-1d)                     | **PASS** (34/34)                                                                   |
| Package builds (shared-types, shared-utils, database, trader-agent, MDS, api-gateway) | **PASS**                                                                           |
| Live stack                                                                            | **PASS** (12/12) after rebuild of market-data-service / api-gateway / trader-agent |

## Critical defect fixed

**NSE_ALL / ALL membership no longer uses MDS cache symbols.**

- Before: `intelligence-batch.service` called `fetchCachedQuotesMap` → ~146 hydrated quotes became “universe”.
- After: `resolveNseAllMembership()` / Canonical Universe Registry from `equity-master.json` (NSE EQUITY_L via `ingest:listings`).
- Evidence: `nseAll.canonicalCompleteness` → eligible=**2125**, sourceCount=**4221**, version=`nse-all-69c9a4556cf7745a`, independent of MDS=146.

## Delivered by plan area

1. **Zero-hallucination** — `zero-hallucination-policy.ts`; LLM banned as data provider; missing → UNAVAILABLE/null.
2. **Three registries** — Canonical Universe (`packages/database/src/canonical-universe-registry.ts`) ≠ Instrument Registry ≠ Provider Registry.
3. **NSE_ALL** — atomic PUBLISH snapshots under `packages/database/data/universe-snapshots/`; completeness guard + last-known-good.
4. **Global \*\_ALL / US_SP500** — gated `UNSUPPORTED_UNIVERSE` until approved artifact exists.
5. **Lifecycle / ledger** — UniverseValidationResult, RefreshPolicy, DataIngestionRun.
6. **Source authority** — ProviderCapabilityAuthority; no simulated auto-failover; fallback cannot redefine membership.
7. **Market session** — backend `MarketSessionState` + `GET /market/session-state` (+ gateway proxy); FE MARKETS card via `DataReliabilityStrip`.
8. **Series / price** — extended SeriesProvenance + PriceSeriesPolicy; no silent raw/adjusted mix.
9. **Batch snapshot** — `universeVersion`, `membershipSource`, `eligibleCount` on IntelligenceBatch.
10. **Coverage** — totalEligible / pending / failed / NOT_APPLICABLE denominators.
11. **Benchmark / currency / OPTION** — non-NSE no silent NIFTY; CurrencyContext; OPTION identity note on InstrumentRef.
12. **Continuous** — `assertContinuousNotFullUniverseScan` forbids full NIFTY500 deep scan.
13. **Paper / learning** — batchId + universeVersion lineage; learning segregation by assetClass/venue/horizon.
14. **Sector / fundamentals / news** — effective-interval sector join; reported vs derived; entity mapping; no invented neutral sentiment.
15. **UI** — NSE_ALL label “canonical membership”; MARKETS session chips; ExecutionReady backend-only copy.

## Runtime gate evidence (offline)

```
[PASS] universe.nifty50 / nifty500
[PASS] capabilityCoverage reconcile
[PASS] gated.us / crypto / futures
[PASS] simulated.isolation
[PASS] ranking.independence
[PASS] zeroHallucination.llmNotDataSource
[PASS] sourceAuthority.noSimulatedAutoFailover
[PASS] continuous.forbidFullUniverse
[PASS] nseAll.canonicalCompleteness (eligible=2125)
[PASS] nseAll.lastKnownGoodGuard
[PASS] gated.universe.* → UNSUPPORTED_UNIVERSE
[PASS] marketSession.closedNotLive
[PASS] session1d.plus3pct (return1d=0.03 LIVE_LTP)
```

## Auth invariant

Unchanged: Recommendation → evaluateTrade → Risk → Portfolio → Policy → Gate → Execution.

## Follow-ups for operators

1. Rebuild frontend image when UI changes should be served on :8080 (`docker compose build frontend && docker compose up -d frontend`).
2. Refresh equity-master periodically via `npm run ingest:listings` (universe refresh ≠ market-data refresh).
3. Add approved `*.canonical.json` artifacts under `packages/database/data/universe-snapshots/` before enabling US_SP500 / \*\_ALL.
