/**
 * Prediction reliability / calibration reporting — measure only.
 * Never invents accuracy. Below PREDICTION_RELIABILITY_MIN_SAMPLE → UNAVAILABLE.
 * Never auto-tunes Risk/Portfolio/Policy/Gate.
 */
import type {
  EngineReliabilityMetric,
  PredictionImprovementClaim,
  PredictionQualityPayload,
} from '@stockpred/shared-types';
import { PREDICTION_RELIABILITY_MIN_SAMPLE } from '@stockpred/shared-types';
import { provenance } from './b9-b17-helpers';

export const PREDICTION_RELIABILITY_VERSION = 'prediction-reliability.v1';

export interface StoredPredictionRecord {
  engine: string;
  symbol: string;
  predictionTime: number;
  horizon: string;
  prediction: string | number;
  modelVersion?: string;
  featureVersion?: string;
  dataAsOf?: number | string | null;
  regime?: string | null;
  actual?: string | number | null;
  actualObservedAt?: number | null;
}

/**
 * Compute reliability metrics from labeled prediction records.
 * Without sufficient labeled outcomes → UNAVAILABLE (honest).
 */
export function computeEngineReliability(
  records: StoredPredictionRecord[],
  engine: string,
  horizon: string,
  regime: string,
): EngineReliabilityMetric {
  const filtered = records.filter(
    (r) =>
      r.engine === engine &&
      r.horizon === horizon &&
      (regime === 'UNKNOWN' || r.regime === regime || (!r.regime && regime === 'UNKNOWN')) &&
      r.actual != null,
  );
  const sampleSize = filtered.length;
  if (sampleSize < PREDICTION_RELIABILITY_MIN_SAMPLE) {
    return {
      engine,
      horizon,
      regime,
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      sampleSize,
      note: `Need ≥${PREDICTION_RELIABILITY_MIN_SAMPLE} labeled outcomes; calibration NOT_MEASURED.`,
    };
  }

  let hits = 0;
  for (const r of filtered) {
    if (String(r.prediction) === String(r.actual)) hits += 1;
  }
  const accuracy = hits / sampleSize;
  return {
    engine,
    horizon,
    regime,
    status: 'AVAILABLE',
    sampleSize,
    accuracy,
    hitRate: accuracy,
    calibration: 'NOT_MEASURED',
    stability: 'UNKNOWN',
    note: 'Accuracy from labeled matches only — not calibrated probability. Measure-only; does not modify Risk/Gate.',
  };
}

export function buildPredictionQualityPayload(
  partial: Omit<PredictionQualityPayload, 'calibrationStatus' | 'status'> & {
    status?: PredictionQualityPayload['status'];
    calibrationStatus?: PredictionQualityPayload['calibrationStatus'];
    hasCalibrationEvidence?: boolean;
  },
): PredictionQualityPayload {
  const sampleOk =
    partial.sampleSize != null &&
    Number.isFinite(partial.sampleSize) &&
    (partial.sampleSize as number) >= PREDICTION_RELIABILITY_MIN_SAMPLE;

  if (partial.status === 'UNAVAILABLE' || partial.probability == null) {
    return {
      ...partial,
      status: 'UNAVAILABLE',
      reason: partial.reason ?? 'NO_FORCED_PREDICTION',
      calibrationStatus: 'UNAVAILABLE',
      calibrationNote: 'No forced prediction — insufficient or missing evidence.',
      probability: null,
    };
  }

  const cal = partial.hasCalibrationEvidence
    ? 'AVAILABLE'
    : (partial.calibrationStatus ?? 'NOT_MEASURED');

  return {
    ...partial,
    status: sampleOk || partial.sampleSize == null ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: sampleOk || partial.sampleSize == null ? undefined : 'INSUFFICIENT_HISTORY',
    calibrationStatus:
      cal === 'AVAILABLE' && !partial.hasCalibrationEvidence ? 'NOT_MEASURED' : cal,
    calibrationNote:
      cal === 'AVAILABLE' && partial.hasCalibrationEvidence
        ? 'Calibration evidence present from walk-forward.'
        : 'Uncalibrated model output must not be presented as calibrated probability. Confidence ≠ probability.',
  };
}

/**
 * Comparative improvement claim — never assume historical intelligence improved predictions.
 */
export function assessPredictionImprovement(input: {
  hasMatchedWalkForwardComparison: boolean;
  sameWindow?: boolean;
  sameHorizon?: boolean;
  sameUniverse?: boolean;
  sameCostConvention?: boolean;
  sameLeakageControls?: boolean;
  statisticallyBetter?: boolean | null;
}): PredictionImprovementClaim {
  if (
    !input.hasMatchedWalkForwardComparison ||
    !input.sameWindow ||
    !input.sameHorizon ||
    !input.sameUniverse ||
    !input.sameCostConvention ||
    !input.sameLeakageControls
  ) {
    return {
      status: 'IMPROVEMENT_NOT_VERIFIED',
      message:
        'IMPROVEMENT NOT VERIFIED — no matched walk-forward comparison (same window, horizon, universe, cost convention, leakage controls). Adding historical intelligence does not by itself prove better predictions.',
    };
  }
  if (input.statisticallyBetter === true) {
    return {
      status: 'PASS',
      message: 'Matched walk-forward comparison supports improvement claim.',
    };
  }
  if (input.statisticallyBetter === false) {
    return {
      status: 'FAIL',
      message: 'Matched walk-forward comparison does not support improvement.',
    };
  }
  return {
    status: 'IMPROVEMENT_NOT_VERIFIED',
    message:
      'IMPROVEMENT NOT VERIFIED — comparison present but statistical superiority not demonstrated.',
  };
}

export function emptyReliabilityDashboardNote(): string {
  return `Prediction reliability store empty or below min sample (${PREDICTION_RELIABILITY_MIN_SAMPLE}). Metrics UNAVAILABLE. Measure/calibrate only — does not modify Risk/Portfolio/Policy/Gate. Provenance: ${JSON.stringify(provenance('prediction-reliability', { modelVersion: PREDICTION_RELIABILITY_VERSION }))}`;
}
