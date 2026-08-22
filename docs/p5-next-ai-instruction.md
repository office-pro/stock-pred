# P5 Evidence Gap ? Operational Validation Only

**Audience:** Next AI continuing this roadmap.  
**Status locked:** P1?P8 engineering COMPLETE ? P5 Evidence Gate NO-GO (0 runtime samples) ? P6 LIVE activation BLOCKED ? No Phase 9.

Use this document exactly as locked.

---

## <a id="only-valid-next-transition-locked"></a>ONLY VALID NEXT TRANSITION (locked)

```text
Real Agent Desk activity
? real ledger rows
? outcomes / realizedR
? export
? four-row O/I/L/C review
? GO / NO-GO
```

Until that path produces non-zero runtime evidence, **NO-GO remains the correct state**.

There is no alternate unlock path. Do not invent samples. Do not lower thresholds. Do not arm P6.

---

## CURRENT STATE

```text
P1?P8 engineering       COMPLETE
P5 Evidence              NO-GO
P6 activation            BLOCKED
```

P5:

- Code: COMPLETE
- Tests: COMPLETE
- Compile: COMPLETE
- Safety: COMPLETE
- Evidence Gate: NO-GO because actual runtime samples are currently zero

P6:

- Code/plumbing: COMPLETE
- ARM/DISARM: implemented
- Evidence unlock: implemented
- DecisionPolicy LIVE branch: implemented
- Activation: BLOCKED while P5 Evidence = NO-GO

**DO NOT IMPLEMENT NEW P5/P6 FEATURES.**

**DO NOT MODIFY:**

- RiskEngine
- PortfolioEngine
- DecisionPolicy
- Gate
- liveAutoArmed behavior
- P6 ARM logic
- execution path

---

## <a id="evidence-generation-definition-lock"></a>Evidence generation ? definition lock

Evidence generation is **not** a new trading capability and **not** a code phase.

It is operational validation only:

```text
IMPLEMENTATION          ? already done (P1?P8)
EVIDENCE GENERATION     ? REAL runtime Agent Desk activity only
EVIDENCE REVIEW         ? export ? four-row O/I/L/C ? GO / NO-GO
```

Forbidden path:

```text
0 samples ? invent samples ? fake GO ? LIVE autonomy
```

Required path:

```text
0 samples ? real Desk activity ? real ledger ? real outcomes ? real export ? re-score
```

---

## TASK

Fill the P5 evidence gap using **REAL runtime activity only**.

The objective is to generate genuine P5 human-validation evidence and then re-run the existing evidence review.

**DO NOT FABRICATE OR SYNTHESIZE:**

- decisions
- trades
- realizedR
- human choices
- intelligence outcomes
- gate results
- sample counts
- performance metrics

If real runtime data is unavailable, report that clearly and leave the Evidence Gate as NO-GO.

---

## 1. VERIFY CURRENT DATA

Inspect the existing runtime sources before doing anything:

- `apps/trader-agent/data/decision-ledger.json`
- existing P5 evidence JSON
- existing human-intel metrics
- existing PaperSoakReport files
- existing Agent Desk/API state
- existing export script

Run:

```bash
node apps/trader-agent/scripts/export-p5-evidence-review.mjs
```

Report the actual values for:

- decisionEntryCount
- reviewed
- qualityVsRealizedRSamples
- withGate
- realizedR samples
- human APPROVE count
- human WAIT count
- human REJECT count
- LIVE decision count
- LIVE Gate result count

Do not assume any value.

---

## 2. IF RUNTIME SERVICES ARE AVAILABLE

Use the EXISTING Agent Desk and P5 workflow.

Generate genuine human-validation activity:

```text
Agent Desk
? opportunity
? intelligence
? human APPROVE / WAIT / REJECT
? existing P5 authorization pipeline
? outcome
```

Use real human decisions.

Do not automatically approve all opportunities.

Include meaningful examples of:

- APPROVE
- WAIT
- REJECT

WAIT must continue through the existing WAIT lifecycle.

---

## 3. APPROVED TRADE LIFECYCLE

For a human APPROVE, use the existing system only:

```text
evaluateTrade
? Risk
? Portfolio
? DecisionPolicy
? Gate
? LIVE execution
? position close
? outcome
? realizedR
```

