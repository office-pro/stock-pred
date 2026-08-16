import type { Candle, MarketBreadth } from '@stockpred/shared-types';
import { MarketRegime } from '@stockpred/shared-types';
import { lastFinite } from './math';
import { ema } from './indicators';

function niftyTrendScore(candles: Candle[]): number {
  if (candles.length < 5) return 0;
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const ema50 = lastFinite(ema(closes, 50));
  const ema200 = lastFinite(ema(closes, 200));
  const ret20 = candles.length >= 21 ? (last / candles[candles.length - 21].close - 1) * 100 : 0;
  let score = 0;
  if (ema50 !== null && last > ema50) score += 1;
  else if (ema50 !== null && last < ema50) score -= 1;
  if (ema200 !== null && last > ema200) score += 1;
  else if (ema200 !== null && last < ema200) score -= 1;
  if (ema50 !== null && ema200 !== null && ema50 > ema200) score += 1;
  else if (ema50 !== null && ema200 !== null && ema50 < ema200) score -= 1;
  if (ret20 > 2) score += 1;
  else if (ret20 < -2) score -= 1;
  return score;
}

/**
 * STRONG_BULL … STRONG_BEAR from Nifty trend, breadth, VIX, and new highs/lows.
 * Uses only already-closed bars.
 */
export function classifyMarketRegime(
  niftyCandles: Candle[],
  breadth: MarketBreadth,
  vixLevel: number | null,
): MarketRegime {
  let score = niftyTrendScore(niftyCandles);
  if (breadth.percentAboveEma50 >= 65) score += 2;
  else if (breadth.percentAboveEma50 >= 55) score += 1;
  else if (breadth.percentAboveEma50 <= 35) score -= 2;
  else if (breadth.percentAboveEma50 <= 45) score -= 1;
  if (breadth.participation === 'BROAD') score += 1;
  else score -= 1;
  if (breadth.newHighs52w > breadth.newLows52w * 2 && breadth.newHighs52w >= 5) score += 1;
  if (breadth.newLows52w > breadth.newHighs52w * 2 && breadth.newLows52w >= 5) score -= 1;
  if (vixLevel !== null) {
    if (vixLevel >= 22) score -= 1;
    if (vixLevel <= 13) score += 1;
  }
  if (score >= 5) return MarketRegime.STRONG_BULL;
  if (score >= 2) return MarketRegime.BULL;
  if (score <= -5) return MarketRegime.STRONG_BEAR;
  if (score <= -2) return MarketRegime.BEAR;
  return MarketRegime.NEUTRAL;
}
