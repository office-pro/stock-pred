import type { InstrumentRef, UniverseCatalogEntry } from '@stockpred/shared-types';
import {
  ANALYSIS_PERIOD_LABELS,
  analysisChecklist,
  buildMultiAssetBatchRequest,
  coverageStatusTone,
  cryptoHasNseLeak,
  defaultCustomAnalysisWindow,
  formatCoveragePct,
  frozenResultIdentity,
  lifecycleStageCopy,
  pickDefaultAnalysisPeriod,
  pickDefaultPredictionHorizon,
  renderUnavailable,
  validResultRows,
  wizardStageStates,
} from './multi-asset-batch';

const instrument: InstrumentRef = {
  symbol: 'RELIANCE',
  canonicalSymbol: 'RELIANCE',
  assetClass: 'EQUITY',
  venue: 'NSE',
  quoteCurrency: 'INR',
};

function universe(
  kind: UniverseCatalogEntry['kind'],
  universeId: UniverseCatalogEntry['universeId'],
): UniverseCatalogEntry {
  return {
    universeId,
    name: universeId,
    description: 'test',
    group: 'INDIA',
    kind,
    assetClass: 'EQUITY',
    venue: 'NSE',
    supported: true,
    requiresManualInstruments: kind === 'CUSTOM' || kind === 'SINGLE_STOCK',
  };
}

