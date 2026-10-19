/**
 * ENGINE_DERIVED technicals from frozen candles. Never Twelve Data /rsi /macd /adx.
 */

import type { BatchCandle, Candle } from '@stockpred/shared-types';
import { Timeframe } from '@stockpred/shared-types';
import { lastFinite } from '../math';
import { adx, atr, bollinger, computeIndicatorSnapshot, ema, macd, rsi, vwap } from '../indicators';

export interface BatchLocalTechnicals {
  source: 'ENGINE_DERIVED';
  rsi?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  atr?: number;
  vwap?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  adx?: number;
  asOf?: number;
}

function toCandles(symbol: string, rows: BatchCandle[]): Candle[] {
  return rows.map((c) => ({
    symbol,
    timeframe: Timeframe.ONE_DAY,
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

function finite(v: number | null | undefined): number | undefined {
  return v != null && Number.isFinite(v) ? v : undefined;
}

export function computeLocalTechnicalsFromCandles(
  symbol: string,
  candles: BatchCandle[] | undefined,
): BatchLocalTechnicals | undefined {
  if (!candles?.length) return undefined;
  const series = toCandles(symbol, candles);
  const closes = series.map((c) => c.close);
  const snap = computeIndicatorSnapshot(symbol, series);
  const macdSeries = macd(closes);
  const boll = bollinger(closes);
  const adxSeries = adx(series);
  const technicals: BatchLocalTechnicals = {
    source: 'ENGINE_DERIVED',
    rsi: finite(snap.rsi) ?? finite(lastFinite(rsi(closes))),
    ema20: finite(snap.ema20) ?? finite(lastFinite(ema(closes, 20))),
    ema50: finite(snap.ema50) ?? finite(lastFinite(ema(closes, 50))),
    ema200: finite(snap.ema200) ?? finite(lastFinite(ema(closes, 200))),
    macd: finite(snap.macd) ?? finite(lastFinite(macdSeries.macd)),
    macdSignal: finite(snap.macdSignal) ?? finite(lastFinite(macdSeries.signal)),
    macdHistogram: finite(snap.macdHistogram) ?? finite(lastFinite(macdSeries.histogram)),
    atr: finite(snap.atr) ?? finite(lastFinite(atr(series))),
    vwap: finite(snap.vwap) ?? finite(lastFinite(vwap(series))),
    bollingerUpper: finite(snap.bollingerUpper) ?? finite(lastFinite(boll.upper)),
    bollingerMiddle: finite(snap.bollingerMiddle) ?? finite(lastFinite(boll.middle)),
    bollingerLower: finite(snap.bollingerLower) ?? finite(lastFinite(boll.lower)),
    adx: finite(snap.adx) ?? finite(lastFinite(adxSeries)),
    asOf: snap.time || candles[candles.length - 1]?.time,
  };
  const hasAny = Object.entries(technicals).some(
    ([key, value]) =>
      key !== 'source' && key !== 'asOf' && typeof value === 'number' && Number.isFinite(value),
  );
  return hasAny ? technicals : undefined;
}
