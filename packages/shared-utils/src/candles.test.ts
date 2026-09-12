import { Timeframe } from '@stockpred/shared-types';
import { aggregateCandles, timeframeBucketMs } from './candles';

function minuteCandle(
  symbol: string,
  minuteIndex: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
) {
  return {
    symbol,
    timeframe: Timeframe.ONE_MINUTE,
    time: minuteIndex * 60_000,
    open,
    high,
    low,
    close,
    volume,
  };
}

describe('aggregateCandles', () => {
  it('returns empty for empty input', () => {
    expect(aggregateCandles([], Timeframe.FIVE_MINUTES)).toEqual([]);
  });

  it('labels 1m bars without merging', () => {
    const bars = [
      minuteCandle('AAA', 0, 10, 11, 9, 10.5),
      minuteCandle('AAA', 1, 10.5, 12, 10, 11),
    ];
    const out = aggregateCandles(bars, Timeframe.ONE_MINUTE);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.timeframe === Timeframe.ONE_MINUTE)).toBe(true);
  });

  it('aggregates five 1m bars into one 5m candle', () => {
    const bars = [
      minuteCandle('AAA', 0, 100, 101, 99, 100.5, 10),
      minuteCandle('AAA', 1, 100.5, 102, 100, 101, 20),
      minuteCandle('AAA', 2, 101, 103, 100.5, 102, 30),
      minuteCandle('AAA', 3, 102, 104, 101, 103, 40),
      minuteCandle('AAA', 4, 103, 105, 102, 104, 50),
    ];
    const out = aggregateCandles(bars, Timeframe.FIVE_MINUTES);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      symbol: 'AAA',
      timeframe: Timeframe.FIVE_MINUTES,
      time: 0,
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 150,
    });
  });

  it('splits across 15m boundaries', () => {
    const bars = [minuteCandle('BBB', 14, 10, 11, 9, 10), minuteCandle('BBB', 15, 10, 12, 10, 11)];
    const out = aggregateCandles(bars, Timeframe.FIFTEEN_MINUTES);
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(0);
    expect(out[1].time).toBe(15 * 60_000);
  });
});

describe('timeframeBucketMs', () => {
  it('maps intraday frames', () => {
    expect(timeframeBucketMs(Timeframe.FIVE_MINUTES)).toBe(300_000);
    expect(timeframeBucketMs(Timeframe.ONE_DAY)).toBeNull();
  });
});
