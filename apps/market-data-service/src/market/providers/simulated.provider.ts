import { Candle, Timeframe } from '@stockpred/shared-types';
import { round2 } from '@stockpred/shared-utils';
import type { MarketDataProvider } from './provider.interface';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic 32-bit PRNG so simulated histories are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromSymbol(symbol: string): number {
  let hash = 2166136261;
  for (let i = 0; i < symbol.length; i += 1) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Box-Muller standard normal from a uniform PRNG. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Synthetic NSE feed: geometric Brownian motion with mild positive drift,
 * regime cycles and volume clustering. Deterministic per symbol.
 */
export class SimulatedProvider implements MarketDataProvider {
  readonly name = 'simulated';

  getDailyHistory(symbol: string, days: number, basePrice: number): Promise<Candle[]> {
    const rng = mulberry32(seedFromSymbol(symbol));
    const annualDrift = 0.1 + (rng() - 0.4) * 0.12;
    const annualVol = 0.22 + rng() * 0.16;
    const dailyDrift = annualDrift / 252;
    const dailyVol = annualVol / Math.sqrt(252);
    const baseVolume = 200_000 + Math.floor(rng() * 1_800_000);

    // Work back from "today" so the last candle is the most recent session.
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const candles: Candle[] = [];

    let price = basePrice;
    for (let i = days - 1; i >= 0; i -= 1) {
      const time = end.getTime() - i * DAY_MS;
      // Slow sinusoidal regime + GBM step.
      const regime = 1 + 0.25 * Math.sin((days - i) / 40);
      const shock = gaussian(rng) * dailyVol * regime;
      const open = price;
      const close = price * Math.exp(dailyDrift + shock);
      const intraday = Math.abs(gaussian(rng)) * dailyVol * 0.7;
      const high = Math.max(open, close) * (1 + intraday);
      const low = Math.min(open, close) * (1 - intraday);
      const volumeFactor = 1 + Math.abs(shock) / dailyVol;
      const volume = Math.floor(baseVolume * volumeFactor * (0.6 + rng() * 0.8));
      candles.push({
        symbol,
        timeframe: Timeframe.ONE_DAY,
        time,
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    // Rescale so the most recent close sits exactly on the reference price -
    // GBM variance would otherwise drift the level far from realistic values.
    const scale = basePrice / candles[candles.length - 1].close;
    for (const candle of candles) {
      candle.open = round2(candle.open * scale);
      candle.high = round2(candle.high * scale);
      candle.low = round2(candle.low * scale);
      candle.close = round2(candle.close * scale);
    }
    return Promise.resolve(candles);
  }
}
