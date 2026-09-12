# T1 — Trade Intelligence / Alpha (observe-only)

## Product boundary (locked)

```text
ML predicts → Trade Intelligence interprets → evaluateTrade → Risk → Portfolio → Policy → Gate → Execution
```

ML and TI **never** authorize trades. No BUY/SELL/ARM from TI. Risk / Portfolio / Policy / Gate / P5 / P6 are unchanged by TI inputs.

## What T1.1–T1.8 ships

| Slice                         | Role                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1.1 Market Regime Engine** | Direction × volatility (`regimeCombo`, e.g. `BULL+LOW_VOL`) with `asOf`. `RISK_ON/OFF` is derived only as evaluateTrade eligibility compatibility. |
| **T1.2 Stock Opportunity**    | Path heads (`expectedReturn` / `expectedMfe` / `expectedMae`) + direction probs from usable ML.                                                    |
| **T1.3 Expected-R**           | `GEOMETRIC_HEURISTIC_V1`: `pHit + pStop ≤ 1`, residual `pNeither`; explicit `probabilitySource` (`CALIBRATED` \| `RAW_MODEL` \| `HEURISTIC`).      |
| **T1.4 RS + sector**          | Cross-sectional RS buckets (`LEADERS`/`MIDDLE`/`LAGGARDS`) + sector trend/valuation/fit; advisory only.                                            |
| **T1.5 Multi-horizon**        | Per-horizon biases preserved; agreement relative to `DAY_TRADE` / `SWING_TRADE` / `POSITION`; soft conflicts only.                                 |
| **T1.6 Regime compatibility** | Multidimensional regime (trend/vol/breadth/liquidity/index/sector) × setup-aware compatibility; soft conflicts only.                               |
| **T1.7 Catalyst / event**     | Explicit catalyst types + event risk (not direction); look-ahead-safe provenance; soft conflicts only.                                             |
| **T1.8 Opportunity ranking**  | Lexicographic, context-scoped shortlist (DAY vs SWING precedence). No RankingScore. PortfolioFit = soft tie-break only. Never authorizes.          |

## Data flow

```text
MDS /market/context + usable /market/predictions/:symbol
  + quote RS + /stocks/:symbol/peer-valuation
  + /stocks/:symbol/candles/mtf + daily candles
  → assessMarketRegime
  → assessStockOpportunity
  → computeGeometricExpectedR
  → assessCrossSectionalRs + assessSectorIntelligence
  → assessMultiHorizonAgreement
  → buildMarketRegimeDimensions + assessRegimeCompatibility
  → assessCatalystContext (look-ahead filtered candidates)
  → buildIntelligenceSnapshot
  → assessOpportunityRanking (lexicographic shortlist; never RankingScore)
  → rankOpportunitiesForDisplay (P5 legacy display sort; real expectedValueR)
  → evaluateTrade → Risk… (snapshot never fed into Risk/Portfolio/Policy/Gate)
```

## Provenance rules

1. Calibrated class probs → `probabilitySource = CALIBRATED`
2. Raw model probs → `RAW_MODEL`
3. Confidence-only heuristic → `HEURISTIC` (never silently labeled calibrated)
4. Expected-R method is always `GEOMETRIC_HEURISTIC_V1` in this slice (not a trained EV model)
5. Assessments carry `TiAssessmentProvenance` (`engineVersion`, `calculationVersion`, `sourceDataTimestamp`, `inputs`) where available

## Usable ML gate

Only **fresh + drift-compatible** MDS cache rows may enter TI. Stale / incompatible / missing-expiry predictions are omitted; TI may still form a heuristic EV from setup + scores.

## Surfaces

- Agent Desk ledger: `regimeCombo`, E[R], probability source, EV method, RS bucket, sector fit, multi-horizon agreement + per-TF biases
- ML Lab TI Bridge: observational usable vs rejected counts (unchanged auth boundary)
- Decision ledger: `intelligenceSnapshot` observe-only

## T1.4 Cross-sectional RS + sector intelligence

Inputs (best-effort from MDS):

- `relativeStrengthNifty50` on quote/scanner
- `/stocks/:symbol/peer-valuation` (`peVsMedianPct`, `pbVsMedianPct`, sector)

