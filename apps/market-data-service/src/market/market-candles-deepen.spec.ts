/**
 * A daily request longer than the bhavcopy-seeded in-memory series must be served
 * from the deeper candle cache, not truncated to the ~90 in-memory sessions.
 */

import { Timeframe, type Candle } from '@stockpred/shared-types';
import { InFlightRequestRegistry } from './in-flight-registry';
import { MarketService } from './market.service';

const DAY = 86_400_000;

function bars(symbol: string, startDay: number, count: number, close: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol,
    timeframe: Timeframe.ONE_DAY,
    time: (startDay + i) * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

function service(daily: Candle[], cached: Candle[], hydrated = false) {
  const load = jest.fn(async (_symbol: string, limit: number) => cached.slice(-limit));
  const svc = Object.create(MarketService.prototype) as MarketService;
  Object.assign(svc, {
    indices: new Map(),
    stocks: new Map([['ABB', { info: { symbol: 'ABB' }, daily, indicators: null }]]),
    hydrateTried: new Set(hydrated ? ['ABB'] : []),
    dailyDeepenedTo: new Map(),
    inFlight: new InFlightRequestRegistry(),
    cache: { load },
  });
  return { svc, load };
}

describe('MarketService.getCandles daily deepen', () => {
  it('merges deeper cached bars when the request exceeds the in-memory series', async () => {
    const memory = bars('ABB', 400, 87, 2);
    const { svc, load } = service(memory, bars('ABB', 87, 400, 1));

    const out = await svc.getCandles('ABB', Timeframe.ONE_DAY, 325);

    expect(load).toHaveBeenCalledWith('ABB', 325);
    expect(out).toHaveLength(325);
    expect(out[out.length - 1].close).toBe(2);
    expect(out[0].time).toBeLessThan(memory[0].time);
  });

  it('does not re-read the cache once that depth was merged', async () => {
    const { svc, load } = service(bars('ABB', 400, 87, 2), bars('ABB', 100, 400, 1));
    await svc.getCandles('ABB', Timeframe.ONE_DAY, 325);
    await svc.getCandles('ABB', Timeframe.ONE_DAY, 325);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves memory directly when it already covers the request', async () => {
    const { svc, load } = service(bars('ABB', 400, 87, 2), bars('ABB', 100, 400, 1));
    const out = await svc.getCandles('ABB', Timeframe.ONE_DAY, 60);
    expect(out).toHaveLength(60);
    expect(load).not.toHaveBeenCalled();
  });

  it('skips the cache read for symbols already bootstrapped', async () => {
    const { svc, load } = service(bars('ABB', 400, 87, 2), bars('ABB', 100, 400, 1), true);
    const out = await svc.getCandles('ABB', Timeframe.ONE_DAY, 325);
    expect(out).toHaveLength(87);
    expect(load).not.toHaveBeenCalled();
  });
});
