/**
 * B10 Bull-Run Intelligence — evidence-calibrated advisory probabilities.
 * Not a new ML training pipeline. Insufficient history → UNKNOWN / UNAVAILABLE.
 * Never authorizes trades.
 */
import type {
  BullRunHorizon,
  BullRunHorizonAssessment,
  BullRunIntelligenceSnapshot,
  BullRunStage,
} from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  closesFromCandles,
  periodReturn,
  provenance,
  returnsFromCloses,
  round4,
  stdev,
} from './b9-b17-helpers';

const HORIZON_BARS: Record<BullRunHorizon, number> = {
  W1_4: 20,
  M1_3: 63,
  M3_6: 126,
  M6_12: 252,
  Y1_3: 756,
};

export interface BullRunEvidenceInput {
  symbol: string;
  candles: Array<{ close?: number; volume?: number }>;
  relativeStrength?: number | null;
  sectorState?: string | null;
  mlUpProbability?: number | null;
  mlConfidence?: number | null;
  regime?: string | null;
  scannerBullScore?: number | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function stageFromScore(score: number, ret60: number | null): BullRunStage {
  if (!Number.isFinite(score)) return 'UNKNOWN';
  if (ret60 != null && ret60 < -0.12 && score < 0.45) return 'FAILED';
  if (score >= 0.72 && (ret60 ?? 0) > 0.15) return 'CONFIRMED';
  if (score >= 0.65 && (ret60 ?? 0) > 0.08) return 'ACCELERATING';
  if (score >= 0.55) return 'EARLY';
  if (score >= 0.45 && (ret60 ?? 0) > 0.2) return 'MATURE';
  if (score < 0.4 && (ret60 ?? 0) < 0) return 'WEAKENING';
  if (score < 0.35) return 'WEAKENING';
  return 'UNKNOWN';
}

function evidenceScore(
  input: BullRunEvidenceInput,
  closes: number[],
): {
  score: number;
  evidence: string[];
  confidence: number;
} {
  const evidence: string[] = [];
  let score = 0.35;
  let weight = 0;

  const r20 = periodReturn(closes, Math.min(20, closes.length - 1));
  const r60 = periodReturn(closes, Math.min(60, closes.length - 1));
  if (r20 != null) {
    score += clamp01(r20 * 4) * 0.15;
    weight += 0.15;
    if (r20 > 0.03) evidence.push('Short-term trend positive');
  }
  if (r60 != null) {
    score += clamp01(r60 * 2) * 0.2;
    weight += 0.2;
    if (r60 > 0.08) evidence.push('Medium-term trend supportive');
  }

  if (input.relativeStrength != null && Number.isFinite(input.relativeStrength)) {
    const rsEdge = clamp01((input.relativeStrength - 1) * 5 + 0.5);
    score += rsEdge * 0.15;
    weight += 0.15;
    if (input.relativeStrength >= 1.02) evidence.push('RS improving vs benchmark');
  }

  const sector = (input.sectorState || '').toUpperCase();
  if (sector === 'LEADING' || sector === 'IMPROVING') {
    score += 0.1;
    weight += 0.1;
    evidence.push(`Sector state ${sector}`);
  } else if (sector === 'LAGGING' || sector === 'WEAKENING') {
    score -= 0.05;
    weight += 0.1;
  }

  if (input.mlUpProbability != null && Number.isFinite(input.mlUpProbability)) {
    const up = input.mlUpProbability > 1 ? input.mlUpProbability / 100 : input.mlUpProbability;
    score += clamp01(up) * 0.15;
    weight += 0.15;
    if (up >= 0.45) evidence.push('ML direction supportive');
  }

  if (input.scannerBullScore != null && Number.isFinite(input.scannerBullScore)) {
    score += clamp01(input.scannerBullScore / 100) * 0.15;
    weight += 0.15;
    if (input.scannerBullScore >= 60) evidence.push('Scanner bull evidence');
  }

  const regime = (input.regime || '').toUpperCase();
  if (regime.includes('BULL') || regime === 'RISK_ON') {
    score += 0.05;
    evidence.push('Market regime supportive');
  } else if (regime.includes('BEAR') || regime === 'RISK_OFF') {
    score -= 0.05;
  }

  const conf = clamp01(0.35 + weight);
  return { score: clamp01(score), evidence, confidence: round4(conf * 100) };
}

function horizonAssessment(
  horizon: BullRunHorizon,
  closes: number[],
  baseScore: number,
  confidence: number,
): BullRunHorizonAssessment {
  const need = HORIZON_BARS[horizon];
  if (closes.length < Math.min(need, 40) + 1) {
    return {
      horizon,
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      bullRunProbability: null,
      expectedReturnRange: null,
      expectedDrawdownRange: null,
      confidence: null,
    };
  }
  const bars = Math.min(need, closes.length - 1);
  const hist = periodReturn(closes, bars);
  const vol = stdev(returnsFromCloses(closes).slice(-bars));
  // Blend evidence score with realized path — not a guaranteed forecast.
  const pathAdj = hist != null ? clamp01(0.5 + hist) : 0.5;
  const prob = round4(clamp01(baseScore * 0.7 + pathAdj * 0.3) * 100);
  const retLow = hist != null ? round4(hist - (vol ?? 0.02) * 2) : null;
  const retHigh = hist != null ? round4(hist + (vol ?? 0.02) * 2) : null;
  const dd = vol != null ? round4(-(vol * Math.sqrt(bars / 5) * 2)) : null;
  return {
    horizon,
    status: 'AVAILABLE',
    bullRunProbability: prob,
    expectedReturnRange: retLow != null && retHigh != null ? { low: retLow, high: retHigh } : null,
    expectedDrawdownRange: dd != null ? { low: dd, high: round4(dd * 0.3) } : null,
    confidence: round4(confidence * (closes.length >= need ? 1 : 0.75)),
  };
}

export function assessBullRunIntelligence(
  input: BullRunEvidenceInput,
  now: Date = new Date(),
): BullRunIntelligenceSnapshot {
  const prov = provenance(
    'bull-run-intelligence',
    {
      modelVersion: 'bull-run-evidence.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  const closes = closesFromCandles(input.candles);
  if (closes.length < 40) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      stage: 'UNKNOWN',
      horizons: (Object.keys(HORIZON_BARS) as BullRunHorizon[]).map((h) => ({
        horizon: h,
        status: 'UNAVAILABLE',
        reason: 'INSUFFICIENT_HISTORY',
      })),
      evidence: [],
      provenance: prov,
    };
  }

  const { score, evidence, confidence } = evidenceScore(input, closes);
  const horizons = (Object.keys(HORIZON_BARS) as BullRunHorizon[]).map((h) =>
    horizonAssessment(h, closes, score, confidence),
  );
  const usable = horizons.filter((h) => h.status === 'AVAILABLE');
  if (!usable.length) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      stage: 'UNKNOWN',
      horizons,
      evidence,
      provenance: { ...prov, sampleSize: closes.length },
    };
  }

  const r60 = periodReturn(closes, Math.min(60, closes.length - 1));
  const invalidation: string[] = [];
  if ((input.relativeStrength ?? 1) < 0.95) invalidation.push('RS deterioration vs benchmark');
  if ((r60 ?? 0) < -0.1) invalidation.push('Medium-term trend breakdown');

  return {
    status: 'AVAILABLE',
    symbol: input.symbol,
    stage: stageFromScore(score, r60),
    horizons,
    evidence,
    invalidation,
    provenance: { ...prov, sampleSize: closes.length },
  };
}
