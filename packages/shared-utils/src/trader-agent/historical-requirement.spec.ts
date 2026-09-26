import { sufficientDailyCandleLimit, historicalRequirementKey } from './historical-requirement';

describe('historicalRequirementKey', () => {
  it('uses limit for latest-window identity', () => {
    expect(
      historicalRequirementKey({
        symbol: 'TCS',
        provider: 'mds',
        venue: 'NSE',
        timeframe: '1D',
        limit: 120,
      }),
    ).toBe('TCS:mds:NSE:1D:limit=120');
  });

  it('uses start/end so Custom 3Y is not confused with 1Y', () => {
    const oneY = historicalRequirementKey({
      symbol: 'TCS',
      provider: 'mds',
      venue: 'NSE',
      timeframe: '1D',
      start: '2025-09-18',
      end: '2026-09-18',
    });
    const threeY = historicalRequirementKey({
      symbol: 'TCS',
      provider: 'mds',
      venue: 'NSE',
      timeframe: '1D',
      start: '2023-09-18',
      end: '2026-09-18',
    });
    expect(oneY).not.toBe(threeY);
    expect(threeY).toContain('range=2023-09-18:2026-09-18');
  });
});

describe('sufficientDailyCandleLimit', () => {
  it('does not add prediction horizon to the download size', () => {
    const threeYear = sufficientDailyCandleLimit('1Y');
    const alsoOneYear = sufficientDailyCandleLimit('1Y');
    expect(threeYear.limit).toBe(alsoOneYear.limit);
    expect(threeYear.limit).toBeGreaterThan(200);
  });

  it('Custom window identity is the calendar range, not a generic limit', () => {
    const custom = sufficientDailyCandleLimit('CUSTOM', {
      startDate: '2023-01-01',
      endDate: '2026-01-01',
    });
    expect(custom.lookback).toBe('2023-01-01:2026-01-01');
    expect(custom.startDate).toBe('2023-01-01');
  });
});