Outputs on `IntelligenceSnapshot` (observe-only):

- `crossSectionalRs` — bucket + optional peer percentile
- `sectorIntelligence` — trend / valuation / fit
- `marketContext.sectorTrend`
- `tradeQuality.relativeStrength` (0–100 display scale)
- conflicts: `RS_LAGGARD`, `SECTOR_LAGGING`, `SECTOR_RICH_VALUATION`

Does **not** change Risk / Portfolio / Policy / Gate or locked ranking weights.

## T1.5 Multi-horizon agreement

**Not** “more timeframes = higher score.” Goal: whether the thesis is aligned across horizons **relevant to the intended trade horizon**.

Rules:

1. Preserve `horizons[]` (per-TF bias + role) — never collapse to one `MultiHorizonScore`
2. Agreement is relative to `tradeHorizon` (`DAY_TRADE` vs `SWING_TRADE` vs `POSITION`) and intended side
3. Soft conflicts only (`INFO`/`WARN`) — e.g. `HTF_NOT_CONFIRMED`, `HORIZON_PRIMARY_DISAGREE`

Inputs (best-effort from MDS):

- `/stocks/:symbol/candles/mtf` → M5 / M15 / H1 (H4 approximated from H1)
- daily candles → D1 (W1 approximated from D1)
- `setup.expectedHoldingPeriod` → `inferTradeHorizon`

Outputs:

- `multiHorizonAgreement.tradeHorizon` / `agreement` / `higherTimeframeAlignment` / `dominantBias`
- `multiHorizonAgreement.horizons[]` with provenance
- conflicts mirrored onto snapshot `conflicts` (never `BLOCK`)

Example (advisory):

```text
Trade horizon: SWING
H1 BULLISH · H4 BULLISH · D1 BULLISH · W1 NEUTRAL
Agreement: HIGH · HTF MED
Conflict: Weekly trend not confirmed
```

Day trade with bullish intraday + bearish daily can still show **HIGH** primary agreement with an `HTF_OPPOSES` INFO — swing with the same stack grades poorly on primaries.

## T1.6 Market regime compatibility

**Not** a `RegimeScore = 87`. Goal: whether the **setup style** is compatible with a **multidimensional** market backdrop.

Dimensions retained separately (for later P7 drift attribution):

| Dimension       | Examples                               |
| --------------- | -------------------------------------- |
| Trend           | `BULL` / `BEAR` / `NEUTRAL`            |
| Volatility      | `HIGH_VOL` / `NORMAL_VOL` / `LOW_VOL`  |
| Breadth         | `STRONG` / `NORMAL` / `WEAK`           |
| Liquidity       | `HIGH` / `NORMAL` / `LOW`              |
| Index structure | `BULLISH` / `BEARISH` / `NEUTRAL`      |
| Sector breadth  | derived from sector trend when present |

Compatibility is **setup-aware**:

```text
BREAKOUT + BULL + STRONG breadth + NORMAL/LOW vol → FAVORABLE
BREAKOUT + BEAR + WEAK breadth + HIGH_VOL → UNFAVORABLE
MEAN_REVERSION + HIGH_VOL → volatility SUPPORTIVE (not hostile)
```

Rules:

1. Never collapse dimensions into one magic score
2. `UNFAVORABLE ≠ REJECT` — soft `INFO`/`WARN` only (`REGIME_UNFAVORABLE`, `HIGH_VOLATILITY`, `WEAK_BREADTH`, `REGIME_CONFLICT`, …)
3. Prefer T1.6 granular conflicts over the blunt T1.1 `REGIME_HOSTILE` flag when compatibility is present
4. Isolation: Risk / Portfolio / Policy / Gate identical with/without the snapshot

Outputs on `IntelligenceSnapshot` (observe-only):

- `regimeCompatibility.compatibility` / `dimensions` / `dimensionNotes` / `conflicts`
- mirrored on `opportunity.regimeCompatibility`
- desk shows `regime FAVORABLE|…` plus dimension strip

## T1.7 Catalyst / Event Context

Answers: **why might this trade move now, and does an event change risk/reward or timing?**

**Not** a `CatalystScore`. Keep dimensions explicit:

