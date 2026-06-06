import { Candle, Timeframe } from '@stockpred/shared-types';
import { CandleStore } from './candle-store';

function candle(
  symbol: string,
  time: number,
  close: number,
  timeframe = Timeframe.ONE_DAY,
): Candle {
  return { symbol, timeframe, time, open: close, high: close, low: close, close, volume: 100 };
}

describe('CandleStore', () => {
  it('ignores non-daily candles', () => {
    const store = new CandleStore();
    store.apply(candle('TCS', 1000, 100, Timeframe.ONE_MINUTE));
    expect(store.get('TCS')).toHaveLength(0);
  });

  it('replaces the evolving daily bar in place', () => {
    const store = new CandleStore();
    store.apply(candle('TCS', 1000, 100));
    store.apply(candle('TCS', 1000, 105));
    expect(store.get('TCS')).toHaveLength(1);
    expect(store.get('TCS')[0].close).toBe(105);
  });

  it('appends new sessions in order and rejects stale bars', () => {
    const store = new CandleStore();
    store.apply(candle('TCS', 2000, 100));
    store.apply(candle('TCS', 3000, 110));
    store.apply(candle('TCS', 1000, 90)); // stale, ignored
    const series = store.get('TCS');
    expect(series).toHaveLength(2);
    expect(series[1].close).toBe(110);
  });

  it('tracks symbols independently', () => {
    const store = new CandleStore();
    store.apply(candle('TCS', 1000, 100));
    store.apply(candle('INFY', 1000, 200));
    expect(store.symbols().sort()).toEqual(['INFY', 'TCS']);
    expect(store.get('INFY')[0].close).toBe(200);
  });
});
