import { Timeframe } from '@stockpred/shared-types';
import { mulberry32, seedFromSymbol, SimulatedProvider } from './simulated.provider';

describe('SimulatedProvider', () => {
  const provider = new SimulatedProvider();

  it('produces the requested number of valid candles', async () => {
    const candles = await provider.getDailyHistory('RELIANCE', 300, 2950);
    expect(candles).toHaveLength(300);
    for (const candle of candles) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.volume).toBeGreaterThan(0);
      expect(candle.timeframe).toBe(Timeframe.ONE_DAY);
    }
  });

  it('is deterministic per symbol', async () => {
    const a = await provider.getDailyHistory('TCS', 100, 4100);
    const b = await provider.getDailyHistory('TCS', 100, 4100);
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close));
  });

  it('differs across symbols', async () => {
    const a = await provider.getDailyHistory('TCS', 100, 4100);
    const b = await provider.getDailyHistory('INFY', 100, 4100);
    expect(a.map((c) => c.close)).not.toEqual(b.map((c) => c.close));
  });

  it('lands near the base price at the end of the series', async () => {
    const candles = await provider.getDailyHistory('HDFCBANK', 500, 1650);
    const lastClose = candles[candles.length - 1].close;
    expect(lastClose).toBeGreaterThan(1650 * 0.3);
    expect(lastClose).toBeLessThan(1650 * 3);
  });

  it('uses chronologically increasing timestamps', async () => {
    const candles = await provider.getDailyHistory('ITC', 50, 465);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    }
  });
});

describe('mulberry32 / seedFromSymbol', () => {
  it('produces deterministic sequences in [0, 1)', () => {
    const rng1 = mulberry32(seedFromSymbol('ABC'));
    const rng2 = mulberry32(seedFromSymbol('ABC'));
    for (let i = 0; i < 100; i += 1) {
      const value = rng1();
      expect(value).toBe(rng2());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
