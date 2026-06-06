'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.compareToBenchmark = compareToBenchmark;
const math_1 = require('./math');
/**
 * Comparison mode: stock vs. a benchmark index (e.g. Nifty Midcap).
 * Relative strength is the ratio of cumulative returns over the window;
 * relative performance is the outperformance in percentage points.
 */
function compareToBenchmark(symbol, benchmark, stockCandles, benchmarkCandles, windowDays = 60) {
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
    relativeStrength: (0, math_1.round2)((1 + stockReturn) / (1 + benchReturn)),
    relativePerformancePercent: (0, math_1.round2)((stockReturn - benchReturn) * 100),
    windowDays: n,
  };
}
//# sourceMappingURL=relative.js.map
