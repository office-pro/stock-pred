import {
  ANALYSIS_PERIOD_LABELS,
  analysisWindowFromPeriod,
  defaultAnalysisPeriod,
  defaultAnalysisResolution,
  defaultCustomAnalysisWindow,
  normalizeAnalysisPeriod,
  normalizeAnalysisResolution,
  parseAnalysisWindow,
} from './analysis-period';

describe('analysis period vs candle resolution', () => {
  it('treats timeframe as lookback, not candle size', () => {
    expect(defaultAnalysisPeriod()).toBe('3M');
    expect(defaultAnalysisResolution()).toBe('1D');
    expect(normalizeAnalysisPeriod('1d')).toBe('3M');
    expect(normalizeAnalysisPeriod('1h')).toBe('3M');
    expect(normalizeAnalysisPeriod('6M')).toBe('6M');
    expect(normalizeAnalysisPeriod('12M')).toBe('1Y');
    expect(normalizeAnalysisResolution('1d')).toBe('1D');
    expect(ANALYSIS_PERIOD_LABELS['3M']).toBe('3 Months');
    expect(ANALYSIS_PERIOD_LABELS.CUSTOM).toBe('Custom');
  });

  it('parses an inclusive custom start/end window', () => {
    expect(parseAnalysisWindow({ startDate: '2026-01-01', endDate: '2026-09-17' })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-09-17',
    });
    expect(() => parseAnalysisWindow({ startDate: '2026-09-17', endDate: '2026-01-01' })).toThrow(
      /startDate must be on or before endDate/,
    );
    expect(() => parseAnalysisWindow(undefined)).toThrow(/startDate and endDate/);
  });

  it('builds a 180-day custom default and preset lookback windows', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    expect(defaultCustomAnalysisWindow(now)).toEqual({
      startDate: '2026-03-21',
      endDate: '2026-09-17',
    });
    expect(analysisWindowFromPeriod('6M', undefined, now)).toEqual({
      startDate: '2026-03-21',
      endDate: '2026-09-17',
    });
    expect(
      analysisWindowFromPeriod('CUSTOM', { startDate: '2026-01-01', endDate: '2026-09-17' }, now),
    ).toEqual({ startDate: '2026-01-01', endDate: '2026-09-17' });
  });
});
