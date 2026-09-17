import type {
  BatchDataSnapshot,
  BatchInstrumentData,
  InstrumentRef,
} from '@stockpred/shared-types';
import { BATCH_DATA_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import { buildSnapshotCapabilityCoverage } from './snapshot-capability-coverage';

function cryptoSpot(): InstrumentRef {
  return {
    symbol: 'BTCUSDT',
    assetClass: 'CRYPTO_SPOT',
    venue: 'BINANCE',
    quoteCurrency: 'USDT',
    canonicalSymbol: 'BTCUSDT',
    providerAssetId: 'BTCUSDT',
  };
}

function nseEquity(): InstrumentRef {
  return {
    symbol: 'RELIANCE',
    assetClass: 'EQUITY',
    venue: 'NSE',
    quoteCurrency: 'INR',
    canonicalSymbol: 'RELIANCE',
  };
}

function snapshot(instruments: BatchInstrumentData[]): BatchDataSnapshot {
  return {
    schemaVersion: BATCH_DATA_SNAPSHOT_VERSION,
    batchId: 'cov',
    universeId: 'CRYPTO_SPOT_ALL',
    provider: 'binance-spot',
    providerSelectionReason: 'test',
    instruments,
    dataAsOf: 1,
    createdAt: 1,
    coverage: {
      readiness: 'READY',
      eligible: instruments.length || 761,
      processed: instruments.length,
      available: instruments.length,
      partial: 0,
      unavailable: 0,
      failed: 0,
      pending: 0,
      marketDataAvailable: instruments.length,
      historicalAvailable: 0,
      derivativesAvailable: 0,
      requiredCapabilities: ['marketData'],
      coveragePct: 100,
      minRequiredCoveragePct: 50,
      reasons: [],
    },
    freshnessPolicyVersion: 'v1',
    dataSnapshotVersion: BATCH_DATA_SNAPSHOT_VERSION,
    frozen: true,
  };
}

describe('snapshot-owned capability coverage', () => {
  it('marks crypto-spot derivatives N/A with na and coveragePct null', () => {
    const coverage = buildSnapshotCapabilityCoverage(
      snapshot([
        {
          instrumentRef: cryptoSpot(),
          quote: { price: 70000 },
          candles: Array.from({ length: 30 }, (_, i) => ({
            time: i,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
          })),
          dataStatus: 'AVAILABLE',
        },
      ]),
    );
    const derivatives = coverage.find((row) => row.capability === 'derivatives');
    expect(derivatives?.status).toBe('N/A');
    expect(derivatives?.na).toBeGreaterThan(0);
    expect(derivatives?.eligible).toBe(0);
    expect(derivatives?.available).toBe(0);
    expect(derivatives?.partial).toBe(0);
    expect(derivatives?.unavailable).toBe(0);
    expect(derivatives?.coveragePct).toBeNull();
    expect(derivatives?.reason).toBe('SPOT_ASSET');
    expect(coverage.some((row) => row.capability === 'paperTrading')).toBe(false);
  });

  it('computes applicable coveragePct from available+partial over eligible', () => {
    const coverage = buildSnapshotCapabilityCoverage(
      snapshot([
        {
          instrumentRef: cryptoSpot(),
          quote: { price: 70000 },
          candles: Array.from({ length: 30 }, (_, i) => ({
            time: i,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
          })),
          dataStatus: 'AVAILABLE',
        },
      ]),
    );
    const market = coverage.find((row) => row.capability === 'marketData');
    expect(market?.status).toBe('AVAILABLE');
    expect(market?.coveragePct).toBe(1);
    expect(market?.eligible).toBe(1);
  });

  it('does not treat NSE equity fundamentals as N/A', () => {
    const coverage = buildSnapshotCapabilityCoverage({
      ...snapshot([
        {
          instrumentRef: nseEquity(),
          quote: { price: 2500 },
          dataStatus: 'AVAILABLE',
        },
      ]),
      coverage: {
        readiness: 'READY_PARTIAL',
        eligible: 1,
        processed: 1,
        available: 1,
        partial: 0,
        unavailable: 0,
        failed: 0,
        pending: 0,
        marketDataAvailable: 1,
        historicalAvailable: 0,
        derivativesAvailable: 0,
        requiredCapabilities: ['marketData'],
        coveragePct: 100,
        minRequiredCoveragePct: 50,
        reasons: [],
      },
    });
    const fundamentals = coverage.find((row) => row.capability === 'fundamentals');
    expect(fundamentals?.status).not.toBe('N/A');
    expect(fundamentals?.coveragePct).not.toBeNull();
  });

  it('reads news and sentiment from instrument fields; 0 is a real score', () => {
    const withNews = snapshot([
      {
        instrumentRef: cryptoSpot(),
        quote: { price: 1 },
        dataStatus: 'AVAILABLE',
        news: { source: 'SOURCE_REPORTED', headlineCount: 3, asOf: 1 },
        sentiment: { source: 'MODEL_DERIVED', score: 0 },
      },
    ]);
    const coverage = buildSnapshotCapabilityCoverage(withNews);
    expect(coverage.find((row) => row.capability === 'news')?.status).toBe('AVAILABLE');
    expect(coverage.find((row) => row.capability === 'sentiment')?.status).toBe('AVAILABLE');

    const missing = snapshot([
      {
        instrumentRef: cryptoSpot(),
        quote: { price: 1 },
        dataStatus: 'AVAILABLE',
        news: { source: 'SOURCE_REPORTED', headlineCount: 0, reasonCode: 'NO_NEWS' },
        sentiment: null,
      },
    ]);
    const missingCov = buildSnapshotCapabilityCoverage(missing);
    expect(missingCov.find((row) => row.capability === 'news')?.status).toBe('UNAVAILABLE');
    expect(missingCov.find((row) => row.capability === 'sentiment')?.status).toBe('UNAVAILABLE');
  });

  it('rolls macro coverage from snapshot.macro once, not per instrument', () => {
    const two = snapshot([
      {
        instrumentRef: cryptoSpot(),
        quote: { price: 1 },
        dataStatus: 'AVAILABLE',
      },
      {
        instrumentRef: nseEquity(),
        quote: { price: 2 },
        dataStatus: 'AVAILABLE',
      },
    ]);
    const none = buildSnapshotCapabilityCoverage(two).find((row) => row.capability === 'macro');
    expect(none?.eligible).toBe(1);
    expect(none?.status).toBe('UNAVAILABLE');
    expect(none?.unavailable).toBe(1);

    const partial = buildSnapshotCapabilityCoverage({
      ...two,
      macro: {
        source: 'SOURCE_REPORTED',
        requestedCount: 3,
        requestedSeries: ['FEDFUNDS', 'CPIAUCSL', 'CUUR0000SA0'],
        series: [
          {
            seriesId: 'FEDFUNDS',
            value: 5.33,
            asOf: 1,
            source: 'SOURCE_REPORTED',
            provider: 'fred',
          },
        ],
      },
    }).find((row) => row.capability === 'macro');
    expect(partial?.eligible).toBe(1);
    expect(partial?.status).toBe('PARTIAL');
    expect(partial?.partial).toBe(1);
    expect(partial?.available).toBe(0);
  });
});
