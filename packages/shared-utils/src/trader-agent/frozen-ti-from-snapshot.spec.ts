import type { BatchCandle, BatchDataSnapshot, BatchInstrumentData } from '@stockpred/shared-types';
import { tiCrossSectionalFromFrozen, tiMultiHorizonFromFrozen } from './frozen-ti-from-snapshot';

function bar(t: number, close: number): BatchCandle {
  return { time: t, open: close, high: close, low: close, close, volume: 1 };
}

describe('frozen TI from snapshot', () => {
  const row: BatchInstrumentData = {
    instrumentRef: {
      symbol: 'TCS',
      assetClass: 'EQUITY',
      venue: 'NSE',
      quoteCurrency: 'INR',
      canonicalSymbol: 'TCS',
    },
    quote: { price: 3500, relativeStrengthNifty50: 1.12, sector: 'IT' },
    candles: Array.from({ length: 80 }, (_, i) => bar(1_700_000_000_000 + i * 86_400_000, 100 + i)),
    dataStatus: 'AVAILABLE',
  };

  const snapshot = {
    shared: {
      benchmarks: {
        NIFTY_50: {
          symbol: 'NIFTY_50',
          timeframe: '1D',
          candles: Array.from({ length: 80 }, (_, i) =>
            bar(1_700_000_000_000 + i * 86_400_000, 200 + i * 0.5),
          ),
          dataAsOf: 1,
          source: 'mds',
          provider: 'mds',
        },
      },
    },
  } as unknown as BatchDataSnapshot;

  it('uses copied quote RS without inventing 0', () => {
    const ti = tiCrossSectionalFromFrozen({ symbol: 'TCS', row, snapshot });
    expect(ti.rsVsNifty50).toBe(1.12);
    expect(ti.rsSource).toBe('QUOTE');
    expect(ti.peVsMedianPct).toBeNull();
  });

  it('omits RS when missing rather than filling NEUTRAL/0', () => {
    const ti = tiCrossSectionalFromFrozen({
      symbol: 'TCS',
      row: { ...row, quote: { price: 3500 }, candles: [bar(1, 10)] },
      snapshot: { shared: { benchmarks: {} } } as unknown as BatchDataSnapshot,
    });
    expect(ti.rsVsNifty50).toBeNull();
    expect(ti.rsSource).toBe('MISSING');
  });

  it('builds D1/W1 from frozen daily candles (no MTF provider call)', () => {
    const mh = tiMultiHorizonFromFrozen({ row });
    expect(mh?.closesByHorizon.D1?.length).toBe(80);
    expect(mh?.closesByHorizon.W1?.length).toBeGreaterThan(0);
    expect(mh?.closesByHorizon.M5).toBeUndefined();
  });
});
