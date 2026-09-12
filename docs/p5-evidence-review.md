# P5 Evidence Review (runtime export)

**Status:** P5 Evidence Window — Phase 3–4 resilience engineering landed; ACTUAL floors still unmet.  
**Does not modify runtime policy.** Does not set the ARM latch. P6 implementation complete; P6 activation stays blocked.

```text
P1–P5 implementation     DONE
P6 implementation        DONE (activation BLOCKED)
P5 Evidence Window       IN PROGRESS (Phase 3 resilience + ACTUAL collection)
P5 Evidence Review       ← this document (runtime export)
OVERALL                  INCONCLUSIVE
Reason                   ACTUAL outcome floors unmet (not an intelligence NO-GO)
```

**Definition of evidence generation** (locked): not a new trading capability — see [`p5-next-ai-instruction.md`](p5-next-ai-instruction.md#evidence-generation-definition-lock). Pipeline is P5 runtime → real human decisions → real outcomes → read-only aggregation → snapshot → O/I/L/C → four-row GO/NO-GO.

**Phase 3 resilience lock:** Offline → Intelligence → Focus → Live refresh → Opportunity → Human → Existing authorization → Execution. Never: Focus→auto-approve · DELAYED→bypass Risk · Focus tier→authorization.

Companion snapshot: [`apps/trader-agent/data/p5-evidence-review-latest.json`](../apps/trader-agent/data/p5-evidence-review-latest.json)  
Export tool: `node apps/trader-agent/scripts/export-p5-evidence-review.mjs`

---

## Session 3 — Offline/Delayed resilience + evidence path (2026-09-12)

### Phase A/B ops checkpoint (2026-09-12 evening IST) — PASS → STOP until NSE

| Check                                                        | Result                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Rebuild `market-data-service`, `trader-agent`, `api-gateway` | **PASS**                                                                             |
| Health `:3000` `:3002` `:3008` `:8080`                       | **200**                                                                              |
| `POST /market/focus-refresh`                                 | **200** refreshed=2                                                                  |
| `GET /market/data-contract`                                  | `CLOSED_MARKET` (weekend); taxonomy recognized                                       |
| `POST /agent/focus-universe/run-offline`                     | **201** `FOCUS-1789224241637` (RankingContext `lexicographic-context-precedence.v1`) |
| `GET` latest (direct + gateway)                              | **200** same `batchId`                                                               |
| Tiers                                                        | T1=15 T2=25 (40 candidates; T3 empty at this size)                                   |
| Ledger mutation from offline batch                           | **None** (entries remain **63**)                                                     |
| Desk provenance                                              | `OFFLINE_PRESELECTED` + `LIVE_DISCOVERED`; `liveReady=false` while closed            |

**Defect fixed during A/B:** `EACCES` writing Focus artifact as `node` user — store prefers `REPO_ROOT=/workspace` bind-mount; Dockerfile chowns `apps/*/data`. Compose sets `REPO_ROOT: /workspace` (not host Windows path).

**STOP:** Phases C–F wait for next NSE cash session. No further engineering unless ops exposes another defect.

---

### Engineering delivered (Phase 3.1–3.5)

| Item                                                               | Status                    |
| ------------------------------------------------------------------ | ------------------------- |
| Freshness taxonomy LIVE≤30s / DELAYED 30–60s / STALE>60s / UNKNOWN | **PASS** (unit tests A–D) |
| Risk `DATA_STALE` still at 60s; DELAYED never bypasses auth        | **PASS**                  |
| Read-only offline FocusUniverseBatch (EOD/cached; no ledger/auth)  | **PASS** (API + artifact) |
| Focus tiers from RankingContext rank order only (no RankingScore)  | **PASS**                  |
| Offline → live handoff + provenance stamps                         | **PASS**                  |
| Desk provenance chips + probe Focus checks                         | **PASS**                  |

### Resilience checklist (under O/I/L/C — no fifth gate)

| Row                  | Evidence                                                                       | Session 3                                           |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| TECHNICAL SAFETY     | Offline read-only; DELAYED/STALE/UNKNOWN; auth intact; no Focus/DELAYED bypass | **PASS** (engineering)                              |
| INTELLIGENCE QUALITY | Offline batch + Focus usefulness; delayed intel labeled                        | **REVIEW** (ops observation pending market hours)   |
| HUMAN VALUE          | Preselection / provenance clarity on Desk                                      | **REVIEW** (UI shipped; human confirmation pending) |
| EXECUTION QUALITY    | Freshness contract; STALE blocked; PAPER→ACTUAL                                | **REVIEW** — ACTUAL floors unmet                    |

### Offline / delayed observation grid

| Observation                              | Status                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| Offline batch completed                  | **PASS** (when `POST /agent/focus-universe/run-offline` run) |
| Focus universe generated                 | **PASS** (`focus-universe-latest.json`)                      |
| Offline → live handoff                   | **PASS** (code path; live refresh when session open)         |
| Fresh data (LIVE)                        | observed when session open + age≤30s                         |
| 30–60s delayed (DELAYED)                 | taxonomy + tests                                             |
| >60s stale (STALE)                       | taxonomy + Risk block tests                                  |
| Unavailable (UNKNOWN)                    | taxonomy + tests                                             |
| Intelligence preserved (not neutralized) | **PASS** (labels retained)                                   |
| Execution safety preserved               | **PASS** (Risk 60s unchanged)                                |

### ACTUAL outcomes (Session 3)

- **0** new UNIQUE ACTUAL with `realizedR` this session date (weekend / session closed at engineering land).
- Floors remain **UNMET** until next NSE cash session: human WAIT/REJECT/APPROVE → PAPER → natural close → ≥10 ACTUAL.

### Ops runbook for 3.6–3.12 (next NSE open)

1. `POST /agent/focus-universe/run-offline` (pre-open, EOD/cached)
2. At 09:15 IST: Refresh opportunities (handoff refreshes Tier1→2→3)
3. Confirm `data-contract` LIVE or DELAYED; Desk shows provenance; OFFLINE_PRESELECTED ≠ LIVE_READY until liveReady
4. Diverse human WAIT / REJECT / APPROVE (APPROVE only when Risk does not DATA_STALE)
5. PAPER fill → natural close → ACTUAL + realizedR until ≥10 UNIQUE
6. Re-export + re-score O/I/L/C (floors unchanged)

---

## Session 2 — Resumption attempt (2026-09-02, ~10:00 IST)

### Preflight

| Check                                        | Result                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| API gateway `:3000/health`                   | **200**                                                                         |
| Trader-agent `:3008/health`                  | **200**                                                                         |
| Market-data `:3002/health`                   | **200**                                                                         |
| NSE cash session                             | **OPEN** (`nseCashSessionOpen=true`)                                            |
| Quote freshness                              | **STALE** (`quoteStatus=STALE`, `liveUsable=false`) — same blocker as Session 1 |
| `GET /market/data-contract` (direct `:3002`) | `ingestMode=LIVE_INGEST`, sample stale                                          |
| Session 1 baseline export                    | **Confirmed** — reviewed=31, humanApprove=0, ACTUAL=0, qualityVsRealizedR=0     |
| Ledger append-only                           | **Preserved** — no manual edits                                                 |

### Human evidence (Session 2)

- Agent Desk readiness checked via `GET /agent/mode` — PAPER, APPROVAL mode, trading enabled, evidence `INCONCLUSIVE`.
- `GET /agent/opportunities` returned **500** after extended wait — desk could not serve new opportunity rows this session.
- **No new** human APPROVE / WAIT / REJECT rows appended (ledger counts unchanged from Session 1).
- APPROVE would remain blocked by `DATA_STALE` until `quoteStatus=LIVE` (≤60s quote age).

### ACTUAL outcomes (Session 2)

- **0** new `OUTCOME_RECORDED` rows with `outcomeKind=ACTUAL`.
- `withRealizedR=0`, `qualityVsRealizedRSamples=0` — floors still **UNMET**.

### P5 unlock check

```text
GET /agent/p5-evidence-unlock
→ unlocked=false, overallDecision=INCONCLUSIVE
```

**ARM status:** Not armed. P6 activation remains blocked.

---

## Session 1 — Review window (baseline preserved)

| Field                                       | Value                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Review kind                                 | Runtime disk export (P5 Evidence Window Session 1)                                            |
| Generated                                   | 2026-09-02T01:48:23Z                                                                          |
| Decision ledger path                        | `apps/trader-agent/data/decision-ledger.json`                                                 |
| Ledger present                              | **Yes**                                                                                       |
| Decision entries                            | **63**                                                                                        |
| Human-reviewed rows                         | **31** (floor: ≥20) **MET**                                                                   |
| Paper sample count                          | **40** (floor: paper+live ≥20) **MET**                                                        |
| Live sample count                           | **0**                                                                                         |
| ACTUAL outcome rows                         | **0** (floor: ≥10) **UNMET**                                                                  |
| `human-intel-metrics` (offline from ledger) | reviewed=31, agreementPct≈41.9, qualityVsRealizedRSamples=0 (floor: ≥10) **UNMET**            |
| humanWaitCount                              | **19**                                                                                        |
| humanApproveCount                           | **0**                                                                                         |
| humanRejectCount                            | **12**                                                                                        |
| waitThenLaterCount                          | **2** (WAIT → later REJECT transitions observed)                                              |
| withRealizedR                               | **0**                                                                                         |
| LIVE / Gate rows on ledger                  | **0** (`withGate=0`)                                                                          |
| Unauthorized LIVE `AUTO_ACCEPTED`           | **0**                                                                                         |
| Mode during run                             | PAPER (LIVE broker not configured; PAPER-first evidence environment)                          |
| P4 soak reference                           | `apps/trader-agent/data/paper-soak-report-latest.json` (`SOAK-2026-08-22-513`, status KILLED) |
| Calendar note                               | Session 1 ran pre-market (2026-09-02 ~06:50–07:20 IST). Stale quotes blocked APPROVE fills.   |

**Sample adequacy:** **INCONCLUSIVE** — `reviewed≥20` and `paper+live≥20` now met; `actualFills≥10` and `qualityVsRealizedRSamples≥10` remain unmet. Technical Safety remains assessable from P5 implementation + tests.

---

## Gate classification (exactly four rows)

```text
TECHNICAL SAFETY       PASS
INTELLIGENCE QUALITY   REVIEW
HUMAN VALUE            REVIEW
EXECUTION QUALITY      REVIEW

OVERALL                INCONCLUSIVE
Reason                 ACTUAL outcome floors unmet
```

Portfolio remains **evidence-only** (not a fifth gate row).

---

## 1. Technical Safety

### Observed

- LIVE arming blocked while evidence OVERALL≠GO (`liveAutoEffective=false`).
- LIVE broker not configured; mode stayed PAPER.
- Unauthorized LIVE AUTO_ACCEPTED = 0.
- APPROVE attempts rejected by quote-age policy (`DATA_STALE`, quote age ≫ 60s) — not bypassed.
- `liveAutoArmed=false` throughout session.
- **Session 2:** Stack healthy during NSE hours; safety controls unchanged; no ARM attempted.

### Interpretation

Safety controls that must hold before any P6 activation are behaving as designed on this runtime.

### Limitations

- No LIVE Gate pass/block series in this window (LIVE unavailable).

### Reviewer conclusion

**PASS**

---

## 2. Intelligence Quality

### Observed

- Intelligence snapshots present on 40 PAPER decision rows with full T1/T2 stack materialization.
- Agent recommendations: APPROVE=11, WAIT=11, REJECT=9.
- `qualityVsRealizedRSamples=0` — no closed ACTUAL outcomes with realizedR to compare against quality bands.

### Interpretation

Intelligence pipeline records rich snapshots on human-reviewed decisions, but quality vs realized R cannot be scored without trade closes.

### Limitations

- Zero realizedR / ACTUAL outcome rows.
- Pre-market stale quotes prevented APPROVE from reaching execution.
- **Session 2:** Quotes still STALE during market hours; no new closes to score.

### Reviewer conclusion

**REVIEW**

---

## 3. Human Value

### Observed

- Genuine human decisions via normal Agent Desk API: `humanWaitCount=19`, `humanRejectCount=12`, `humanApproveCount=0`.
- `reviewed=31` exceeds the 20-decision floor.
- Agreement≈42%, overrides≈58% on reviewed=31.
- WAIT lifecycle exercised: `waitThenLaterCount=2` (e.g. TIMEX WAIT → later REJECT with `humanDecision=HUMAN_REJECT`).
- Decision diversity achieved without auto-approving everything.

### Interpretation

Human-validation path is working end-to-end for WAIT and REJECT. Human APPROVE path is blocked by stale quotes in this session, not by missing plumbing.

### Limitations

- No human APPROVE fills or closes yet.
- APPROVE attempts correctly rejected by policy until fresh quotes are available.
- **Session 2:** Opportunities endpoint 500; no new human decisions recorded.

### Reviewer conclusion

**REVIEW**

---

## 4. Execution Quality

### Observed

- APPROVE attempts (EBGNG, ICICIBANK, AXISBANK, PARAGMILK) rejected by policy: quote age ≫ 60s.
- `withGate=0`, no fill/slippage/latency series from human-approved trades.
- `withRealizedR=0`, zero ACTUAL `OUTCOME_RECORDED` rows.

### Interpretation

Execution quality cannot be affirmed; Gate/fill/close evidence is absent because no APPROVE reached execution in this session.

### Limitations

- Pre-market stale quotes blocked PAPER APPROVE.
- LIVE pipeline not runnable (broker not configured).
- **Session 2:** `withGate=0` unchanged; desk could not serve opportunities for new execution evidence.

### Reviewer conclusion

**REVIEW**

---

## Portfolio (evidence-only)

### Observed

Ranking / portfolio-fit fields present on opportunity ranking batches; not used as authorization.

### Reviewer conclusion

Evidence-only; **incomplete** for this window (no realizedR linkage).

---

## Overall

| Gate row             | Result           |
| -------------------- | ---------------- |
| TECHNICAL SAFETY     | PASS             |
| INTELLIGENCE QUALITY | REVIEW           |
| HUMAN VALUE          | REVIEW           |
| EXECUTION QUALITY    | REVIEW           |
| **OVERALL**          | **INCONCLUSIVE** |

**Rules applied:** `reviewed≥20` and `paper+live≥20` met, but `actualFills≥10` and `qualityVsRealizedRSamples≥10` unmet → **INCONCLUSIVE** (not an intelligence NO-GO). TECHNICAL SAFETY PASS. Three REVIEW categories — cannot assess GO until ACTUAL outcome floors met and evidence supports readiness.

### Reviewer rationale (Session 2)

Session 2 resumption ran during NSE market hours with stack healthy, but **quote freshness remained STALE** and the opportunities endpoint failed (500). Session 1 ledger baseline is **unchanged** — no fabricated samples. Human APPROVE and ACTUAL outcome collection remain blocked until live quotes (≤60s) flow and Agent Desk serves opportunities. **INCONCLUSIVE** is correct; this is not an intelligence NO-GO.

### ARM status

**Not armed.** `ARM LIVE AUTONOMOUS` must not be used while OVERALL≠GO.

### Missing before next re-score

| Floor                     | Current                                 | Target                                | Gap | Status                |
| ------------------------- | --------------------------------------- | ------------------------------------- | --- | --------------------- |
| Human-reviewed            | 31                                      | ≥20                                   | —   | **MET**               |
| paper+live decisions      | 40                                      | ≥20                                   | —   | **MET**               |
| ACTUAL outcomes           | 0                                       | ≥10 distinct decisionIds              | +10 | **UNMET**             |
| qualityVsRealizedRSamples | 0                                       | ≥10                                   | +10 | **UNMET**             |
| Live quote freshness      | CLOSED_MARKET / DELAYED / LIVE taxonomy | LIVE or DELAYED (≤60s) during session | —   | **Session-dependent** |

**Next sessions (NSE market hours 09:15–15:30 IST, PAPER-first):**

1. Restore live quote ingest until `GET /market/data-contract` shows `quoteStatus=LIVE`
2. Agent Desk — human **APPROVE** on opportunities with fresh quotes (≤60s)
3. Drive APPROVE through full lifecycle → fill → close → `OUTCOME_RECORDED` with `outcomeKind=ACTUAL` and `realizedR`
4. Continue diverse WAIT / REJECT mix; let WAIT items progress naturally
5. Re-export when ACTUAL outcome floors approach target:

```bash
node apps/trader-agent/scripts/export-p5-evidence-review.mjs
```

6. Re-score this document; only human-confirmed GO unlocks P6 ARM eligibility
