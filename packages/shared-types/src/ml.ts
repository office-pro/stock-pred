/** Direction classes predicted by the ML engine. */
export enum PredictionDirection {
  UP = 'UP',
  DOWN = 'DOWN',
  SIDEWAYS = 'SIDEWAYS',
}

/** Prediction horizons. */
export enum PredictionHorizon {
  NEXT_DAY = 'NEXT_DAY',
  NEXT_WEEK = 'NEXT_WEEK',
}

/** ML prediction (spec contract). */
export interface Prediction {
  symbol: string;
  direction: string;
  /** 0-100: ensemble max class probability. */
  confidence: number;
  /** Expected move in percent (signed). */
  expectedMove: number;
}

/** Freshness of an ML prediction for trade-intelligence consumers. */
export type MlFreshnessStatus = 'fresh' | 'stale' | 'missing' | 'incompatible';

/**
 * Serving-time drift status (M4).
 * `insufficient_data` means calibration/outcome drift was not scored (too few
 * realized outcomes) — it is not by itself a usability reject.
 */
export type MlDriftStatus = 'ok' | 'warn' | 'incompatible' | 'insufficient_data';

/** Prediction enriched with horizon, model metadata, and M1 provenance. */
export interface HorizonPrediction extends Prediction {
  horizon: PredictionHorizon;
  modelVersion: string;
  /** Registry model id of the ACTIVE artifact that produced this prediction (M4). */
  modelId?: string;
  generatedAt: number;
  probabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
  /**
   * Calibrated class probabilities (M2). Not interchangeable with `confidence`
   * (raw ensemble max-class score).
   */
  calibratedProbabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
  /** ISO timestamp when the prediction was produced. */
  predictionTimestamp?: string;
  /** ISO timestamp of the latest market/feature bar used. */
  sourceDataTimestamp?: string | null;
  /** ISO timestamp after which the prediction must not be treated as fresh. */
  expiresAt?: string;
  featureVersion?: string;
  datasetVersion?: string;
  freshnessStatus?: MlFreshnessStatus;
  /** M4 drift stamp — incompatible predictions must not be treated as usable. */
  driftStatus?: MlDriftStatus;
  priceAdjustmentMode?: string;
  expectedReturn?: number | null;
  expectedMfe?: number | null;
  expectedMae?: number | null;
}

/**
 * Immutable ML evidence attached to IntelligenceSnapshot / decision ledger (M4).
 * Audit / TI interpretation only — never Risk / Portfolio / Policy / Gate input.
 */
export interface MLPredictionSnapshot {
  schemaVersion: 'ml-prediction-snapshot.v1';
  modelId: string;
  modelVersion: string;
  featureVersion: string;
  datasetVersion?: string;
  horizon: string;
  predictionTimestamp: string;
  expiresAt?: string;
  freshnessStatus: MlFreshnessStatus;
  driftStatus: MlDriftStatus;
  priceAdjustmentMode?: string;
  direction?: string;
  /** Raw ensemble confidence — not calibrated probability. */
  confidence?: number;
  calibratedProbabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
  expectedReturn?: number | null;
  expectedMfe?: number | null;
  expectedMae?: number | null;
}

/** Build an audit snapshot from a usable HorizonPrediction (omits inventing scores). */
export function toMLPredictionSnapshot(
  prediction: HorizonPrediction,
): MLPredictionSnapshot | undefined {
  if (!prediction.modelId || !prediction.predictionTimestamp) return undefined;
  return {
    schemaVersion: 'ml-prediction-snapshot.v1',
    modelId: prediction.modelId,
    modelVersion: prediction.modelVersion,
    featureVersion: prediction.featureVersion ?? 'unknown',
    datasetVersion: prediction.datasetVersion,
    horizon: String(prediction.horizon),
    predictionTimestamp: prediction.predictionTimestamp,
    expiresAt: prediction.expiresAt,
    freshnessStatus: prediction.freshnessStatus ?? 'missing',
    driftStatus: prediction.driftStatus ?? 'insufficient_data',
    priceAdjustmentMode: prediction.priceAdjustmentMode,
    direction: prediction.direction,
    confidence: prediction.confidence,
    calibratedProbabilities: prediction.calibratedProbabilities,
    expectedReturn: prediction.expectedReturn,
    expectedMfe: prediction.expectedMfe,
    expectedMae: prediction.expectedMae,
  };
}

/** Ensemble weights (spec: 40/25/20/15). */
export const ENSEMBLE_WEIGHTS = {
  xgboost: 0.4,
  lightgbm: 0.25,
  lstm: 0.2,
  transformer: 0.15,
} as const;

/** One confidence bucket vs realized hit rate (calibration). */
export interface AccuracyBucket {
  label: string;
  minConfidence: number;
  maxConfidence: number;
  predicted: number;
  correct: number;
  hitRate: number | null;
}

export interface ActionAccuracy {
  predicted: number;
  correct: number;
  hitRate: number | null;
}

/** Scored track record for a forecast horizon. */
export interface PredictionAccuracy {
  horizon: string;
  sessions: number;
  overallHitRate: number | null;
  byAction: {
    BUY: ActionAccuracy;
    SELL: ActionAccuracy;
    HOLD: ActionAccuracy;
  };
  calibration: AccuracyBucket[];
  avgPnlPercent: number | null;
  scoredCalls?: number;
  source?: string;
  ensemble?: string;
  holdoutDays?: number;
}
