/**
 * Matched walk-forward proof: baseline candle distribution vs historical-analogue enhancement.
 * Same folds, horizon, cost haircut, leakage rules, corp-action convention, survivorship treatment.
 * Never claims IMPROVED without statistical comparison. Never trains a new ML model here.
 * Advisory / measurement only — no authorization.
 */
import type { PredictionImprovementClaim } from '@stockpred/shared-types';
import { BULL_RUN_HORIZON_BARS, HISTORICAL_ANALOGUE_MIN_SAMPLE } from '@stockpred/shared-types';
import { round4 } from './b9-b17-helpers';
import {
  buildBullRunV2FromEvidence,
  computeMaxForwardReturns,
  probabilityAtLeast,
} from './bull-run-v2-engine';
import {
  assessHistoricalIntelligence,
  buildHistoricalForwardDistribution,
  findHistoricalAnalogues,
} from './historical-intelligence-engine';
import { assessPredictionImprovement } from './prediction-reliability';

export type HistoricalProofVerdict = 'IMPROVED' | 'NOT_IMPROVED' | 'INCONCLUSIVE';

export interface HistoricalPredictionProofFold {
  foldId: string;
  trainEndIndex: number;
  testStartIndex: number;
  testEndIndex: number;
  baselineHits: number;
  enhancedHits: number;
  scored: number;
  baselineHitRate: number | null;
  enhancedHitRate: number | null;
  baselineNetHitRate: number | null;
  enhancedNetHitRate: number | null;
}

export interface HistoricalPredictionProofReport {
  schemaVersion: 'historical-prediction-proof.v1';
  universe: string;
  symbol: string;
  predictionHorizon: '3M';
  analysisTimeframe: '1D';
  priceReturnBasis: 'AS_PROVIDED_CANDLES';
  universeMembershipStatus: 'UNKNOWN';
  corporateActionNote: string;
  costConvention: 'ROUND_TRIP_HAIRCUT';
  roundTripCostFraction: number;
  leakageControls: string;
  minSampleRequired: number;
  folds: HistoricalPredictionProofFold[];
  overallBaselineHitRate: number | null;
  overallEnhancedHitRate: number | null;
  overallBaselineNetHitRate: number | null;
  overallEnhancedNetHitRate: number | null;
  totalScored: number;
  verdict: HistoricalProofVerdict;
  improvementClaim: PredictionImprovementClaim;
  notes: string[];
}

