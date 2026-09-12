/**
 * P7.3 — Calibration drift breaker (pure compute).
 * Uses probabilityTarget only — never confidence/overallScore as probability.
 */
import {
  DEFAULT_P7_CALIBRATION_BREAKER_CONFIG,
  DEFAULT_P7_SAMPLE_FLOORS,
  type DecisionLedgerRecord,
  type P7BreakerSubState,
  type P7CalibrationBreakerConfig,
  type P7CalibrationBreakerResult,
  type P7CalibrationMetrics,
  type P7RecoveryState,
  type P7SampleFloors,
} from '@stockpred/shared-types';
import {
  extractActualDecisionOutcomePairs,
  isCalibrationEligible,
  p7Mean,
  resolveDecisionProbabilityTarget,
  splitHistLivePairs,
} from './p7-ledger-outcomes';

export interface P7CalibrationSample {
  decisionId: string;
  probabilityTarget: number;
  netR: number;
  closedAt: number;
  soakRunId?: string;
}

const PROBABILITY_BANDS: Array<{ band: string; lo: number; hi: number }> = [
  { band: '35-44', lo: 0.35, hi: 0.449 },
  { band: '45-54', lo: 0.45, hi: 0.549 },
  { band: '55-64', lo: 0.55, hi: 0.649 },
  { band: '65-74', lo: 0.65, hi: 0.749 },
  { band: '75-85', lo: 0.75, hi: 0.85 },
];

export function extractP7CalibrationSamples(
  records: DecisionLedgerRecord[],
): P7CalibrationSample[] {
  const samples: P7CalibrationSample[] = [];
  for (const pair of extractActualDecisionOutcomePairs(records)) {
    const { probabilityTarget, probabilitySource } = resolveDecisionProbabilityTarget(
      pair.decision,
    );
    if (!isCalibrationEligible(probabilityTarget, probabilitySource)) continue;
    samples.push({
      decisionId: pair.decision.decisionId,
      probabilityTarget: probabilityTarget!,
      netR: pair.netR,
      closedAt: pair.closedAt,
      soakRunId: pair.soakRunId,
    });
  }
  return samples;
}

function calibrationErrorForSamples(samples: P7CalibrationSample[]): number | null {
  const bucketErrors: number[] = [];
  for (const { lo, hi } of PROBABILITY_BANDS) {
    const inBand = samples.filter((s) => s.probabilityTarget >= lo && s.probabilityTarget <= hi);
    if (inBand.length === 0) continue;
    const predictedRate = p7Mean(inBand.map((s) => s.probabilityTarget))!;
    const realizedRate = p7Mean(inBand.map((s) => (s.netR > 0 ? 1 : 0)))!;
    bucketErrors.push(Math.abs(predictedRate - realizedRate));
  }
  return p7Mean(bucketErrors);
}

function countActiveBuckets(samples: P7CalibrationSample[]): number {
  return PROBABILITY_BANDS.filter(({ lo, hi }) =>
    samples.some((s) => s.probabilityTarget >= lo && s.probabilityTarget <= hi),
  ).length;
}

export interface BuildP7CalibrationMetricsInput {
  records: DecisionLedgerRecord[];
  floors?: Partial<P7SampleFloors>;
  soakRunId?: string | null;
}

export function buildP7CalibrationMetrics(
  input: BuildP7CalibrationMetricsInput,
): P7CalibrationMetrics {
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const samples = extractP7CalibrationSamples(input.records);
  const { hist, live } = splitHistLivePairs(samples, floors, input.soakRunId);

  const calibrationErrorHist = calibrationErrorForSamples(hist);
  const calibrationErrorLive = calibrationErrorForSamples(live);
  const calibrationDrift =
    calibrationErrorHist != null && calibrationErrorLive != null
      ? Math.abs(calibrationErrorLive - calibrationErrorHist)
      : null;
  const latestLiveClosedAt = live.length > 0 ? live[live.length - 1]!.closedAt : null;

  return {
    calibrationDrift,
    calibrationErrorHist,
    calibrationErrorLive,
    liveBucketCount: countActiveBuckets(live),
    histBucketCount: countActiveBuckets(hist),
    latestLiveClosedAt,
  };
}

export interface EvaluateP7CalibrationBreakerInput {
  metrics: P7CalibrationMetrics;
  config?: Partial<P7CalibrationBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  recovery?: P7RecoveryState;
  now?: number;
}

export function evaluateP7CalibrationBreaker(
  input: EvaluateP7CalibrationBreakerInput,
): P7CalibrationBreakerResult {
  const config = { ...DEFAULT_P7_CALIBRATION_BREAKER_CONFIG, ...input.config };
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const now = input.now ?? Date.now();
  const recovery = input.recovery ?? { consecutiveClearEvaluations: 0 };
  const { metrics } = input;

  if (metrics.liveBucketCount < floors.minCalibrationBuckets || metrics.calibrationDrift == null) {
    return {
      breakerId: 'calibration_drift',
      subState: 'INSUFFICIENT',
      metrics,
      recovery,
      reason: 'Calibration bucket floor unmet or drift unavailable',
    };
  }

  if (
    metrics.latestLiveClosedAt != null &&
    now - metrics.latestLiveClosedAt > config.maxEvidenceAgeMs
  ) {
    return {
      breakerId: 'calibration_drift',
      subState: 'UNKNOWN',
      metrics,
      recovery,
      reason: 'Live calibration evidence stale beyond maxEvidenceAgeMs',
    };
  }

  let subState: P7BreakerSubState = 'CLEAR';
  if (metrics.calibrationDrift >= config.maxCalibrationDrift) subState = 'STOP';
  else if (metrics.calibrationDrift >= config.maxCalibrationDriftWarn) subState = 'DEGRADED';

  if (subState === 'STOP' || subState === 'DEGRADED') {
    const recovered =
      metrics.calibrationDrift < config.maxCalibrationDriftWarn &&
      recovery.consecutiveClearEvaluations + 1 >= config.recoveryEvaluations;
    if (recovered) subState = 'CLEAR';
  }

  const nextRecovery =
    subState === 'CLEAR'
      ? {
          consecutiveClearEvaluations:
            metrics.calibrationDrift != null &&
            metrics.calibrationDrift >= config.maxCalibrationDriftWarn
              ? recovery.consecutiveClearEvaluations + 1
              : 0,
        }
      : { consecutiveClearEvaluations: 0 };

  const reason =
    subState === 'STOP'
      ? `Calibration drift ${metrics.calibrationDrift!.toFixed(3)} >= ${config.maxCalibrationDrift}`
      : subState === 'DEGRADED'
        ? `Calibration drift ${metrics.calibrationDrift!.toFixed(3)} in warn band`
        : 'Calibration drift clear';

  return {
    breakerId: 'calibration_drift',
    subState,
    metrics,
    recovery: nextRecovery,
    reason,
  };
}

export function runP7CalibrationBreaker(
  input: BuildP7CalibrationMetricsInput & {
    recovery?: P7RecoveryState;
    now?: number;
    config?: Partial<P7CalibrationBreakerConfig>;
  },
): P7CalibrationBreakerResult {
  const metrics = buildP7CalibrationMetrics(input);
  return evaluateP7CalibrationBreaker({
    metrics,
    config: input.config,
    floors: input.floors,
    recovery: input.recovery,
    now: input.now,
  });
}
