# F0 freeze / regression audit

**Authorization:** `implement f0` (2026-09-17)  
**Independent re-verify:** 2026-09-17 (this execution)  
**Workstream:** verify, record, inventory, regression-test  
**Not done:** ranking changes, auth changes, providers, UI, product behavior, F1–F6 implementation

```text
A      PASS
D/E    PASS
B      PASS
C      PASS
F0     PASS
       HARD STOP
F1–F6  NOT STARTED
```

This document **freezes F1+ contracts on paper only**. It does not implement them.

---

## Regression pack (executed this run)

| Gate                              | Spec                                                                  | Result |
| --------------------------------- | --------------------------------------------------------------------- | ------ |
| A identity / quarantine           | `packages/shared-utils/src/trader-agent/batch-identity.spec.ts`       | PASS   |
| B TD freeze / no indicator APIs   | `twelve-data-client.spec.ts`, `batch-data-preparation.spec.ts`        | PASS   |
| C evidence                        | `phase-c-evidence.spec.ts`                                            | PASS   |
| Isolation                         | `intelligence-isolation.spec.ts`, `intelligence-batch.spec.ts`        | PASS   |
| Ranking lexicographic (unchanged) | `t1-8-opportunity-ranking.spec.ts`                                    | PASS   |
| D/E consume-only                  | `apps/frontend-react/src/lib/multi-asset-batch.test.ts` (12)          | PASS   |
| Batch freeze contract             | `apps/trader-agent/src/agent/intelligence-batch-contract.spec.ts` (8) | PASS   |
| Shared-utils full unit            | 70 suites / 594 tests                                                 | PASS   |

Shared-utils F0 subset: **7 suites, 100 tests PASS**.

Cypress 6-screen consume-only was **not re-run** in this F0 session (no live frontend server). D/E unit consume-only is the executed UI gate. Last Cypress screenshots remain under `apps/frontend-react/cypress/screenshots/multi-asset-batch.cy.ts/`.

---

## Source freeze (verified this run)

- Twelve Data client HTTP paths are `/time_series`, `/forex_pairs`, `/press_releases` only. `FORBIDDEN_INDICATOR_PATH` exists as a guard. No `/rsi` `/ema` `/macd` `/atr` `/adx` `/bbands` `/vwap` path literals used as call targets in `twelve-data-client.ts`.
- `opportunity-ranking-engine.ts` does **not** import or call `evaluateRisk` / `evaluatePortfolio` / `simulateRevalidatingGate`.
- `stripFromCandidate` does **not** read `fundamental`, `news`, `sentiment`, or `macro`.
- `universeForcesNotReady`:
  - `MCX_FUTURES_ALL` → `MCX_FUTURES_NO_APPROVED_FEED`
  - `CME_FUTURES_ALL` → `CME_FUTURES_NO_APPROVED_FEED`
  - `FUTURES_ALL` → `GENERIC_FUTURES_UNSUPPORTED`
- MCX hydrate test: `NOT_READY`, `fetchJson` never called (no scrape).
- Commodities: `selectBatchProvider` still `keyless-commodity+eia-bulk` with `TWELVE_DATA_REQUIRES_GROW`.
- FE `multi-asset-batch.ts` formats backend coverage / `validResultRows`; it does not compute `RankingContext`.

---

## Coverage freeze debt (recorded, not “fixed”)

`npx jest --watchAll=false --coverage --coverageReporters=text-summary` in `@stockpred/shared-utils` (this F0 run):

```text
Statements   76.03%   (7516/9885)   gate 80%  MISS
Branches     63.14%   (4845/7673)   gate 65%  MISS
Functions    77.23%   (1150/1489)   gate 75%  PASS
Lines        80.31%   (6706/8350)   gate 80%  PASS
```

CI job `npm run test:coverage -w @stockpred/shared-utils` will fail on statements/branches. F0 does **not** add unrelated tests to raise the percentage. This remains freeze debt for a later coverage-only decision — not F1–F6.

---

## Inventory (read-only) → F1+ contracts frozen on paper

### F1 Ranking evolution (NOT STARTED)

**Gap:** `attachBatchInstrumentToIntelligenceSnapshot` already copies `fundamental` / `news` / `sentiment` / batch `macro` onto `IntelligenceSnapshot`. `stripFromCandidate` ignores those fields.

