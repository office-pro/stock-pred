import type { Candle, MarketIndex, RelativeComparison } from '@stockpred/shared-types';
import { round2 } from './math';

/**
 * Comparison mode: stock vs. a benchmark index (e.g. Nifty Midcap).
 * Relative strength is the ratio of cumulative returns over the window;
 * relative performance is the outperformance in percentage points.
 */
export function compareToBenchmark(
  symbol: string,
  benchmark: MarketIndex,
  stockCandles: Candle[],
  benchmarkCandles: Candle[],
  windowDays = 60,
): RelativeComparison | null {
  const n = Math.min(windowDays, stockCandles.length, benchmarkCandles.length);
  if (n < 2) return null;
  const stockWindow = stockCandles.slice(-n);
  const benchWindow = benchmarkCandles.slice(-n);
  const stockStart = stockWindow[0].close;
  const benchStart = benchWindow[0].close;
  if (stockStart <= 0 || benchStart <= 0) return null;
  const stockReturn = stockWindow[stockWindow.length - 1].close / stockStart - 1;
  const benchReturn = benchWindow[benchWindow.length - 1].close / benchStart - 1;
  return {
    symbol,
    benchmark,
    relativeStrength: round2((1 + stockReturn) / (1 + benchReturn)),
    relativePerformancePercent: round2((stockReturn - benchReturn) * 100),
    windowDays: n,
  };
}
