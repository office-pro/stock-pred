import type { Candle, IndicatorSnapshot, MarketBreadth } from '@stockpred/shared-types';
import { round2 } from './math';

export interface BreadthSample {
  changePercent: number;
  close: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  high52w: number | null;
  low52w: number | null;
}

export function sampleFromCandles(
  candles: Candle[],
  indicators: IndicatorSnapshot | null,
): BreadthSample | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const year = candles.slice(-252);
  return {
    changePercent: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    close: last.close,
    ema20: indicators?.ema20 ?? null,
    ema50: indicators?.ema50 ?? null,
    ema200: indicators?.ema200 ?? null,
    high52w: year.length >= 60 ? Math.max(...year.map((c) => c.high)) : null,
    low52w: year.length >= 60 ? Math.min(...year.map((c) => c.low)) : null,
  };
}

/** Universe participation: advances, % above MAs, 52-week highs/lows. */
export function computeMarketBreadth(samples: BreadthSample[], asOf = Date.now()): MarketBreadth {
  const usable = samples.filter((s) => Number.isFinite(s.close) && s.close > 0);
  const sampleSize = usable.length;
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let above20 = 0;
  let ema20n = 0;
  let above50 = 0;
  let ema50n = 0;
  let above200 = 0;
  let ema200n = 0;
  let newHighs52w = 0;
  let newLows52w = 0;
  for (const row of usable) {
    if (row.changePercent > 0.05) advancing += 1;
    else if (row.changePercent < -0.05) declining += 1;
    else unchanged += 1;
    if (row.ema20 !== null) {
      ema20n += 1;
      if (row.close > row.ema20) above20 += 1;
    }
    if (row.ema50 !== null) {
      ema50n += 1;
      if (row.close > row.ema50) above50 += 1;
    }
    if (row.ema200 !== null) {
      ema200n += 1;
      if (row.close > row.ema200) above200 += 1;
    }
    if (row.high52w !== null && row.close >= row.high52w * 0.999) newHighs52w += 1;
    if (row.low52w !== null && row.close <= row.low52w * 1.001) newLows52w += 1;
  }
  const advanceDeclineRatio = declining > 0 ? advancing / declining : advancing > 0 ? advancing : 0;
  const percentAboveEma20 = ema20n > 0 ? (above20 / ema20n) * 100 : 0;
  const percentAboveEma50 = ema50n > 0 ? (above50 / ema50n) * 100 : 0;
  const percentAboveEma200 = ema200n > 0 ? (above200 / ema200n) * 100 : 0;
  const participation: MarketBreadth['participation'] =
    percentAboveEma50 >= 55 && advanceDeclineRatio >= 1.2 ? 'BROAD' : 'NARROW';
  return {
    advancing,
    declining,
    unchanged,
    advanceDeclineRatio: round2(advanceDeclineRatio),
    percentAboveEma20: round2(percentAboveEma20),
    percentAboveEma50: round2(percentAboveEma50),
    percentAboveEma200: round2(percentAboveEma200),
    newHighs52w,
    newLows52w,
    participation,
    sampleSize,
    asOf,
  };
}
