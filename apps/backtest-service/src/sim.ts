import { Candle, Timeframe } from '@stockpred/shared-types';
import { round2 } from '@stockpred/shared-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Self-contained GBM candle generator for the CLI / offline mode, so a
 * backtest can run without the market-data-service being online.
 * Deterministic per symbol (same scheme as the simulated provider).
 */
export function generateCandles(symbol: string, days: number, basePrice = 1000): Candle[] {
  let seed = 2166136261;
  for (let i = 0; i < symbol.length; i += 1) {
    seed ^= symbol.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  const rng = (): number => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = (): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const dailyDrift = 0.0004;
  const dailyVol = 0.016;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = days - 1; i >= 0; i -= 1) {
    const shock = gaussian() * dailyVol * (1 + 0.25 * Math.sin((days - i) / 40));
    const open = price;
    const close = price * Math.exp(dailyDrift + shock);
    const wick = Math.abs(gaussian()) * dailyVol * 0.7;
    candles.push({
      symbol,
      timeframe: Timeframe.ONE_DAY,
      time: end.getTime() - i * DAY_MS,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume: Math.floor(500_000 * (0.6 + rng())),
    });
    price = close;
  }
  // Anchor the latest close on the reference price (see simulated provider).
  const scale = basePrice / candles[candles.length - 1].close;
  for (const candle of candles) {
    candle.open = round2(candle.open * scale);
    candle.high = round2(candle.high * scale);
    candle.low = round2(candle.low * scale);
    candle.close = round2(candle.close * scale);
  }
  return candles;
}
