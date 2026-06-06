import { Candle, SignalType } from '@stockpred/shared-types';
/**
 * Rule-based signal core. This module is the single source of truth for
 * BUY/SELL rules: the signal-engine uses it for live evaluation and the
 * backtest-service replays history through the exact same logic.
 */
export interface SignalEvaluation {
    type: SignalType;
    /** 0-100 weighted rule-satisfaction score for the winning side. */
    confidence: number;
    rules: Record<string, boolean>;
    price: number;
    target: number | null;
    stopLoss: number | null;
    riskReward: number | null;
}
/** Evaluate the latest bar of a candle history against the spec rule sets. */
export declare function evaluateSignal(candles: Candle[]): SignalEvaluation;
//# sourceMappingURL=signal-rules.d.ts.map