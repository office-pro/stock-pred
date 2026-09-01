# P5 Evidence Review (runtime export)

**Status:** Runtime export + re-score.  
**Does not modify runtime policy.** Does not set the ARM latch. P6 code is complete; LIVE activation stays blocked while OVERALL is NO-GO.

```text
P1–P5 implementation     DONE
P6 code                  DONE (activation BLOCKED)
P5 Evidence Review       ← this document (runtime export)
OVERALL                  NO-GO
Reason                   insufficient runtime evidence
```

**Definition of evidence generation** (locked): not a new trading capability — see [`p5-next-ai-instruction.md`](p5-next-ai-instruction.md#evidence-generation-definition-lock). Pipeline is P5 runtime → real human decisions → real outcomes → read-only aggregation → snapshot → O/I/L/C → four-row GO/NO-GO.

Companion snapshot: [`apps/trader-agent/data/p5-evidence-review-latest.json`](../apps/trader-agent/data/p5-evidence-review-latest.json)  
Export tool: `node apps/trader-agent/scripts/export-p5-evidence-review.mjs`

## Review window

| Field                                       | Value                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Review kind                                 | Runtime disk export                                                                           |
| Generated                                   | 2026-08-23T10:08:09Z (re-export after REJECT enablement)                                      |
| Decision ledger path                        | `apps/trader-agent/data/decision-ledger.json`                                                 |
| Ledger present                              | **Yes**                                                                                       |
| Decision entries                            | **10**                                                                                        |
| Human-reviewed rows                         | **6**                                                                                         |
| Paper sample count                          | **10**                                                                                        |
| Live sample count                           | **0**                                                                                         |
| `human-intel-metrics` (offline from ledger) | reviewed=6, agreementPct≈33.3, qualityVsRealizedRSamples=0                                    |
| humanWaitCount                              | **6**                                                                                         |
| humanApproveCount                           | **0**                                                                                         |
| humanRejectCount                            | **0**                                                                                         |
| withRealizedR                               | **0**                                                                                         |
| LIVE / Gate rows on ledger                  | **0** (`withGate=0`)                                                                          |
| Unauthorized LIVE `AUTO_ACCEPTED`           | **0**                                                                                         |
| Mode during run                             | PAPER (LIVE broker not configured)                                                            |
| P4 soak reference                           | `apps/trader-agent/data/paper-soak-report-latest.json` (`SOAK-2026-08-22-513`, status KILLED) |
| Calendar note                               | **Sunday 2026-08-23** — NSE closed; no fresh fills possible this session                      |

**Sample adequacy:** Not justified (`reviewed≥20`, `qualityVsRealizedRSamples≥10`, `paper+live≥20` unmet). Technical Safety remains assessable from P5 implementation + tests.

---

## Gate classification (exactly four rows)

```text
TECHNICAL SAFETY       PASS
INTELLIGENCE QUALITY   REVIEW
HUMAN VALUE            REVIEW
EXECUTION QUALITY      REVIEW

OVERALL                NO-GO
Reason                 insufficient runtime evidence
```

Portfolio remains **evidence-only** (not a fifth gate row).

---

## 1. Technical Safety

### Observed

- LIVE arming blocked while evidence OVERALL=NO-GO (`liveAutoEffective=false`).
- LIVE broker not configured; mode stayed PAPER.
- Unauthorized LIVE AUTO_ACCEPTED = 0.
- P5 approve path still enforces Risk → Portfolio → Policy → Gate (APPROVE attempts rejected by quote-age policy, not bypassed).

### Interpretation

Safety controls that must hold before any P6 activation are behaving as designed on this runtime.

### Limitations

- No LIVE Gate pass/block series in this window (LIVE unavailable).

### Reviewer conclusion

**PASS**

---

## 2. Intelligence Quality

### Observed

- Ledger rows with intelligence present on decisions.
- Agent recommendations in window: APPROVE=3, WAIT=2, REJECT=1 (from human-intel snapshot).
- `qualityVsRealizedRSamples=0` — no closed outcomes linked to quality bands.

### Interpretation

Intelligence snapshots are being recorded, but quality vs realized R cannot be scored without closes.

### Limitations

- Zero realizedR samples.
- Weekend / stale quotes (~35.8h) prevented fresh BUY approvals that would create fill→close evidence.

### Reviewer conclusion

**REVIEW**

---

## 3. Human Value

### Observed

- Real Desk WAIT decisions recorded: `humanWaitCount=6`.
- `humanApproveCount=0`, `humanRejectCount=0` (no new REJECT rows yet after enablement).
- Agreement≈33%, overrides≈67% on reviewed=6.
- **Human REJECT is now exposed end-to-end** (agent `POST .../recommendations/:id/reject`, gateway proxy, Desk Reject button). Live probe: agent 400 (x-user-id) / gateway 401 (bearer) — route present (was 404).

### Interpretation

WAIT human-validation path works and writes ledger rows. APPROVE fills and human REJECT ledger rows are still missing from this window (REJECT UI/API ready; market closed Sunday).

### Limitations

- No human APPROVE fills / closes.
- Human REJECT enabled but not yet exercised on Desk.
- Sample count far below review adequacy.

### Reviewer conclusion

**REVIEW**

---

## 4. Execution Quality

### Observed

- APPROVE attempts (e.g. DUCON, ASINPET) rejected by policy: quote age ≫ 60s.
- `withGate=0`, no fill/slippage/latency series from this human-validation window.
- `withRealizedR=0`.

### Interpretation

Execution quality cannot be affirmed; Gate/fill/close evidence is absent for P5 human-approved trades.

### Limitations

- Stale market quotes blocked PAPER APPROVE.
- LIVE pipeline not runnable (broker not configured).
- No normal close → outcome path exercised for new Desk approvals.

### Reviewer conclusion

**REVIEW**

---

## Portfolio (evidence-only)

### Observed

Ranking / portfolio-fit fields may appear on opportunities; not used as authorization.

### Reviewer conclusion

Evidence-only; **incomplete** for this window (no realizedR linkage).

---

## Overall

| Gate row             | Result    |
| -------------------- | --------- |
| TECHNICAL SAFETY     | PASS      |
| INTELLIGENCE QUALITY | REVIEW    |
| HUMAN VALUE          | REVIEW    |
| EXECUTION QUALITY    | REVIEW    |
| **OVERALL**          | **NO-GO** |

**Rules applied:** TECHNICAL SAFETY PASS (ok). No FAIL (ok). At most one REVIEW for GO (violated — three REVIEW). Sample adequacy not justified → **NO-GO**.

### Reviewer rationale

Real WAIT activity and a non-empty ledger exist. Human REJECT is now available on Desk/API but not yet used. APPROVE fills, Gate rows, LIVE samples, and realizedR are still missing. **NO-GO means insufficient evidence, not ineffective intelligence.**

### ARM status

**Not armed.** `ARM LIVE AUTONOMOUS` must not be used while OVERALL=NO-GO.

### Missing before next re-score

1. **NSE session** with fresh quotes (≤60s) so PAPER APPROVE can pass quote-age policy
2. Human **APPROVE** → Risk→Portfolio→Policy→Gate → fill → close → `realizedR` on ledger
3. Human **REJECT** / **WAIT** mix on Desk (REJECT now enabled)
4. Re-export + re-score when counts approach adequacy (`reviewed≥20`, `qualityVsRealizedRSamples≥10`)
5. LIVE broker only if LIVE samples are required for your GO bar

```bash
node apps/trader-agent/scripts/export-p5-evidence-review.mjs
```
