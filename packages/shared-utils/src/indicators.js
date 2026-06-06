'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.sma = sma;
exports.ema = ema;
exports.rsi = rsi;
exports.macd = macd;
exports.atr = atr;
exports.bollinger = bollinger;
exports.vwap = vwap;
exports.computeIndicatorSnapshot = computeIndicatorSnapshot;
const math_1 = require('./math');
/**
 * All series functions return arrays aligned with the input, padded with NaN
 * until enough data points exist. Use `lastFinite` to read the latest value.
 */
function sma(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  let windowSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}
function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  out[period - 1] = (0, math_1.mean)(values.slice(0, period));
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}
/** Wilder's RSI. */
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN,
  );
  // Signal line: EMA over the defined region of the MACD line.
  const firstDefined = macdLine.findIndex((v) => Number.isFinite(v));
  const signal = new Array(values.length).fill(NaN);
  if (firstDefined >= 0) {
    const defined = macdLine.slice(firstDefined);
    const signalDefined = ema(defined, signalPeriod);
    for (let i = 0; i < signalDefined.length; i += 1) {
      signal[firstDefined + i] = signalDefined[i];
    }
  }
  const histogram = macdLine.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );
  return { macd: macdLine, signal, histogram };
}
/** Wilder's Average True Range. */
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  out[period - 1] = (0, math_1.mean)(trs.slice(0, period));
  for (let i = period; i < candles.length; i += 1) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}
function bollinger(values, period = 20, multiplier = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(NaN);
  const lower = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    const deviation = (0, math_1.std)(values.slice(i - period + 1, i + 1));
    upper[i] = middle[i] + multiplier * deviation;
    lower[i] = middle[i] - multiplier * deviation;
  }
  return { upper, middle, lower };
}
/** Cumulative (session-anchored) VWAP across the supplied candles. */
function vwap(candles) {
  const out = new Array(candles.length).fill(NaN);
  let cumPV = 0;
  let cumVolume = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typical * candles[i].volume;
    cumVolume += candles[i].volume;
    out[i] = cumVolume > 0 ? cumPV / cumVolume : NaN;
  }
  return out;
}
/** Sessions used to anchor the dashboard VWAP (a full-history cumulative
 * VWAP would be dominated by decade-old prices and meaningless). */
const VWAP_ANCHOR_SESSIONS = 20;
/** Compute the latest indicator snapshot from a candle history. */
function computeIndicatorSnapshot(symbol, candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const macdSeries = macd(closes);
  const boll = bollinger(closes);
  const nullable = (v) => (v === null ? null : (0, math_1.round2)(v));
  return {
    symbol,
    time: candles.length > 0 ? candles[candles.length - 1].time : 0,
    rsi: nullable((0, math_1.lastFinite)(rsi(closes))),
    macd: nullable((0, math_1.lastFinite)(macdSeries.macd)),
    macdSignal: nullable((0, math_1.lastFinite)(macdSeries.signal)),
    macdHistogram: nullable((0, math_1.lastFinite)(macdSeries.histogram)),
    atr: nullable((0, math_1.lastFinite)(atr(candles))),
    ema20: nullable((0, math_1.lastFinite)(ema(closes, 20))),
    ema50: nullable((0, math_1.lastFinite)(ema(closes, 50))),
    ema200: nullable((0, math_1.lastFinite)(ema(closes, 200))),
    vwap: nullable((0, math_1.lastFinite)(vwap(candles.slice(-VWAP_ANCHOR_SESSIONS)))),
    bollingerUpper: nullable((0, math_1.lastFinite)(boll.upper)),
    bollingerMiddle: nullable((0, math_1.lastFinite)(boll.middle)),
    bollingerLower: nullable((0, math_1.lastFinite)(boll.lower)),
    avgVolume20: nullable((0, math_1.lastFinite)(sma(volumes, 20))),
  };
}
//# sourceMappingURL=indicators.js.map
