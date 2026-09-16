# AI Trader Command Center

Primary post-batch workflow lives on **`/overview`**. Visual reference: `AI_Trader_Aesthetic_UI_Wireframes.pdf` (local Downloads). Implement within StockPred MUI/Layout — the FE is a trading desk UI, not the AI.

## Bull-Run semantics

Cell values are:

```text
P(max forward return within horizon H ≥ target T)
```

They are **not** predicted returns and **not** a single “bullish %” score.

| Case                       | Display                                       |
| -------------------------- | --------------------------------------------- |
| Evidence supports target   | Probability (e.g. `86%`)                      |
| Unsupported / missing cell | **Not available** / `—`                       |
| Never                      | Fabricate `0%` or tiny % for missing extremes |

Confidence ≠ probability. Offline/stale analysis ≠ execution-ready.

Dynamic targets include `+10% … +200% … +500%` where empirically supported. UI may offer +500% without every stock having a +500% probability.

## Best Picks ownership

```text
RankingContext → BEST_OPPORTUNITIES → Best Picks
```

Bull-Run is supporting intelligence only. **Do not** sort by Bull-Run probability and call the result Best Picks. Best Pick order must be identical whether Bull-Run cells are present, absent, or partial.

## Exec Ready

Display backend `tradePlanExecutionReady` / `executionReady` only. Never infer `APPROVE + HIGH confidence = YES`. P1: `APPROVE + PARTIAL → not execution-ready`.

## Pipeline (frozen)

```text
IntelligenceSnapshot → Historical Evidence → Forward Return Distribution
  → P(≥T within H) → Bull-Run → ProfessionalTrader → TradePlan / Recommendation
  → RankingContext → Overview
```

Paper execution (separate):

```text
Recommendation → evaluateTrade() → Risk → Portfolio → Policy → Gate → Execution
```

No second intelligence pipeline, no second ranking engine, no FE authorization path.

## Calibration honesty

Bull-Run engine sets `calibration: null` on cells. Overview/detail show **Calibration: Not available** until a hit-tracking pipeline exists. Sample size on live MDS cells is historical window count, not a live hit rate.

## Artifacts

- Report: `batch-research-report.v2` (`commandCenterHorizon`, `matrixTargets`, `bestPicks`, `bullRunMatrix`, `integritySummary`)
- Persist on batch finalize; Overview reads `GET .../latest/research-report` only (no N×MDS for the matrix)
