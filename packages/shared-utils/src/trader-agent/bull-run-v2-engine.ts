/**
 * Bull-Run v2 — forward-return distribution → Target×Horizon probabilities.
 *
 * Consumes existing candles (already loaded for B10) + optional B10/B13 evidence.
 * MUST NOT re-run Technical/Sector/ML/News engines.
 * Advisory only — executionReadyFromBullRun always false.
 */
import type {
  BullRunCalendarHorizon,
  BullRunConfidenceBand,
  BullRunDataStatus,
  BullRunIntelligenceSnapshot,
  BullRunStage,
  BullRunTargetHorizonCell,
  BullRunV2Assessment,
  ForwardReturnDistribution,
  HistoricalEventIntelligence,
} from '@stockpred/shared-types';
import {
  BULL_RUN_CALENDAR_HORIZONS,
  BULL_RUN_DEFAULT_TARGETS,
  BULL_RUN_HORIZON_BARS,
} from '@stockpred/shared-types';
import { B9_B17_FEATURE_VERSION, closesFromCandles, provenance, round4 } from './b9-b17-helpers';

const ENGINE = 'bull-run-v2';
const MIN_SAMPLES = 20;

export interface BullRunV2EvidenceInput {
  symbol: string;
  /** Price closes already gathered for intelligence — not a new pipeline. */
  candles?: Array<{ close?: number }>;
  closes?: number[];
  /** Existing B10 snapshot if already assessed (stage/evidence reuse). */
  bullRunSnapshot?: BullRunIntelligenceSnapshot | null;
  /** Existing B13 historical event outcomes if already assessed. */
  historical?: HistoricalEventIntelligence | null;
  dataStatus?: BullRunDataStatus;
  dataAsOf?: number | string | null;
  targets?: number[];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? null;
}

/**
 * Empirical max forward returns over rolling windows of `bars`.
 * maxRet_i = max_j (close[i+j]/close[i] - 1) for j in 1..bars
 */
export function computeMaxForwardReturns(closes: number[], bars: number): number[] {
  const out: number[] = [];
  if (closes.length < bars + 2) return out;
  for (let i = 0; i < closes.length - bars; i++) {
    const start = closes[i];
    if (!(start > 0)) continue;
    let maxRet = -Infinity;
    for (let j = 1; j <= bars; j++) {
      const c = closes[i + j];
      if (!(c > 0)) continue;
      const r = c / start - 1;
      if (r > maxRet) maxRet = r;
    }
    if (Number.isFinite(maxRet)) out.push(maxRet);
  }
  return out;
}

export function probabilityAtLeast(maxForwardReturns: number[], target: number): number {
  if (!maxForwardReturns.length) return NaN;
  let hits = 0;
  for (const r of maxForwardReturns) {
    if (r >= target) hits += 1;
  }
  return hits / maxForwardReturns.length;
}

/** Enforce P(≥T_high) ≤ P(≥T_low) for same horizon (same sample). */
export function enforceMonotonicProbabilities(
  cells: BullRunTargetHorizonCell[],
): BullRunTargetHorizonCell[] {
  const byH = new Map<BullRunCalendarHorizon, BullRunTargetHorizonCell[]>();
  for (const c of cells) {
    const list = byH.get(c.horizon) ?? [];
    list.push(c);
    byH.set(c.horizon, list);
  }
  const out: BullRunTargetHorizonCell[] = [];
  for (const [, list] of byH) {
    const sorted = [...list].sort((a, b) => a.targetReturn - b.targetReturn);
    let prev: number | null = null;
    for (const cell of sorted) {
      if (
        cell.status === 'AVAILABLE' &&
        cell.probability != null &&
        Number.isFinite(cell.probability)
      ) {
        let p = cell.probability;
        if (prev != null && p > prev) p = prev;
        prev = p;
        out.push({ ...cell, probability: round4(p) });
      } else {
        out.push(cell);
      }
    }
  }
  return out;
}

function confidenceFromSample(sampleSize: number): BullRunConfidenceBand {
  if (sampleSize >= 200) return 'HIGH';
  if (sampleSize >= 60) return 'MEDIUM';
  if (sampleSize >= MIN_SAMPLES) return 'LOW';
  return 'UNAVAILABLE';
}

function buildDistribution(
  horizon: BullRunCalendarHorizon,
  closes: number[],
): ForwardReturnDistribution {
  const horizonBars = BULL_RUN_HORIZON_BARS[horizon];
  const samples = computeMaxForwardReturns(closes, horizonBars);
  const sampleSize = samples.length;
  if (sampleSize < MIN_SAMPLES) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      horizon,
      horizonBars,
      sampleSize,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    status: 'AVAILABLE',
    horizon,
    horizonBars,
    sampleSize,
    maxForwardReturns: sorted,
    percentiles: {
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
    },
  };
}

