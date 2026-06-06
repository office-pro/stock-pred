import type { Candle, MarketIndex, RelativeComparison } from '@stockpred/shared-types';
/**
 * Comparison mode: stock vs. a benchmark index (e.g. Nifty Midcap).
 * Relative strength is the ratio of cumulative returns over the window;
 * relative performance is the outperformance in percentage points.
 */
export declare function compareToBenchmark(symbol: string, benchmark: MarketIndex, stockCandles: Candle[], benchmarkCandles: Candle[], windowDays?: number): RelativeComparison | null;
//# sourceMappingURL=relative.d.ts.map