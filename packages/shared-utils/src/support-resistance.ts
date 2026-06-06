import type { Candle, PriceLevel, SupportResistance } from '@stockpred/shared-types';
import { round2 } from './math';

export interface SwingPoint {
  index: number;
  price: number;
}

export interface SwingPoints {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

/** Static S/R: local swing highs/lows with `lookback` bars on each side. */
export function findSwingPoints(candles: Candle[], lookback = 2): SwingPoints {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

export interface FibonacciLevels {
  high: number;
  low: number;
  levels: { ratio: number; price: number }[];
}

/** Dynamic S/R: Fibonacci retracement of the high/low range in the window. */
export function fibonacciRetracement(candles: Candle[], lookbackBars = 120): FibonacciLevels {
  const window = candles.slice(-lookbackBars);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const range = high - low;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  return {
    high,
    low,
    levels: ratios.map((ratio) => ({ ratio, price: round2(high - range * ratio) })),
  };
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

/** Classic floor-trader pivot points from the previous period's OHLC. */
export function pivotPoints(prev: { high: number; low: number; close: number }): PivotLevels {
  const pivot = (prev.high + prev.low + prev.close) / 3;
  return {
    pivot: round2(pivot),
    r1: round2(2 * pivot - prev.low),
    r2: round2(pivot + (prev.high - prev.low)),
    r3: round2(prev.high + 2 * (pivot - prev.low)),
    s1: round2(2 * pivot - prev.high),
    s2: round2(pivot - (prev.high - prev.low)),
    s3: round2(prev.low - 2 * (prev.high - pivot)),
  };
}

export interface VolumeProfileBin {
  price: number;
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  /** Point of control: price bin with the highest traded volume. */
  poc: number;
}

/** Dynamic S/R: volume distribution by price bins. */
export function volumeProfile(candles: Candle[], binCount = 24): VolumeProfile {
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const range = high - low || 1;
  const step = range / binCount;
  const bins: VolumeProfileBin[] = Array.from({ length: binCount }, (_, i) => ({
    price: round2(low + step * (i + 0.5)),
    volume: 0,
  }));
  for (const candle of candles) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((typical - low) / step)));
    bins[idx].volume += candle.volume;
  }
  const poc = bins.reduce((best, bin) => (bin.volume > best.volume ? bin : best), bins[0]);
  return { bins, poc: poc.price };
}

/** Cluster nearby prices (within tolerancePct) into single levels; strength = touches. */
export function clusterLevels(
  prices: number[],
  tolerancePct = 0.75,
): { price: number; strength: number }[] {
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { sum: number; count: number; anchor: number }[] = [];
  for (const price of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && Math.abs(price - cluster.anchor) / cluster.anchor <= tolerancePct / 100) {
      cluster.sum += price;
      cluster.count += 1;
    } else {
      clusters.push({ sum: price, count: 1, anchor: price });
    }
  }
  return clusters.map((c) => ({ price: round2(c.sum / c.count), strength: c.count }));
}

export interface SupportResistanceDetail extends SupportResistance {
  levels: PriceLevel[];
}

/**
 * Merge static (swing) and dynamic (fibonacci, pivots, VWAP, volume profile)
 * level sources, cluster them, and split into support/resistance around the
 * latest close. Nearest levels come first in each array.
 */
export function computeSupportResistance(
  candles: Candle[],
  options: { vwapValue?: number | null; maxLevels?: number } = {},
): SupportResistanceDetail {
  if (candles.length < 10) {
    return { support: [], resistance: [], levels: [] };
  }
  const maxLevels = options.maxLevels ?? 5;
  const lastClose = candles[candles.length - 1].close;

  const candidates: PriceLevel[] = [];
  const swings = findSwingPoints(candles);
  for (const sp of swings.highs) {
    candidates.push({ price: sp.price, kind: 'resistance', source: 'swing', strength: 1 });
  }
  for (const sp of swings.lows) {
    candidates.push({ price: sp.price, kind: 'support', source: 'swing', strength: 1 });
  }

  const fib = fibonacciRetracement(candles);
  for (const level of fib.levels) {
    candidates.push({
      price: level.price,
      kind: level.price <= lastClose ? 'support' : 'resistance',
      source: 'fibonacci',
      strength: 1,
    });
  }

  const prev = candles[candles.length - 2];
  const pivots = pivotPoints({ high: prev.high, low: prev.low, close: prev.close });
  for (const price of [pivots.s1, pivots.s2, pivots.s3]) {
    candidates.push({ price, kind: 'support', source: 'pivot', strength: 1 });
  }
  for (const price of [pivots.r1, pivots.r2, pivots.r3]) {
    candidates.push({ price, kind: 'resistance', source: 'pivot', strength: 1 });
  }

  if (options.vwapValue != null && Number.isFinite(options.vwapValue)) {
    candidates.push({
      price: round2(options.vwapValue),
      kind: options.vwapValue <= lastClose ? 'support' : 'resistance',
      source: 'vwap',
      strength: 1,
    });
  }

  const profile = volumeProfile(candles);
  candidates.push({
    price: profile.poc,
    kind: profile.poc <= lastClose ? 'support' : 'resistance',
    source: 'volume-profile',
    strength: 2,
  });

  const supportClusters = clusterLevels(
    candidates.filter((c) => c.price < lastClose).map((c) => c.price),
  );
  const resistanceClusters = clusterLevels(
    candidates.filter((c) => c.price >= lastClose).map((c) => c.price),
  );

  // Nearest-first ordering, strongest clusters preferred when equidistant.
  const support = supportClusters
    .sort((a, b) => b.price - a.price || b.strength - a.strength)
    .slice(0, maxLevels)
    .map((c) => c.price);
  const resistance = resistanceClusters
    .sort((a, b) => a.price - b.price || b.strength - a.strength)
    .slice(0, maxLevels)
    .map((c) => c.price);

  return { support, resistance, levels: candidates };
}