Do not bypass any stage.

Do not manually insert ledger rows.

Do not directly edit `decision-ledger.json` to create evidence.

---

## 4. WAIT LIFECYCLE

Capture real WAIT activity:

```text
PENDING
? WAITING
? re-evaluation
? APPROVE / WAIT / REJECT / EXPIRED
```

Record actual outcomes.

Measure:

- WAIT ? later APPROVE
- WAIT ? later REJECT
- WAIT ? EXPIRED
- WAIT ? realizedR when applicable

Do not fabricate WAIT outcomes.

---

## 5. EVIDENCE TO COLLECT

Collect real evidence for:

### A. HUMAN VALUE

- agentRecommendation
- humanDecision
- human reasonCode
- agreement
- overrides
- WAIT usefulness

### B. INTELLIGENCE QUALITY

- intelligenceSnapshot
- TradeQuality
- ExpectedValue
- thesis
- conflicts
- strategyTag
- realizedR
- outcome

### C. PORTFOLIO / RANKING

Evidence-only:

- rank
- rankScore
- portfolioFit
- referenceAllocationPct
- human selection
- eventual realizedR

Portfolio is **NOT** a fifth gate row.

### D. EXECUTION QUALITY

- GateResult
- Gate reason
- planned price
- fill price
- slippage
- signal timestamp
- decision timestamp
- submit timestamp
- fill timestamp
- close timestamp
- realizedR

### E. SAFETY

Verify actual runtime behavior:

- LIVE + AUTONOMOUS remains HUMAN_REQUIRED while P5 Evidence = NO-GO
- WAIT never submits to Gate
- LIVE caps still enforced
- Gate revalidation still works
- no unauthorized LIVE AUTO_ACCEPTED

---

## 6. SAMPLE ADEQUACY

Use the existing review criteria already defined by the repository.

Do NOT invent new thresholds.

Do NOT convert review criteria into runtime policy.

Current review criteria may include the configured sample/window requirements already used by the export/review tooling (`20/10/20` and related document-level checks are **review criteria only**, never DecisionPolicy/Risk/Gate runtime thresholds).

Report actual counts.

If insufficient:

- remain NO-GO
- list exactly what is missing
- do not fabricate data
- do not reduce thresholds just to reach GO

---

## 7. EXPORT

After genuine runtime data exists, run:

```bash
node apps/trader-agent/scripts/export-p5-evidence-review.mjs
```

Verify the generated JSON contains real non-zero values.

---

## 8. RE-SCORE

Update the existing:

`docs/p5-evidence-review.md`

using exactly:

```text
Observed
Interpretation
Limitations
Reviewer conclusion
```

Four gate rows ONLY:

1. Technical Safety
2. Intelligence Quality
3. Human Value
4. Execution Quality

Portfolio remains evidence-only.

Overall:

```text
GO / NO-GO
```

GO only if the existing locked review criteria are actually satisfied.

---

## 9. IMPORTANT SAFETY RULE

This task MUST NOT:

- implement anything new
- change runtime trading behavior
- change Risk
- change Portfolio
- change Policy
- change Gate
- change liveAutoArmed
- arm LIVE autonomous
- modify P6
- create another execution path

If the evidence remains insufficient, stop at:

```text
OVERALL = NO-GO
```

---

## 10. FINAL OUTPUT

Return a factual report containing:

1. What runtime data was found
2. What real P5 actions/outcomes were generated
3. Exact sample counts
4. Export result
5. Four gate classifications
6. Portfolio evidence summary
7. Overall GO / NO-GO
8. Missing evidence, if any
9. Files changed

**CRITICAL:**  
Never claim a trade, outcome, realizedR, sample, or metric exists unless it is actually present in the runtime data.

If services/data are unavailable, say:

```text
Evidence generation could not be completed because real runtime samples are unavailable.
```

Do not simulate evidence.

---

## Distinction lock (do not collapse)

```text
IMPLEMENTATION
    ? already done

EVIDENCE GENERATION
    ? REAL runtime activity

EVIDENCE REVIEW
    ? GO / NO-GO
```

If the environment cannot produce real trades, the correct result remains **NO-GO**.
