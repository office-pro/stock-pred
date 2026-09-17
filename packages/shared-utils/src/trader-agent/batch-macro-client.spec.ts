import {
  buildBatchMacroSnapshot,
  parseBlsTimeseries,
  parseFredCsv,
  MACRO_REQUESTED_SERIES,
  fetchBatchMacroSnapshot,
} from './batch-macro-client';

describe('batch-level macro snapshot', () => {
  it('parses FRED CSV and BLS JSON without inventing missing series', () => {
    const fed = parseFredCsv('DATE,FEDFUNDS\n2024-01-01,5.33\n2024-02-01,5.33\n', 'FEDFUNDS');
    expect(fed?.value).toBe(5.33);
    expect(fed?.source).toBe('SOURCE_REPORTED');
    expect(parseFredCsv('DATE,FEDFUNDS\n', 'FEDFUNDS')).toBeUndefined();

    const cpi = parseBlsTimeseries(
      {
        Results: {
          series: [
            { seriesID: 'CUUR0000SA0', data: [{ year: '2024', period: 'M12', value: '314.4' }] },
          ],
        },
      },
      'CUUR0000SA0',
    );
    expect(cpi?.value).toBe(314.4);
    expect(cpi?.provider).toBe('bls');
  });

  it('PARTIAL when some requested series are missing; UNAVAILABLE when none', () => {
    const partial = buildBatchMacroSnapshot([
      { seriesId: 'FEDFUNDS', value: 5.33, asOf: 1, source: 'SOURCE_REPORTED', provider: 'fred' },
    ]);
    expect(partial.requestedCount).toBe(MACRO_REQUESTED_SERIES.length);
    expect(partial.series).toHaveLength(1);
    expect(partial.requestedCount).toBeGreaterThan(partial.series.length);

    const none = buildBatchMacroSnapshot([]);
    expect(none.series).toEqual([]);
    expect(none.reasonCode).toBe('MACRO_SERIES_UNAVAILABLE');
  });

  it('fetches once per batch via injected HTTP and skips failed series', async () => {
    const urls: string[] = [];
    const macro = await fetchBatchMacroSnapshot(async (url) => {
      urls.push(url);
      if (url.includes('FEDFUNDS')) return 'DATE,FEDFUNDS\n2024-02-01,5.33\n';
      if (url.includes('CPIAUCSL')) throw new Error('fred down');
      if (url.includes('CUUR0000SA0')) {
        return {
          Results: {
            series: [{ data: [{ year: '2024', period: 'M01', value: '300' }] }],
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    expect(macro.series.map((s) => s.seriesId).sort()).toEqual(['CUUR0000SA0', 'FEDFUNDS']);
    expect(urls).toHaveLength(3);
    expect(macro.series.every((s) => s.source === 'SOURCE_REPORTED')).toBe(true);
  });
});