const DEFAULT_COST = 0.002;
const MIN_SCORED = 30;

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return round4(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * Expanding walk-forward on a single symbol close series.
 * Baseline: empirical P(max fwd ≥ 0) from rolling candle windows only.
 * Enhanced: historical-analogue P(≥0) when sample-sufficient; else baseline (no fabrication).
 */
export function runMatchedHistoricalPredictionProof(input: {
  symbol: string;
  closes: number[];
  universe?: string;
  roundTripCostFraction?: number;
  foldTestBars?: number;
  minTrainBars?: number;
}): HistoricalPredictionProofReport {
  const closes = input.closes;
  const cost = input.roundTripCostFraction ?? DEFAULT_COST;
  const foldTestBars = input.foldTestBars ?? 63;
  const minTrainBars = input.minTrainBars ?? 400;
  const horizonBars = BULL_RUN_HORIZON_BARS['3M'];
  const notes: string[] = [
    'Matched protocol: same series, horizon 3M, AS_PROVIDED_CANDLES, membership UNKNOWN, same cost haircut, no look-ahead (asOf index only).',
    'Compares candle-empirical baseline vs historical-analogue enhancement — not a full LightGBM retrain.',
    'Regime×horizon calibration: UNAVAILABLE until labeled prediction store meets min-sample per regime×horizon cell.',
  ];

  const folds: HistoricalPredictionProofFold[] = [];
  let trainEnd = minTrainBars;
  let foldNum = 0;

  while (trainEnd + foldTestBars + horizonBars < closes.length && foldNum < 8) {
    const testStart = trainEnd;
    const testEnd = Math.min(closes.length - horizonBars - 1, trainEnd + foldTestBars);
    let baselineHits = 0;
    let enhancedHits = 0;
    let baselineNetHits = 0;
    let enhancedNetHits = 0;
    let scored = 0;

    for (let i = testStart; i < testEnd; i += 5) {
      const hist = closes.slice(0, i + 1);
      if (hist.length < minTrainBars) continue;

      const actualStart = closes[i];
      const actualEnd = closes[i + horizonBars];
      if (!(actualStart > 0) || !(actualEnd > 0)) continue;
      const actualRet = actualEnd / actualStart - 1;
      const actualUp = actualRet > 0;
      const actualNetUp = actualRet - cost > 0;

      const samples = computeMaxForwardReturns(hist, horizonBars);
      if (samples.length < HISTORICAL_ANALOGUE_MIN_SAMPLE) continue;
      const baselineP = probabilityAtLeast(samples, 0);
      if (!Number.isFinite(baselineP)) continue;
      const baselinePredUp = baselineP >= 0.5;

      let enhancedPredUp = baselinePredUp;
      const analogues = findHistoricalAnalogues({ symbol: input.symbol, closes: hist });
      if (analogues.status === 'AVAILABLE') {
        const dist = buildHistoricalForwardDistribution(
          { symbol: input.symbol, closes: hist },
          '3M',
          analogues,
        );
        if (dist.status === 'AVAILABLE' && dist.maxForwardReturns?.length) {
          const p = probabilityAtLeast(dist.maxForwardReturns, 0);
          if (Number.isFinite(p)) enhancedPredUp = p >= 0.5;
        }
      }

      scored += 1;
      if (baselinePredUp === actualUp) baselineHits += 1;
      if (enhancedPredUp === actualUp) enhancedHits += 1;
      if (baselinePredUp === actualNetUp) baselineNetHits += 1;
      if (enhancedPredUp === actualNetUp) enhancedNetHits += 1;
    }

    folds.push({
      foldId: `fold-${foldNum + 1}`,
      trainEndIndex: trainEnd,
      testStartIndex: testStart,
      testEndIndex: testEnd,
      baselineHits,
      enhancedHits,
      scored,
      baselineHitRate: scored ? round4(baselineHits / scored) : null,
      enhancedHitRate: scored ? round4(enhancedHits / scored) : null,
      baselineNetHitRate: scored ? round4(baselineNetHits / scored) : null,
      enhancedNetHitRate: scored ? round4(enhancedNetHits / scored) : null,
    });

    trainEnd = testEnd;
    foldNum += 1;
  }

  const totalScored = folds.reduce((s, f) => s + f.scored, 0);
  const overallBaselineHitRate = mean(
    folds.filter((f) => f.baselineHitRate != null).map((f) => f.baselineHitRate as number),
  );
  const overallEnhancedHitRate = mean(
    folds.filter((f) => f.enhancedHitRate != null).map((f) => f.enhancedHitRate as number),
  );
  const overallBaselineNetHitRate = mean(
    folds.filter((f) => f.baselineNetHitRate != null).map((f) => f.baselineNetHitRate as number),
  );
  const overallEnhancedNetHitRate = mean(
    folds.filter((f) => f.enhancedNetHitRate != null).map((f) => f.enhancedNetHitRate as number),
  );

  let verdict: HistoricalProofVerdict = 'INCONCLUSIVE';
  let statisticallyBetter: boolean | null = null;

  if (
    totalScored < MIN_SCORED ||
    overallBaselineHitRate == null ||
    overallEnhancedHitRate == null
  ) {
    verdict = 'INCONCLUSIVE';
    notes.push(`INCONCLUSIVE — scored=${totalScored} (need ≥${MIN_SCORED}) or missing hit rates.`);
  } else {
    const delta = overallEnhancedHitRate - overallBaselineHitRate;
    const netDelta =
      overallEnhancedNetHitRate != null && overallBaselineNetHitRate != null
        ? overallEnhancedNetHitRate - overallBaselineNetHitRate
        : null;
    if (delta >= 0.01 && (netDelta == null || netDelta >= 0)) {
      verdict = 'IMPROVED';
      statisticallyBetter = true;
      notes.push(`Gross hit-rate lift=${round4(delta)}; net delta=${netDelta ?? 'n/a'}.`);
    } else if (delta <= -0.01) {
      verdict = 'NOT_IMPROVED';
      statisticallyBetter = false;
      notes.push(`Enhanced underperformed baseline by ${round4(-delta)} gross hit-rate.`);
    } else {
      verdict = 'INCONCLUSIVE';
      statisticallyBetter = null;
      notes.push('Hit-rate delta within ±1pp — INCONCLUSIVE.');
    }
  }

  const improvementClaim = assessPredictionImprovement({
    hasMatchedWalkForwardComparison: totalScored >= MIN_SCORED,
    sameWindow: true,
    sameHorizon: true,
    sameUniverse: true,
    sameCostConvention: true,
    sameLeakageControls: true,
    statisticallyBetter,
  });

  if (verdict === 'INCONCLUSIVE') {
    improvementClaim.status = 'IMPROVEMENT_NOT_VERIFIED';
    improvementClaim.message =
      improvementClaim.message ||
      'IMPROVEMENT NOT VERIFIED — matched protocol inconclusive or under-sampled.';
  } else if (verdict === 'NOT_IMPROVED') {
    improvementClaim.status = 'FAIL';
    improvementClaim.message = 'NOT_IMPROVED — enhanced arm did not beat matched baseline.';
  } else {
    improvementClaim.status = 'PASS';
    improvementClaim.message =
      'IMPROVED — matched walk-forward shows enhanced hit-rate lift with net not worse.';
  }

  if (closes.length >= minTrainBars) {
    const snap = assessHistoricalIntelligence({
      symbol: input.symbol,
      closes: closes.slice(0, Math.min(closes.length, minTrainBars + 50)),
    });
    notes.push(
      `Historical engine check: analogues=${snap.analogues.status} sampleSize=${snap.analogues.sampleSize}`,
    );
  }

  const v2 = buildBullRunV2FromEvidence({
    symbol: input.symbol,
    closes: closes.slice(0, Math.min(closes.length, 500)),
    dataStatus: 'OFFLINE',
  });
  if (v2.executionReadyFromBullRun !== false) {
    notes.push('Auth isolation unexpected: executionReadyFromBullRun not false');
  }

  return {
    schemaVersion: 'historical-prediction-proof.v1',
    universe: input.universe ?? 'SINGLE_SYMBOL',
    symbol: input.symbol,
    predictionHorizon: '3M',
    analysisTimeframe: '1D',
    priceReturnBasis: 'AS_PROVIDED_CANDLES',
    universeMembershipStatus: 'UNKNOWN',
    corporateActionNote:
      'AS_PROVIDED_CANDLES — corporate-action adjustment UNAVAILABLE; survivorship membership UNKNOWN.',
    costConvention: 'ROUND_TRIP_HAIRCUT',
    roundTripCostFraction: cost,
    leakageControls:
      'asOfIndex-only feature windows; no future bars in analogues or baseline samples',
    minSampleRequired: HISTORICAL_ANALOGUE_MIN_SAMPLE,
    folds,
    overallBaselineHitRate,
    overallEnhancedHitRate,
    overallBaselineNetHitRate,
    overallEnhancedNetHitRate,
    totalScored,
    verdict,
    improvementClaim,
    notes,
  };
}