function cellsFromDistribution(
  dist: ForwardReturnDistribution,
  targets: number[],
  dataStatus: BullRunDataStatus,
  dataAsOf?: number | string | null,
): BullRunTargetHorizonCell[] {
  if (dist.status !== 'AVAILABLE' || !dist.maxForwardReturns?.length) {
    return targets.map((t) => ({
      targetReturn: t,
      horizon: dist.horizon,
      status: 'UNAVAILABLE' as const,
      reason: dist.reason ?? 'INSUFFICIENT_HISTORY',
      probability: null,
      confidence: 'UNAVAILABLE' as const,
      sampleSize: dist.sampleSize,
      dataStatus,
      dataAsOf,
    }));
  }
  const samples = dist.maxForwardReturns;
  const conf = confidenceFromSample(dist.sampleSize);
  const p50 = dist.percentiles?.p50 ?? null;
  const p10 = dist.percentiles?.p10 ?? null;
  const p90 = dist.percentiles?.p90 ?? null;
  return targets.map((t) => {
    const raw = probabilityAtLeast(samples, t);
    if (!Number.isFinite(raw)) {
      return {
        targetReturn: t,
        horizon: dist.horizon,
        status: 'UNAVAILABLE' as const,
        reason: 'INSUFFICIENT_HISTORY' as const,
        probability: null,
        confidence: 'UNAVAILABLE' as const,
        sampleSize: dist.sampleSize,
        dataStatus,
        dataAsOf,
      };
    }
    // Extreme targets (+200%/+500%): omit when never observed — Not available, never fabricate 0%.
    if (t >= 2.0 && raw <= 0) {
      return {
        targetReturn: t,
        horizon: dist.horizon,
        status: 'UNAVAILABLE' as const,
        reason: 'INSUFFICIENT_HISTORY' as const,
        probability: null,
        confidence: 'UNAVAILABLE' as const,
        sampleSize: dist.sampleSize,
        dataStatus,
        dataAsOf,
      };
    }
    return {
      targetReturn: t,
      horizon: dist.horizon,
      status: 'AVAILABLE' as const,
      probability: round4(clamp01(raw)),
      expectedReturnRange:
        p10 != null && p90 != null ? { low: round4(p10), high: round4(p90) } : null,
      expectedDrawdownRange:
        p10 != null && p10 < 0 ? { low: round4(p10), high: round4(Math.min(0, p50 ?? 0)) } : null,
      timeToTargetRange: null,
      confidence: conf,
      sampleSize: dist.sampleSize,
      calibration: null,
      evidence: [
        `Empirical P(max fwd return ≥ ${(t * 100).toFixed(0)}% within ${dist.horizon})`,
        `sampleSize=${dist.sampleSize}`,
      ],
      dataStatus,
      dataAsOf,
    };
  });
}

/**
 * Build Bull-Run v2 from existing evidence only.
 * Does not call sector/ML/news/technical engines.
 */
export function buildBullRunV2FromEvidence(
  input: BullRunV2EvidenceInput,
  now: Date = new Date(),
): BullRunV2Assessment {
  const dataStatus: BullRunDataStatus = input.dataStatus ?? 'UNKNOWN';
  const targets = (input.targets?.length ? input.targets : BULL_RUN_DEFAULT_TARGETS).slice();
  const prov = provenance(
    ENGINE,
    {
      modelVersion: 'bull-run-v2.distribution.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  prov.dataStatus = dataStatus;
  if (input.dataAsOf != null) prov.dataAsOf = input.dataAsOf;

  const closes = input.closes?.length ? input.closes : closesFromCandles(input.candles ?? []);

  const stage: BullRunStage =
    input.bullRunSnapshot?.stage && input.bullRunSnapshot.stage !== 'UNKNOWN'
      ? input.bullRunSnapshot.stage
      : 'UNKNOWN';

  const evidence: string[] = [...(input.bullRunSnapshot?.evidence ?? [])];
  if (input.historical?.status === 'AVAILABLE') {
    evidence.push(
      `Historical analogues available (comparableEvents=${input.historical.comparableEvents})`,
    );
  }

  if (closes.length < 40) {
    const unavailableCells: BullRunTargetHorizonCell[] = [];
    for (const h of BULL_RUN_CALENDAR_HORIZONS) {
      for (const t of targets) {
        unavailableCells.push({
          targetReturn: t,
          horizon: h,
          status: 'UNAVAILABLE',
          reason: 'INSUFFICIENT_HISTORY',
          probability: null,
          confidence: 'UNAVAILABLE',
          dataStatus,
          dataAsOf: input.dataAsOf,
        });
      }
    }
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      stage: 'UNKNOWN',
      dataStatus,
      distributions: BULL_RUN_CALENDAR_HORIZONS.map((h) => ({
        status: 'UNAVAILABLE',
        reason: 'INSUFFICIENT_HISTORY',
        horizon: h,
        horizonBars: BULL_RUN_HORIZON_BARS[h],
        sampleSize: 0,
      })),
      cells: unavailableCells,
      supportedTargets: targets,
      evidence,
      provenance: { ...prov, sampleSize: closes.length },
      executionReadyFromBullRun: false,
    };
  }

  const distributions = BULL_RUN_CALENDAR_HORIZONS.map((h) => buildDistribution(h, closes));
  let cells: BullRunTargetHorizonCell[] = [];
  for (const dist of distributions) {
    cells = cells.concat(cellsFromDistribution(dist, targets, dataStatus, input.dataAsOf));
  }
  cells = enforceMonotonicProbabilities(cells);

  const available = cells.filter((c) => c.status === 'AVAILABLE' && c.probability != null);
  const invalidation = [...(input.bullRunSnapshot?.invalidation ?? [])];

  return {
    status: available.length ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: available.length ? undefined : 'INSUFFICIENT_HISTORY',
    symbol: input.symbol,
    stage,
    dataStatus,
    distributions,
    cells,
    supportedTargets: targets,
    evidence,
    invalidation,
    provenance: { ...prov, sampleSize: closes.length },
    executionReadyFromBullRun: false,
  };
}

/** Compact AVAILABLE cells for batch labels (omit UNAVAILABLE — never store 0 for missing). */
export function compactBullRunV2Cells(
  assessment: BullRunV2Assessment,
): Array<{ t: number; h: BullRunCalendarHorizon; p: number; conf?: BullRunConfidenceBand }> {
  return assessment.cells
    .filter((c) => c.status === 'AVAILABLE' && c.probability != null)
    .map((c) => ({
      t: c.targetReturn,
      h: c.horizon,
      p: c.probability as number,
      conf: c.confidence === 'UNAVAILABLE' ? undefined : c.confidence,
    }));
}
