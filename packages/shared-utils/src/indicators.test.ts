import { atr, bollinger, computeIndicatorSnapshot, ema, macd, rsi, sma, vwap } from './indicators';
import { lastFinite } from './math';
import { candlesFromCloses, uptrendCloses } from './test-helpers';

describe('sma', () => {
  it('computes a simple moving average with NaN padding', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });

  it('returns all NaN when there is not enough data', () => {
    expect(sma([1, 2], 5).every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('ema', () => {
  it('stays constant for a constant series', () => {
    const out = ema(new Array(30).fill(50), 10);
    expect(lastFinite(out)).toBeCloseTo(50, 8);
  });

  it('seeds with the SMA of the first period', () => {
    const out = ema([1, 2, 3, 4, 5, 6], 3);
    expect(out[2]).toBe(2);
  });

  it('tracks an uptrend from below', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const out = ema(closes, 20);
    const last = lastFinite(out);
    expect(last).not.toBeNull();
    expect(last as number).toBeLessThan(closes[closes.length - 1]);
    expect(last as number).toBeGreaterThan(closes[closes.length - 21]);
  });
});

describe('rsi', () => {
  it('approaches 100 in a relentless uptrend', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(lastFinite(rsi(closes))).toBeCloseTo(100, 5);
  });

  it('approaches 0 in a relentless downtrend', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(lastFinite(rsi(closes))).toBeCloseTo(0, 5);
  });

  it('sits near 50 for an alternating series', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
    const value = lastFinite(rsi(closes));
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThan(35);
    expect(value as number).toBeLessThan(65);
  });
});

describe('macd', () => {
  it('is positive in a sustained uptrend', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * Math.exp(0.01 * i));
    const series = macd(closes);
    expect(lastFinite(series.macd) as number).toBeGreaterThan(0);
  });

  it('is negative in a sustained downtrend', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * Math.exp(-0.01 * i));
    const series = macd(closes);
    expect(lastFinite(series.macd) as number).toBeLessThan(0);
  });
});

describe('atr', () => {
  it('is positive and finite for a normal series', () => {
    const candles = candlesFromCloses(uptrendCloses(50));
    const value = lastFinite(atr(candles));
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThan(0);
  });
});

describe('bollinger', () => {
  it('collapses to the mean for a constant series', () => {
    const out = bollinger(new Array(30).fill(100), 20, 2);
    expect(lastFinite(out.upper)).toBeCloseTo(100, 8);
    expect(lastFinite(out.middle)).toBeCloseTo(100, 8);
    expect(lastFinite(out.lower)).toBeCloseTo(100, 8);
  });

  it('is symmetric around the middle band', () => {
    const closes = uptrendCloses(60);
    const out = bollinger(closes);
    const upper = lastFinite(out.upper) as number;
    const middle = lastFinite(out.middle) as number;
    const lower = lastFinite(out.lower) as number;
    expect(upper - middle).toBeCloseTo(middle - lower, 8);
  });
});

describe('vwap', () => {
  it('equals the typical price for a single candle', () => {
    const candles = candlesFromCloses([100]);
    const expected = (candles[0].high + candles[0].low + candles[0].close) / 3;
    expect(lastFinite(vwap(candles))).toBeCloseTo(expected, 8);
  });

  it('weights by volume', () => {
    const candles = candlesFromCloses([100, 200], { volumes: [0, 1000] });
    const typical2 = (candles[1].high + candles[1].low + candles[1].close) / 3;
    expect(lastFinite(vwap(candles))).toBeCloseTo(typical2, 8);
  });
});

describe('computeIndicatorSnapshot', () => {
  it('returns nulls when history is too short', () => {
    const snapshot = computeIndicatorSnapshot('TEST', candlesFromCloses([100, 101]));
    expect(snapshot.rsi).toBeNull();
    expect(snapshot.ema200).toBeNull();
  });

  it('fills all fields with enough history', () => {
    const snapshot = computeIndicatorSnapshot('TEST', candlesFromCloses(uptrendCloses(250)));
    expect(snapshot.rsi).not.toBeNull();
    expect(snapshot.macd).not.toBeNull();
    expect(snapshot.atr).not.toBeNull();
    expect(snapshot.ema20).not.toBeNull();
    expect(snapshot.ema50).not.toBeNull();
    expect(snapshot.ema200).not.toBeNull();
    expect(snapshot.vwap).not.toBeNull();
    expect(snapshot.bollingerUpper).not.toBeNull();
    expect(snapshot.avgVolume20).not.toBeNull();
    expect(snapshot.symbol).toBe('TEST');
  });
});
