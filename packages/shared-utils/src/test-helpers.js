'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.candlesFromCloses = candlesFromCloses;
exports.uptrendCloses = uptrendCloses;
exports.downtrendCloses = downtrendCloses;
const shared_types_1 = require('@stockpred/shared-types');
const DAY_MS = 24 * 60 * 60 * 1000;
/** Build a deterministic daily candle series from a close-price path. */
function candlesFromCloses(closes, options = {}) {
  const symbol = options.symbol ?? 'TEST';
  const startTime = options.startTime ?? Date.UTC(2024, 0, 1);
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    return {
      symbol,
      timeframe: shared_types_1.Timeframe.ONE_DAY,
      time: startTime + i * DAY_MS,
      open,
      high,
      low,
      close,
      volume: options.volumes?.[i] ?? 1000,
    };
  });
}
/**
 * Accelerating exponential uptrend: the rising growth rate keeps the MACD
 * line expanding above its signal line (histogram > 0) so trend rules are
 * deterministically bullish at the end of the series.
 */
function uptrendCloses(bars, base = 100) {
  const closes = [];
  let price = base;
  for (let i = 0; i < bars; i += 1) {
    const rate = 0.0008 + 0.003 * (i / bars);
    price *= Math.exp(rate);
    closes.push(price);
  }
  return closes;
}
/** Accelerating exponential downtrend (deterministically bearish MACD). */
function downtrendCloses(bars, base = 200) {
  const closes = [];
  let price = base;
  for (let i = 0; i < bars; i += 1) {
    const rate = 0.0008 + 0.003 * (i / bars);
    price *= Math.exp(-rate);
    closes.push(price);
  }
  return closes;
}
//# sourceMappingURL=test-helpers.js.map