**Current dimensions** in `dimensionPrecedenceForContext`: LIQUIDITY / FRESHNESS / MTF / EV / RS / REGIME / EVENT_RISK / TECHNICAL / SECTOR / PORTFOLIO_FIT (horizon-scoped). PORTFOLIO_FIT remains last, tie-break only.

**Frozen contract (do not implement until `implement F1` / `start F1`):**

```text
RankingContext → ordered opportunities only
Not: Ranking → Risk → Gate → Execution
Missing C evidence → UNKNOWN / DATA_INCOMPLETE (never 0 / NEUTRAL)
Macro → same batch snapshot.macro context, not per-symbol CPI
Lexicographic + stale-state + DATA_INCOMPLETE rules stay
FE consumes backend rank only
```

### F2 Auth / security hardening (NOT STARTED)

**Today:**

- `JwtAuthGuard` rejects missing/invalid Bearer.
- `OptionalJwtAuthGuard` returns true when the token is missing (paper usable).
- `RolesGuard` enforces role + suspended.
- Trading chain in `authorization-test-harness.ts`: `evaluateTrade` → `evaluateRisk` → `evaluatePortfolio` → `applyDecisionPolicy` → optional `simulateRevalidatingGate`.

**Frozen contract (until `implement F2` / `start F2`):**

```text
Decision → Risk → Portfolio → Policy → Gate → Execution  (unchanged semantics)
Harden identity/session/s2s/RBAC/audit only
E2E required: unauthorized identity → request → execution attempt → REJECTED
Ranking / Intelligence / ML / UI / batch cannot authorize
```

### F3 MCX / CME (NOT STARTED)

Keep `NOT_READY` until a machine-readable feed is approved. Path: discover → validate feed → identity → session/calendar → historical/live/delayed → hydrate → freeze. Universes stay separate: `MCX_FUTURES_ALL`, `CME_FUTURES_ALL`. `FUTURES_ALL` stays `GENERIC_FUTURES_UNSUPPORTED`. No scraping.

**Spec gap (inventory only, not filled in F0):** `batch-data-preparation.spec.ts` asserts MCX/CME `NOT_READY`. It does **not** assert `universeForcesNotReady('FUTURES_ALL') === 'GENERIC_FUTURES_UNSUPPORTED'`. Source still returns that reason. Do not add a padding test here.

### F4 Commodity provider (NOT STARTED)

Keep `TWELVE_DATA_REQUIRES_GROW`. No TD commodity endpoints until upgraded TD **or** another approved provider. `COMMODITY` ≠ `COMMODITY_FUTURE` ≠ MCX ≠ CME. Current hydrate remains keyless Yahoo+EIA.

### F5 Crypto on-chain (NOT STARTED)

Spot price (Binance / CoinGecko / TD) ≠ on-chain analytics. On-chain attaches as evidence on `IntelligenceSnapshot` then ProfessionalTrader / TradePlan / RankingContext. Never on-chain → BUY/SELL / Risk bypass / Gate bypass. Missing → `UNAVAILABLE`, not `0`.

### F6 Social / Reddit (NOT STARTED)

Evidence only: ingest → frozen-alias entity resolution → dedupe/spam → timestamps → MODEL_DERIVED → IntelligenceSnapshot. No guessed symbols, no fabricated sentiment, no social-volume automatic signal, no social → execution.

### Permanently out of roadmap

```text
TD indicator APIs
Generic FUTURES_ALL
MCX/CME scraping
Frontend ranking
Frontend auth decisions
Roadmap/wireframe UI implementation
Intelligence → execution
ML/LLM → execution
Ranking → order / resize / veto
```

---

## F0 PASS criteria

```text
A/D/E/B/C regression green
source freeze: no /rsi /macd /adx in TD client
MCX/CME still NOT_READY
FUTURES_ALL still unsupported
ranking still not in Risk/Gate
coverage miss documented, not silently ignored
F1–F6 still NOT STARTED
HARD STOP
```

All met. No ranking / auth / provider / UI source files were changed in F0.

Next valid implementation authorization is **not** this audit. It is exactly `implement F1` or `start F1`.
