import {
  COMMODITY_SCRAPE_FORBIDDEN,
  normalizeAlphaVantageCommoditySeries,
  normalizeEiaSeries,
} from './commodity-market-data';

describe('commodity AV/EIA market data', () => {
  it('normalizes AV catalog series as historical products, not live contracts', () => {
    const parsed = normalizeAlphaVantageCommoditySeries(
      {
        data: [
          { date: '2024-01-01', value: '70' },
          { date: '2024-02-01', value: '72' },
        ],
      },
      'WTI',
    );
    expect(parsed.print?.provider).toBe('alpha-vantage');
    expect(parsed.print?.providerAssetId).toBe('WTI');
    expect(parsed.print?.dataStatus).toBe('HISTORICAL');
    expect(parsed.history).toHaveLength(2);
    expect(COMMODITY_SCRAPE_FORBIDDEN).toBe(true);
  });

  it('normalizes EIA energy history as HISTORICAL', () => {
    const parsed = normalizeEiaSeries(
      { response: { data: [{ period: '2024-03-01', value: 1.8 }] } },
      'NG',
    );
    expect(parsed.print?.provider).toBe('eia');
    expect(parsed.print?.dataStatus).toBe('HISTORICAL');
  });
});
