import {
  BLS_V1_TIMESERIES_URL,
  buildBatchMacroSnapshot,
  FED_DDP_H15_CSV_URL,
  FED_H15_XML_URL,
  MACRO_REQUESTED_SERIES,
  fetchBatchMacroSnapshot,
  parseBlsTimeseries,
  parseFedDdpCsv,
  parseFedReleaseXml,
  parseTreasuryCsv,
} from './batch-macro-client';

describe('batch-level macro snapshot', () => {
  it('parses BLS v1, Fed Board XML/CSV, and Treasury without inventing missing series', () => {
    const fedXml = parseFedReleaseXml(
      '<kf:observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>',
      'FEDFUNDS',
    );
    expect(fedXml?.value).toBe(5.33);
    expect(fedXml?.provider).toBe('fed');
    expect(fedXml?.source).toBe('SOURCE_REPORTED');

    const fedCsv = parseFedDdpCsv('DATE,FEDFUNDS\n2024-01-01,5.33\n2024-02-01,5.33\n', 'FEDFUNDS');
    expect(fedCsv?.value).toBe(5.33);
    expect(parseFedReleaseXml('', 'FEDFUNDS')).toBeUndefined();

    const cpi = parseBlsTimeseries(
      {
        Results: {
          series: [
            { seriesID: 'CUUR0000SA0', data: [{ year: '2024', period: 'M12', value: '314.4' }] },
          ],
        },
      },
      'CPI',
    );
    expect(cpi?.value).toBe(314.4);
    expect(cpi?.provider).toBe('bls');

    const yield10 = parseTreasuryCsv('Date,10 Yr\n02/01/2024,4.22\n', 'DGS10');
    expect(yield10?.value).toBe(4.22);
    expect(yield10?.provider).toBe('treasury');
  });

  it('PARTIAL when some requested series are missing; UNAVAILABLE when none', () => {
    const partial = buildBatchMacroSnapshot([
      { seriesId: 'FEDFUNDS', value: 5.33, asOf: 1, source: 'SOURCE_REPORTED', provider: 'fed' },
    ]);
    expect(partial.requestedCount).toBe(MACRO_REQUESTED_SERIES.length);
    expect(partial.series).toHaveLength(1);
    expect(partial.requestedCount).toBeGreaterThan(partial.series.length);

    const none = buildBatchMacroSnapshot([]);
    expect(none.series).toEqual([]);
    expect(none.reasonCode).toBe('MACRO_SERIES_UNAVAILABLE');
  });

  it('fetches BLS v1 + Fed XML primary + Treasury and skips failed series', async () => {
    const urls: string[] = [];
    const macro = await fetchBatchMacroSnapshot(async (url) => {
      urls.push(url);
      if (url === FED_H15_XML_URL) return '<observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>';
      if (url.includes('CUUR0000SA0')) {
        return {
          Results: {
            series: [{ data: [{ year: '2024', period: 'M01', value: '300' }] }],
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    expect(macro.series.map((s) => s.seriesId).sort()).toEqual(['CPI', 'FEDFUNDS']);
    expect(urls.some((u) => u === FED_H15_XML_URL)).toBe(true);
    expect(urls.some((u) => u === FED_DDP_H15_CSV_URL)).toBe(false);
    expect(
      urls.every(
        (u) =>
          u.startsWith(BLS_V1_TIMESERIES_URL) ||
          u === FED_H15_XML_URL ||
          u.includes('treasury.gov'),
      ),
    ).toBe(true);
    expect(urls.some((u) => /stlouisfed|fredgraph/i.test(u))).toBe(false);
    expect(macro.series.every((s) => s.source === 'SOURCE_REPORTED')).toBe(true);
  });

  it('falls back to Fed DDP CSV only when Board XML fails', async () => {
    const urls: string[] = [];
    const macro = await fetchBatchMacroSnapshot(async (url) => {
      urls.push(url);
      if (url === FED_H15_XML_URL) throw new Error('xml down');
      if (url === FED_DDP_H15_CSV_URL) return 'DATE,FEDFUNDS\n2024-02-01,5.33\n';
      throw new Error('skip');
    });
    expect(macro.series).toEqual([
      expect.objectContaining({ seriesId: 'FEDFUNDS', provider: 'fed', value: 5.33 }),
    ]);
    expect(urls).toContain(FED_H15_XML_URL);
    expect(urls).toContain(FED_DDP_H15_CSV_URL);
  });
});
