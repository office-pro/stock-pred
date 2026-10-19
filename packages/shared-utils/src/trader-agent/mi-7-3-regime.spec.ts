/**
 * MI-7.3 — Regime classification (confidence ≠ P(up)).
 */
import { assessAdvancedRegimeSection } from './mi-7-regime-engine';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import { sectionHasFabricatedMissing } from './mi-advanced-contract';

function candles(n: number, drift: number) {
  const out: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }> = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + drift;
    out.push({ time: i, open: p, high: p, low: p, close: p, volume: 1000 + i });
  }
  return out;
}

describe('MI-7.3 regime engine', () => {
  const asOf = '2026-06-01T00:00:00.000Z';
  const instrument = nseEquityInstrumentRef('REG');

  it('classifies BULL from uptrend without claiming prediction semantics', () => {
    const section = assessAdvancedRegimeSection({
      instrument,
      row: {
        instrumentRef: instrument,
        candles: candles(80, 0.01),
        dataStatus: 'AVAILABLE',
      },
      asOf,
      calculatedAt: asOf,
      sourceSnapshotId: 'MD-1',
    });
    expect(section.status).toBe('AVAILABLE');
    expect(section.payload?.semantics).toBe('OBSERVED_REGIME_CLASSIFICATION');
    expect(section.payload?.state).toBe('BULL');
    expect(typeof section.payload?.confidence).toBe('number');
  });

  it('DATA_INCOMPLETE / UNAVAILABLE without fabricated payload', () => {
    const section = assessAdvancedRegimeSection({
      instrument,
      row: { instrumentRef: instrument, candles: candles(5, 0), dataStatus: 'AVAILABLE' },
      asOf,
      calculatedAt: asOf,
    });
    expect(['DATA_INCOMPLETE', 'UNAVAILABLE']).toContain(section.status);
    expect(section.payload).toBeUndefined();
    expect(sectionHasFabricatedMissing(section)).toBe(false);
  });
});
