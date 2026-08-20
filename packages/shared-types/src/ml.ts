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

/** Prediction enriched with horizon and model metadata. */
export interface HorizonPrediction extends Prediction {
  horizon: PredictionHorizon;
  modelVersion: string;
  generatedAt: number;
  probabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
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
