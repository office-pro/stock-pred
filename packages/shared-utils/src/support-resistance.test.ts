import {
  clusterLevels,
  computeSupportResistance,
  fibonacciRetracement,
  findSwingPoints,
  pivotPoints,
  volumeProfile,
} from './support-resistance';
import { candlesFromCloses } from './test-helpers';

describe('findSwingPoints', () => {
  it('finds peaks and troughs of a triangle wave', () => {
    // Explicit candles (open = close) so the high/low geometry is exact:
    // peak at index 2 (110), trough at index 5 (95).
    const closes = [100, 105, 110, 105, 100, 95, 100, 105, 110];
    const candles = closes.map((close, i) => ({
      symbol: 'TEST',
      timeframe: '1d' as never,
      time: 1_700_000_000_000 + i * 86_400_000,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    }));
    const { highs, lows } = findSwingPoints(candles, 2);
    expect(highs.length).toBeGreaterThanOrEqual(1);
    expect(lows.length).toBeGreaterThanOrEqual(1);
    expect(highs[0].index).toBe(2);
    expect(lows[0].index).toBe(5);
  });
});

describe('pivotPoints', () => {
  it('matches the classic floor-trader formulas', () => {
    const levels = pivotPoints({ high: 110, low: 90, close: 100 });
    expect(levels.pivot).toBe(100);
    expect(levels.r1).toBe(110);
    expect(levels.s1).toBe(90);
    expect(levels.r2).toBe(120);
    expect(levels.s2).toBe(80);
    expect(levels.r3).toBe(130);
    expect(levels.s3).toBe(70);
  });
});

describe('fibonacciRetracement', () => {
  it('places the 0.5 level at the midpoint of the range', () => {
    const closes = [100, 150, 200, 180, 160];
    const candles = candlesFromCloses(closes);
    const fib = fibonacciRetracement(candles);
    const mid = fib.levels.find((l) => l.ratio === 0.5);
    expect(mid).toBeDefined();
    expect(mid?.price).toBeCloseTo((fib.high + fib.low) / 2, 1);
    expect(fib.high).toBeGreaterThan(fib.low);
  });
});

describe('clusterLevels', () => {
  it('merges nearby prices and counts touches', () => {
    const clusters = clusterLevels([100, 100.2, 100.4, 110]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].strength).toBe(3);
    expect(clusters[0].price).toBeCloseTo(100.2, 1);
    expect(clusters[1].price).toBe(110);
  });

  it('handles empty input', () => {
    expect(clusterLevels([])).toEqual([]);
  });
});

describe('volumeProfile', () => {
  it('puts the POC where volume concentrates', () => {
    // Heavy volume near 100, light volume near 200.
    const closes = [100, 101, 99, 100, 200, 201];
    const volumes = [5000, 5000, 5000, 5000, 100, 100];
    const candles = candlesFromCloses(closes, { volumes });
    const profile = volumeProfile(candles, 10);
    expect(profile.poc).toBeLessThan(150);
  });
});

describe('computeSupportResistance', () => {
  it('returns empty arrays for tiny histories', () => {
    const result = computeSupportResistance(candlesFromCloses([100, 101]));
    expect(result.support).toEqual([]);
    expect(result.resistance).toEqual([]);
  });

  it('splits levels around the last close, nearest first', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.05);
    const candles = candlesFromCloses(closes);
    const lastClose = closes[closes.length - 1];
    const result = computeSupportResistance(candles);
    expect(result.support.length).toBeGreaterThan(0);
    expect(result.resistance.length).toBeGreaterThan(0);
    for (const s of result.support) expect(s).toBeLessThan(lastClose);
    for (const r of result.resistance) expect(r).toBeGreaterThanOrEqual(lastClose);
    // Nearest-first ordering.
    for (let i = 1; i < result.support.length; i += 1) {
      expect(result.support[i]).toBeLessThanOrEqual(result.support[i - 1]);
    }
    for (let i = 1; i < result.resistance.length; i += 1) {
      expect(result.resistance[i]).toBeGreaterThanOrEqual(result.resistance[i - 1]);
    }
  });

  it('respects maxLevels and includes vwap candidates', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 5));
    const candles = candlesFromCloses(closes);
    const result = computeSupportResistance(candles, { vwapValue: 100, maxLevels: 3 });
    expect(result.support.length).toBeLessThanOrEqual(3);
    expect(result.resistance.length).toBeLessThanOrEqual(3);
    expect(result.levels.some((l) => l.source === 'vwap')).toBe(true);
  });
});
