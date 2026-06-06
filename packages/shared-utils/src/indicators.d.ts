import type { Candle, IndicatorSnapshot } from '@stockpred/shared-types';
/**
 * All series functions return arrays aligned with the input, padded with NaN
 * until enough data points exist. Use `lastFinite` to read the latest value.
 */
export declare function sma(values: number[], period: number): number[];
export declare function ema(values: number[], period: number): number[];
/** Wilder's RSI. */
export declare function rsi(values: number[], period?: number): number[];
export interface MacdSeries {
    macd: number[];
    signal: number[];
    histogram: number[];
}
export declare function macd(values: number[], fast?: number, slow?: number, signalPeriod?: number): MacdSeries;
/** Wilder's Average True Range. */
export declare function atr(candles: Candle[], period?: number): number[];
export interface BollingerSeries {
    upper: number[];
    middle: number[];
    lower: number[];
}
export declare function bollinger(values: number[], period?: number, multiplier?: number): BollingerSeries;
/** Cumulative (session-anchored) VWAP across the supplied candles. */
export declare function vwap(candles: Candle[]): number[];
/** Compute the latest indicator snapshot from a candle history. */
export declare function computeIndicatorSnapshot(symbol: string, candles: Candle[]): IndicatorSnapshot;
//# sourceMappingURL=indicators.d.ts.map