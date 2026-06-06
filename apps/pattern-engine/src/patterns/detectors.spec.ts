import { Candle, Timeframe } from '@stockpred/shared-types';
import {
  detectAscendingTriangle,
  detectBearFlag,
  detectBullFlag,
  detectCupAndHandle,
  detectDescendingTriangle,
  detectDoubleBottom,
  detectDoubleTop,
  detectHeadAndShoulders,
  detectInverseHeadAndShoulders,
  detectPatterns,
} from './detectors';

/** Tight candles (±0.1%) so close-path geometry holds for highs/lows. */
function tightCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    symbol: 'TEST',
    timeframe: Timeframe.ONE_DAY,
    time: 1_700_000_000_000 + i * 86_400_000,
    open: i === 0 ? close : closes[i - 1],
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
  }));
}

describe('detectDoubleBottom', () => {
  it('confirms two equal lows with a neckline breakout', () => {
    const closes = [
      100, 98, 96, 94, 92, 90, 91, 92.5, 94, 95.5, 96, 95, 93.5, 92, 91, 90.3, 91.5, 93, 94.5, 96.2,
      97.5,
    ];
    const result = detectDoubleBottom(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('DOUBLE_BOTTOM');
    expect(result?.signal).toBe('BUY');
    expect(result?.confidence).toBeGreaterThanOrEqual(50);
  });

  it('rejects an unconfirmed bottom (price below neckline)', () => {
    const closes = [
      100, 98, 96, 94, 92, 90, 91, 92.5, 94, 95.5, 96, 95, 93.5, 92, 91, 90.3, 91, 91.5, 92, 92.5,
      93,
    ];
    expect(detectDoubleBottom(tightCandles(closes))).toBeNull();
  });
});

describe('detectDoubleTop', () => {
  it('confirms two equal highs with a neckline breakdown', () => {
    const closes = [
      100, 102, 104, 106, 108, 110, 109, 107.5, 106, 104.5, 104, 105, 106.5, 108, 109, 109.7, 108,
      106, 104.5, 103, 102.5,
    ];
    const result = detectDoubleTop(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('DOUBLE_TOP');
    expect(result?.signal).toBe('SELL');
  });
});

describe('detectHeadAndShoulders', () => {
  it('confirms shoulders around a higher head with neckline breakdown', () => {
    const closes = [
      100, 103, 106, 108, 110, 108, 106.5, 105, 107, 110, 113, 116, 120, 117, 113, 109, 106, 105.5,
      107, 109, 110.3, 108, 106, 104.5, 103, 102,
    ];
    const result = detectHeadAndShoulders(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('HEAD_AND_SHOULDERS');
    expect(result?.direction).toBe('bearish');
  });
});

describe('detectInverseHeadAndShoulders', () => {
  it('confirms the inverse formation with a neckline breakout', () => {
    const closes = [
      100, 97, 94, 92, 90, 92, 93.5, 95, 92, 89, 85, 82, 84.5, 87, 90, 93, 94.7, 92.5, 91, 89.9,
      91.5, 93, 94.8, 96.2, 96.6,
    ];
    const result = detectInverseHeadAndShoulders(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('INVERSE_HEAD_AND_SHOULDERS');
    expect(result?.signal).toBe('BUY');
  });
});

describe('detectAscendingTriangle', () => {
  it('finds flat resistance with rising lows', () => {
    const closes = [
      90, 93, 96, 99, 100, 99, 97, 95, 93, 92, 94, 96, 98, 100.1, 99, 97.5, 96, 94.5, 93.5, 95,
      96.5, 98, 99.9, 99, 98, 97, 96.2, 97.5, 98.6, 99.8,
    ];
    const result = detectAscendingTriangle(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('ASCENDING_TRIANGLE');
    expect(result?.direction).toBe('bullish');
  });
});

describe('detectDescendingTriangle', () => {
  it('finds flat support with falling highs', () => {
    const closes = [
      110, 107, 104, 101, 98, 96, 95.2, 96.5, 98, 101, 104, 106.8, 104, 101, 98, 96, 95.1, 96.5, 98,
      100, 103.9, 101, 99, 97, 95.3, 95.8, 96.3, 95.5, 95.2, 95.0,
    ];
    const result = detectDescendingTriangle(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('DESCENDING_TRIANGLE');
    expect(result?.signal).toBe('SELL');
  });
});

describe('detectBullFlag', () => {
  it('finds a pole followed by a shallow flag', () => {
    const closes = [
      100, 100.5, 99.8, 100.2, 101, 103, 105, 107, 109, 111, 113, 114, 115, 114, 113, 112.2, 111.6,
      112.5, 113.2,
    ];
    const result = detectBullFlag(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('BULL_FLAG');
    expect(result?.signal).toBe('BUY');
  });
});

describe('detectBearFlag', () => {
  it('finds a falling pole followed by a weak bounce', () => {
    const closes = [
      115, 114.5, 115.2, 114.8, 114, 112, 110, 108, 106, 104, 102, 101, 100, 101, 102, 102.8, 103.4,
      102.6, 101.8,
    ];
    const result = detectBearFlag(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('BEAR_FLAG');
    expect(result?.direction).toBe('bearish');
  });
});

describe('detectCupAndHandle', () => {
  it('finds a rounded base with aligned rims and shallow handle', () => {
    const closes = [
      96, 98, 100, 99, 97, 95, 93, 91, 89, 87, 85.5, 84.5, 83.5, 83, 82.5, 82, 81.5, 81, 81.2, 81.8,
      82.5, 83.5, 85, 86.5, 88, 89.5, 91, 92.5, 94, 95, 96, 97, 98, 98.8, 99.5, 99.2, 98.5, 97.8,
      97.2, 97.5, 98.2, 98.8, 99.4, 99.8, 100.1,
    ];
    const result = detectCupAndHandle(tightCandles(closes));
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('CUP_AND_HANDLE');
    expect(result?.signal).toBe('BUY');
  });
});

describe('detectPatterns', () => {
  it('returns nothing for short histories', () => {
    expect(detectPatterns(tightCandles([100, 101, 102]))).toEqual([]);
  });

  it('returns nothing for a featureless linear ramp', () => {
    const closes = Array.from({ length: 35 }, (_, i) => 100 + i * 0.1);
    expect(detectPatterns(tightCandles(closes))).toEqual([]);
  });

  it('sorts multiple detections by confidence', () => {
    const closes = [
      100, 98, 96, 94, 92, 90, 91, 92.5, 94, 95.5, 96, 95, 93.5, 92, 91, 90.3, 91.5, 93, 94.5, 96.2,
      97.5,
    ];
    // Pad to satisfy the 30-candle minimum without disturbing recent swings.
    const padded = [...Array.from({ length: 12 }, (_, i) => 99 + i * 0.05), ...closes];
    const results = detectPatterns(tightCandles(padded));
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i].confidence).toBeLessThanOrEqual(results[i - 1].confidence);
    }
  });
});
