import type { Candle, IndicatorSnapshot } from '@stockpred/shared-types';
import { lastFinite, mean, round2, std } from './math';

/**
 * All series functions return arrays aligned with the input, padded with NaN
 * until enough data points exist. Use `lastFinite` to read the latest value.
 */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  let windowSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  out[period - 1] = mean(values.slice(0, period));
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
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

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdSeries {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN,
  );
  // Signal line: EMA over the defined region of the MACD line.
  const firstDefined = macdLine.findIndex((v) => Number.isFinite(v));
  const signal = new Array<number>(values.length).fill(NaN);
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
export function atr(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  out[period - 1] = mean(trs.slice(0, period));
  for (let i = period; i < candles.length; i += 1) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

export interface BollingerSeries {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function bollinger(values: number[], period = 20, multiplier = 2): BollingerSeries {
  const middle = sma(values, period);
  const upper = new Array<number>(values.length).fill(NaN);
  const lower = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    const deviation = std(values.slice(i - period + 1, i + 1));
    upper[i] = middle[i] + multiplier * deviation;
    lower[i] = middle[i] - multiplier * deviation;
  }
  return { upper, middle, lower };
}

/**
 * Wilder ADX. First defined after 2*period bars (DX window + ADX smooth).
 */
export function adx(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (period <= 0 || candles.length < period * 2) return out;
  const plusDM = new Array<number>(candles.length).fill(0);
  const minusDM = new Array<number>(candles.length).fill(0);
  const tr = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
  }
  let smTR = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= period; i += 1) {
    smTR += tr[i];
    smPlus += plusDM[i];
    smMinus += minusDM[i];
  }
  const dx = new Array<number>(candles.length).fill(NaN);
  const firstPlusDI = smTR === 0 ? 0 : (100 * smPlus) / smTR;
  const firstMinusDI = smTR === 0 ? 0 : (100 * smMinus) / smTR;
  const firstSum = firstPlusDI + firstMinusDI;
  dx[period] = firstSum === 0 ? 0 : (100 * Math.abs(firstPlusDI - firstMinusDI)) / firstSum;
  for (let i = period + 1; i < candles.length; i += 1) {
    smTR = smTR - smTR / period + tr[i];
    smPlus = smPlus - smPlus / period + plusDM[i];
    smMinus = smMinus - smMinus / period + minusDM[i];
    const plusDI = smTR === 0 ? 0 : (100 * smPlus) / smTR;
    const minusDI = smTR === 0 ? 0 : (100 * smMinus) / smTR;
    const diSum = plusDI + minusDI;
    dx[i] = diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum;
  }
  let adxVal = 0;
  let counted = 0;
  for (let i = period; i < candles.length; i += 1) {
    if (!Number.isFinite(dx[i])) continue;
    if (counted < period) {
      adxVal += dx[i];
      counted += 1;
      if (counted === period) {
        adxVal /= period;
        out[i] = adxVal;
      }
    } else {
      adxVal = (adxVal * (period - 1) + dx[i]) / period;
      out[i] = adxVal;
    }
  }
  return out;
}

/** Cumulative (session-anchored) VWAP across the supplied candles. */
export function vwap(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
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
export function computeIndicatorSnapshot(symbol: string, candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const macdSeries = macd(closes);
  const boll = bollinger(closes);
  const nullable = (v: number | null): number | null => (v === null ? null : round2(v));
  return {
    symbol,
    time: candles.length > 0 ? candles[candles.length - 1].time : 0,
    rsi: nullable(lastFinite(rsi(closes))),
    macd: nullable(lastFinite(macdSeries.macd)),
    macdSignal: nullable(lastFinite(macdSeries.signal)),
    macdHistogram: nullable(lastFinite(macdSeries.histogram)),
    atr: nullable(lastFinite(atr(candles))),
    ema20: nullable(lastFinite(ema(closes, 20))),
    ema50: nullable(lastFinite(ema(closes, 50))),
    ema200: nullable(lastFinite(ema(closes, 200))),
    vwap: nullable(lastFinite(vwap(candles.slice(-VWAP_ANCHOR_SESSIONS)))),
    bollingerUpper: nullable(lastFinite(boll.upper)),
    bollingerMiddle: nullable(lastFinite(boll.middle)),
    bollingerLower: nullable(lastFinite(boll.lower)),
    avgVolume20: nullable(lastFinite(sma(volumes, 20))),
    adx: nullable(lastFinite(adx(candles))),
  };
}