| Dimension         | Fields                                                     |
| ----------------- | ---------------------------------------------------------- |
| Catalyst          | `type`, `direction`, `strength`, `relevance`               |
| Event             | `timestamp` / proximity / `expectedImpact` / `uncertainty` |
| Market reaction   | optional pre-event behavior / volume / volatility          |
| Trade interaction | `SUPPORTS` / `CONFLICTS` / `INCREASES_EVENT_RISK`          |

Catalyst types stay named (`EARNINGS`, `GUIDANCE`, `NEWS`, `MACRO`, …) — never averaged.

### Event risk ≠ directional catalyst

```text
Earnings in 1 day
→ type EARNINGS, direction UNKNOWN, uncertainty HIGH, eventRisk HIGH
→ thesisInteraction INCREASES_EVENT_RISK
≠ EARNINGS = BULLISH
```

Proximity drives **event risk**; known direction (when outcome-resolved) drives **thesis interaction**.

### Look-ahead (mandatory)

At decision time `T`, only events with `eventPublishedAt ≤ T` enter the snapshot. Provenance per event:

`sourceDataTimestamp` · `eventPublishedAt` · `eventEffectiveAt` · `observedAt`

### Rules

1. No magic CatalystScore
2. Upcoming binaries default to `direction=UNKNOWN` unless `outcomeResolved`
3. Soft conflicts only: `EARNINGS_NEAR`, `EVENT_RISK_HIGH`, `UNRESOLVED_BINARY_EVENT`, …
4. Same event from multiple feeds → one logical event (dedupe)
5. Isolation: Risk / Portfolio / Policy / Gate identical with/without catalyst context
6. Agent maps published alt-data aggregates only — does **not** invent earnings calendars

Outputs on `IntelligenceSnapshot` (observe-only):

- `catalystContext.events[]` / `eventRisk` / `thesisInteraction` / `conflicts`
- mirrored on `opportunity.catalystContext`
- desk shows `eventRisk …` plus short event strip

## T1.8 Opportunity Ranking

Answers: _Given multiple valid opportunities, which deserve priority / attention?_

Not: which trade should execute. Ranking is recommendation / shortlist only.

### Rules (frozen)

1. No `RankingScore` / no weighted magic blend of T1.4–T1.7
2. Lexicographic, context-specific dimension precedence (DAY vs SWING differ)
3. `PortfolioFit` = soft **tie-break only** — never veto / authorize / resize / touch Risk or cash
4. `CLEAR` = clear **under RankingContext**, not objectively best trade
5. Immutable result: context, timestamp, engine/calculation versions, candidateUniverse, provenance
6. Symmetric pairwise reasons (ABOVE and BELOW)
7. `UNKNOWN` / `DATA_INCOMPLETE` / `STALE` — never treat missing as neutral
8. Candidate-order independence
9. Isolation: Risk / Portfolio / Policy / Gate identical with/without ranking
10. Locked P5 `rankOpportunitiesForDisplay` unchanged (legacy `rankScore` OK for display sort)

### Desk

`getOpportunities` returns `opportunityRanking` (T1.8 briefing) alongside legacy `ranked` (P5). Desk shows attention shortlist: dominance, why above/below, concerns, no-clear-winner.

## TI pause → P5 human validation

T1.8 completes the current Trade Intelligence advisory stack. **TI features are frozen.** Do not add sentiment / macro / correlation / another score until P5 human validation measures usefulness vs outcomes.

```text
T1.8 Ranking → FREEZE TI → P5 Minimal Measurement Hardening → Evidence window (ops) → GO / NO-GO / INCONCLUSIVE → P6 ARM eligibility
```

P5 measurement adds only: frozen ranking cohort at decision time, ACTUAL vs COUNTERFACTUAL outcomes (never mixed), MAE/MFE when path exists (else UNAVAILABLE), cost-adjusted stats, and a structured Validation Report. **INCONCLUSIVE ≠ NO-GO.** Only GO unlocks ARM eligibility (never auto-arms). Risk → Portfolio → Policy → Gate unchanged.

## Deferred (post-validation)

Capital allocation intelligence, ML trade quality / calibration, further TI slices after P5 evidence.
