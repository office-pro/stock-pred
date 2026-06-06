/** Direction classes predicted by the ML engine. */
export declare enum PredictionDirection {
    UP = "UP",
    DOWN = "DOWN",
    SIDEWAYS = "SIDEWAYS"
}
/** Prediction horizons. */
export declare enum PredictionHorizon {
    NEXT_DAY = "NEXT_DAY",
    NEXT_WEEK = "NEXT_WEEK"
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
}
/** Ensemble weights (spec: 40/25/20/15). */
export declare const ENSEMBLE_WEIGHTS: {
    readonly xgboost: 0.4;
    readonly lightgbm: 0.25;
    readonly lstm: 0.2;
    readonly transformer: 0.15;
};
//# sourceMappingURL=ml.d.ts.map