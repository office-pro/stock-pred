import { Candle } from '@stockpred/shared-types';
/** Build a deterministic daily candle series from a close-price path. */
export declare function candlesFromCloses(closes: number[], options?: {
    symbol?: string;
    volumes?: number[];
    startTime?: number;
}): Candle[];
/**
 * Accelerating exponential uptrend: the rising growth rate keeps the MACD
 * line expanding above its signal line (histogram > 0) so trend rules are
 * deterministically bullish at the end of the series.
 */
export declare function uptrendCloses(bars: number, base?: number): number[];
/** Accelerating exponential downtrend (deterministically bearish MACD). */
export declare function downtrendCloses(bars: number, base?: number): number[];
//# sourceMappingURL=test-helpers.d.ts.map