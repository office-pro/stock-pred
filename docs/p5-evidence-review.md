# P5 Evidence Review (runtime export)

**Status:** P5 Evidence Window — Session 1 re-export.  
**Does not modify runtime policy.** Does not set the ARM latch. P6 implementation complete; P6 activation stays blocked.

```text
P1–P5 implementation     DONE
P6 implementation        DONE (activation BLOCKED)
P5 Evidence Window       IN PROGRESS
P5 Evidence Review       ← this document (runtime export)
OVERALL                  INCONCLUSIVE
Reason                   ACTUAL outcome floors unmet (not an intelligence NO-GO)
```

**Definition of evidence generation** (locked): not a new trading capability — see [`p5-next-ai-instruction.md`](p5-next-ai-instruction.md#evidence-generation-definition-lock). Pipeline is P5 runtime → real human decisions → real outcomes → read-only aggregation → snapshot → O/I/L/C → four-row GO/NO-GO.

Companion snapshot: [`apps/trader-agent/data/p5-evidence-review-latest.json`](../apps/trader-agent/data/p5-evidence-review-latest.json)  
Export tool: `node apps/trader-agent/scripts/export-p5-evidence-review.mjs`

## Review window

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

### Reviewer rationale

Session 1 produced genuine human-validation evidence: 31 reviewed decisions with diverse WAIT/REJECT and WAIT→later-REJECT lifecycle transitions. Human-reviewed and paper-decision floors are now met. However, zero ACTUAL outcomes and zero realizedR remain because pre-market stale quotes blocked all APPROVE paths. **INCONCLUSIVE means ACTUAL outcome floors unmet — continue evidence collection during NSE market hours; not a finding that intelligence is ineffective.**

### ARM status

**Not armed.** `ARM LIVE AUTONOMOUS` must not be used while OVERALL≠GO.

### Missing before next re-score

| Floor                     | Current | Target                   | Gap | Status    |
| ------------------------- | ------- | ------------------------ | --- | --------- |
| Human-reviewed            | 31      | ≥20                      | —   | **MET**   |
| paper+live decisions      | 40      | ≥20                      | —   | **MET**   |
| ACTUAL outcomes           | 0       | ≥10 distinct decisionIds | +10 | **UNMET** |
| qualityVsRealizedRSamples | 0       | ≥10                      | +10 | **UNMET** |

**Next sessions (NSE market hours 09:15–15:30 IST, PAPER-first):**

1. Agent Desk — human **APPROVE** on opportunities with fresh quotes (≤60s)
2. Drive APPROVE through full lifecycle → fill → close → `OUTCOME_RECORDED` with `outcomeKind=ACTUAL` and `realizedR`
3. Continue diverse WAIT / REJECT mix; let WAIT items progress naturally
4. Re-export when ACTUAL outcome floors approach target:

```bash
node apps/trader-agent/scripts/export-p5-evidence-review.mjs
```

5. Re-score this document; only human-confirmed GO unlocks P6 ARM eligibility