describe('Multi-Asset Batch request truthfulness', () => {
  it('never sends symbols or instruments for NSE_ALL', () => {
    expect(
      buildMultiAssetBatchRequest({
        universe: universe('PREDEFINED', 'NSE_ALL'),
        analysisPeriod: '6M',
        predictionHorizon: '1M',
        mode: 'HISTORICAL',
        instruments: [instrument],
      }),
    ).toEqual({
      universe: 'NSE_ALL',
      analysisPeriod: '6M',
      analysisTimeframe: '6M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
      mode: 'HISTORICAL',
    });
  });

  it('uses one canonical InstrumentRef for SINGLE_STOCK', () => {
    const request = buildMultiAssetBatchRequest({
      universe: universe('SINGLE_STOCK', 'SINGLE_STOCK'),
      analysisPeriod: '3M',
      predictionHorizon: '1M',
      mode: 'HISTORICAL',
      instruments: [instrument],
    });
    expect(request.instrument).toEqual(instrument);
    expect(request).not.toHaveProperty('instruments');
  });

  it('requires canonical identities for CUSTOM', () => {
    expect(() =>
      buildMultiAssetBatchRequest({
        universe: universe('CUSTOM', 'CUSTOM'),
        analysisPeriod: '3M',
        predictionHorizon: '1M',
        mode: 'HISTORICAL',
        instruments: [],
      }),
    ).toThrow('canonical InstrumentRefs');
  });

  it('sends an inclusive start/end window only for CUSTOM lookback', () => {
    expect(
      buildMultiAssetBatchRequest({
        universe: universe('PREDEFINED', 'NSE_ALL'),
        analysisPeriod: 'CUSTOM',
        analysisWindow: { startDate: '2026-01-01', endDate: '2026-09-17' },
        predictionHorizon: '1M',
        mode: 'HISTORICAL',
        instruments: [],
      }),
    ).toMatchObject({
      analysisPeriod: 'CUSTOM',
      analysisWindow: { startDate: '2026-01-01', endDate: '2026-09-17' },
      analysisResolution: '1D',
    });
    expect(() =>
      buildMultiAssetBatchRequest({
        universe: universe('PREDEFINED', 'NSE_ALL'),
        analysisPeriod: 'CUSTOM',
        predictionHorizon: '1M',
        mode: 'HISTORICAL',
        instruments: [],
      }),
    ).toThrow('startDate and endDate');
  });

  it('defaults analysis period to 3 Months and horizon to 1 Month', () => {
    expect(pickDefaultAnalysisPeriod(['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'])).toBe('3M');
    expect(pickDefaultPredictionHorizon([{ id: '1D' }, { id: '1M' }, { id: '3M' }])).toBe('1M');
    expect(ANALYSIS_PERIOD_LABELS['3M']).toBe('3 Months');
    expect(defaultCustomAnalysisWindow(new Date('2026-09-17T12:00:00Z'))).toEqual({
      startDate: '2026-03-21',
      endDate: '2026-09-17',
    });
  });

  it('renders missing values as Not available', () => {
    expect(renderUnavailable(null)).toBe('Not available');
    expect(renderUnavailable(undefined)).toBe('Not available');
    expect(renderUnavailable(0)).toBe('0');
  });

  it('renders backend lifecycle copy and never derives READY', () => {
    expect(lifecycleStageCopy('UNIVERSE_RESOLVED')).toBe('Resolving universe...');
    expect(lifecycleStageCopy('DATA_PREPARING')).toBe('Preparing data...');
    expect(lifecycleStageCopy('DATA_HYDRATING', 1850)).toBe('Hydrating 1,850 instruments...');
    expect(lifecycleStageCopy('DATA_VALIDATED')).toBe('Validating coverage...');
    expect(lifecycleStageCopy('RUNNING_INTELLIGENCE')).toBe(
      'Data ready — starting intelligence...',
    );
    expect(lifecycleStageCopy('RUNNING_INTELLIGENCE')).not.toMatch(/READY_PARTIAL|NOT_READY/);
  });

  it('uses frozen instrument identity and never prefixes NSE for crypto', () => {
    const identity = frozenResultIdentity({
      symbol: 'BTCUSDT',
      exchange: 'NSE',
      instrument: { symbol: 'ETHUSDT', venue: 'BINANCE', assetClass: 'CRYPTO_SPOT' },
      recommendation: 'APPROVE',
      reason: 'backend reason',
    });
    expect(identity).toMatchObject({
      symbol: 'ETHUSDT',
      venue: 'BINANCE',
      assetClass: 'CRYPTO_SPOT',
      recommendation: 'APPROVE',
      reason: 'backend reason',
    });
    expect(cryptoHasNseLeak(identity)).toBe(false);
    expect(
      cryptoHasNseLeak({ symbol: 'NSE:BTCUSDT', assetClass: 'CRYPTO_SPOT', venue: 'BINANCE' }),
    ).toBe(true);
    expect(cryptoHasNseLeak({ symbol: 'BTCUSDT', assetClass: 'CRYPTO_SPOT', venue: 'NSE' })).toBe(
      true,
    );
  });

  it('excludes quarantined rows from results and top opportunities', () => {
    expect(
      validResultRows([
        { symbol: 'ETHUSDT', quarantined: false },
        { symbol: 'LEAK', quarantined: true },
        { symbol: 'BAD', quarantineStatus: 'IDENTITY_MISMATCH' },
      ]).map((row) => row.symbol),
    ).toEqual(['ETHUSDT']);
  });

  it('keeps N/A, PENDING, and UNAVAILABLE distinct and does not invent percents', () => {
    expect(formatCoveragePct(null, 'N/A')).toBe('N/A');
    expect(formatCoveragePct(0.9, 'AVAILABLE')).toBe('90.0%');
    expect(coverageStatusTone('N/A')).toBe('default');
    expect(coverageStatusTone('PENDING')).toBe('info');
    expect(coverageStatusTone('UNAVAILABLE')).toBe('error');
    expect(coverageStatusTone('APPROVE')).toBe('success');
  });

  it('does not mark technical/fundamentals/sentiment complete from lifecycle alone', () => {
    const running = wizardStageStates('RUNNING_INTELLIGENCE', 'RUNNING', []);
    expect(running.find((row) => row.id === 'generate')?.state).toBe('active');
    expect(running.find((row) => row.id === 'technical')?.state).toBe('pending');
    expect(running.find((row) => row.id === 'fundamentals')?.state).toBe('pending');
    expect(running.find((row) => row.id === 'sentiment')?.state).toBe('pending');
    const covered = wizardStageStates('FINALIZING', 'COMPLETED', [
      {
        capability: 'fundamentals',
        status: 'UNAVAILABLE',
        eligible: 10,
        available: 0,
        partial: 0,
        unavailable: 10,
        na: 0,
        coveragePct: 0,
      },
      {
        capability: 'technical',
        status: 'AVAILABLE',
        eligible: 10,
        available: 10,
        partial: 0,
        unavailable: 0,
        na: 0,
        coveragePct: 1,
      },
      {
        capability: 'news',
        status: 'N/A',
        eligible: 0,
        available: 0,
        partial: 0,
        unavailable: 0,
        na: 10,
        coveragePct: null,
      },
    ]);
    expect(covered.find((row) => row.id === 'technical')?.state).toBe('complete');
    expect(covered.find((row) => row.id === 'fundamentals')?.state).toBe('unavailable');
    expect(covered.find((row) => row.id === 'sentiment')?.state).toBe('na');
  });

  it('leaves N/A and UNAVAILABLE checklist items unchecked', () => {
    const items = analysisChecklist({
      coverage: [
        {
          capability: 'marketData',
          status: 'AVAILABLE',
          eligible: 1,
          available: 1,
          partial: 0,
          unavailable: 0,
          na: 0,
          coveragePct: 1,
        },
        {
          capability: 'fundamentals',
          status: 'UNAVAILABLE',
          eligible: 1,
          available: 0,
          partial: 0,
          unavailable: 1,
          na: 0,
          coveragePct: 0,
        },
        {
          capability: 'derivatives',
          status: 'N/A',
          eligible: 0,
          available: 0,
          partial: 0,
          unavailable: 0,
          na: 1,
          coveragePct: null,
        },
      ],
    });
    expect(items.find((row) => row.label.startsWith('Market Data'))?.applicable).toBe(true);
    expect(items.find((row) => row.label.startsWith('Fundamental'))?.applicable).toBe(false);
    expect(items.find((row) => row.label.startsWith('Derivatives'))?.applicable).toBe(false);
  });
});
