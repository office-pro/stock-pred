import type { Candle, DetectedPattern, EvaluatedSignal, ExecutedTrade, HorizonPrediction, IndicatorSnapshot, Tick } from '@stockpred/shared-types';
export type MarketTickEvent = Tick;
export interface MarketCandleEvent {
    candle: Candle;
    /** Snapshot computed on candle close; null while history is warming up. */
    indicators: IndicatorSnapshot | null;
}
export type SignalGeneratedEvent = EvaluatedSignal;
export type PatternDetectedEvent = DetectedPattern;
export type PredictionGeneratedEvent = HorizonPrediction;
export type TradeExecutedEvent = ExecutedTrade;
export interface NotificationSentEvent {
    id: string;
    type: 'SIGNAL' | 'PATTERN' | 'PREDICTION' | 'TRADE' | 'RISK';
    title: string;
    message: string;
    symbol?: string;
    createdAt: number;
}
//# sourceMappingURL=events.d.ts.map