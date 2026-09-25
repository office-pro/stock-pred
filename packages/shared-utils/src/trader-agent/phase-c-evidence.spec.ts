import type { InstrumentRef } from '@stockpred/shared-types';
import { hydrateBatchDataSnapshot } from './batch-data-hydrate';
import { attachBatchInstrumentToIntelligenceSnapshot } from './batch-data-snapshot';
import { defaultEvidenceFetchJson, shouldAttachPhaseCEvidence } from './batch-evidence-attach';
import { buildSnapshotCapabilityCoverage } from './snapshot-capability-coverage';
import {
  TD_CREDIT_EXHAUSTED,
  TwelveDataClient,
  TwelveDataCreditBudget,
} from './twelve-data-client';

function usEquity(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'EQUITY',
    venue: 'NASDAQ',
    quoteCurrency: 'USD',
    canonicalSymbol: symbol,
  };
}

function cryptoSpot(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'CRYPTO_SPOT',
    venue: 'BINANCE',
    quoteCurrency: 'USDT',
    canonicalSymbol: symbol,
    providerAssetId: symbol,
  };
}

function fx(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'FX',
    venue: 'OTC',
    quoteCurrency: 'USD',
    canonicalSymbol: symbol,
  };
}

const AAPL_OHLCV = {
  status: 'ok',
  values: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      datetime: d,
      open: String(100 + i),
      high: String(101 + i),
      low: String(99 + i),
      close: String(100.5 + i),
      volume: '1000',
    };
  }),
};

function evidenceFetch(url: string): Promise<unknown> {
  if (url.includes('/time_series')) return Promise.resolve(AAPL_OHLCV);
  if (url.includes('/press_releases')) {
    return Promise.resolve({
      status: 'ok',
      press_releases: [{ title: 'Apple Inc reports quarterly results' }],
    });
  }
  if (url.includes('company_tickers.json')) {
    return Promise.resolve({ '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
  }
  if (url.includes('companyfacts')) {
    return Promise.resolve({
      entityName: 'Apple Inc.',
      facts: {
        'us-gaap': {
          Revenues: { units: { USD: [{ val: 394328000000, end: '2024-09-28', form: '10-K' }] } },
          NetIncomeLoss: {
            units: { USD: [{ val: 93736000000, end: '2024-09-28', form: '10-K' }] },
          },
        },
      },
    });
  }
  if (url.includes('gdeltproject.org')) {
    return Promise.resolve({
      articles: [
        {
          title: 'Apple Inc guidance raised after iPhone beat',
          url: 'https://ex/a',
          seendate: '20240102T120000Z',
        },
        {
          title: 'Unrelated global markets wrap',
          url: 'https://ex/b',
          seendate: '20240102T120000Z',
        },
      ],
    });
  }
  if (url.includes('federalreserve.gov') || url.includes('h15')) {
    return Promise.resolve('<observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>');
  }
  if (url.includes('bls.gov')) {
    return Promise.resolve({
      Results: { series: [{ data: [{ year: '2024', period: 'M02', value: '310.5' }] }] },
    });
  }
  if (url.includes('treasury.gov') || url.includes('daily-treasury')) {
    return Promise.resolve('Date,10 Yr\n02/01/2024,4.22\n');
  }
  throw new Error(`unexpected evidence url ${url}`);
}

describe('Phase C evidence hydrate', () => {
  it('does not attach live evidence when tests mock quotes without an evidence injector', () => {
    expect(shouldAttachPhaseCEvidence({ twelveDataClient: {} })).toBe(false);
    expect(shouldAttachPhaseCEvidence({ fetchJson: async () => ({}) })).toBe(false);
    expect(shouldAttachPhaseCEvidence({ evidenceFetchJson: async () => ({}) })).toBe(true);
    expect(shouldAttachPhaseCEvidence({})).toBe(true);
  });
  it('attaches SEC statements, news, FinBERT, and batch macro before freeze', async () => {
    const ref = usEquity('AAPL');
    const urls: string[] = [];
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async (url) => {
        urls.push(url);
        expect(url).not.toMatch(/\/rsi|\/macd|\/adx/);
        return evidenceFetch(url);
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-us',
      universeId: 'US_ALL',
      instruments: [ref],
      deps: {
        twelveDataClient: client,
        evidenceFetchJson: async (url) => {
          urls.push(url);
          return evidenceFetch(url);
        },
        scoreHeadline: () => 0.12,
        concurrency: 1,
      },
    });
    expect(snapshot.frozen).toBe(true);
    expect(client.isFrozen).toBe(true);
    expect(snapshot.instruments[0]?.instrumentRef).toEqual(ref);
    expect(snapshot.instruments[0]?.fundamentals).toMatchObject({
      kind: 'EQUITY_STATEMENTS',
      revenue: 394328000000,
    });
    expect(snapshot.instruments[0]?.news?.source).toBe('SOURCE_REPORTED');
    expect(snapshot.instruments[0]?.news?.headlineCount).toBeGreaterThan(0);
    expect(snapshot.instruments[0]?.sentiment).toEqual({ source: 'MODEL_DERIVED', score: 0.12 });
    expect(snapshot.instruments[0]).not.toHaveProperty('macro');
    expect(snapshot.macro?.series.length).toBe(4);
    expect(snapshot.macro?.source).toBe('SOURCE_REPORTED');
    expect(urls.some((u) => u.includes('/time_series'))).toBe(true);
    expect(urls.some((u) => u.includes('/press_releases'))).toBe(true);
    expect(urls.some((u) => u.includes('/rsi'))).toBe(false);

    const coverage = snapshot.capabilityCoverage ?? buildSnapshotCapabilityCoverage(snapshot);
    expect(coverage.find((c) => c.capability === 'fundamentals')?.status).toBe('AVAILABLE');
    expect(coverage.find((c) => c.capability === 'news')?.status).toBe('AVAILABLE');
    expect(coverage.find((c) => c.capability === 'sentiment')?.status).toBe('AVAILABLE');
    const macro = coverage.find((c) => c.capability === 'macro');
    expect(macro?.eligible).toBe(1);
    expect(macro?.status).toBe('AVAILABLE');

    await expect(client.pressReleases('AAPL')).rejects.toMatchObject({
      name: 'TWELVE_DATA_FROZEN',
    });
  });

  it('never attaches equity statements to crypto or FX', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async (url) => {
        if (url.includes('/time_series')) {
          return {
            status: 'ok',
            values: [
              {
                datetime: '2024-01-02',
                open: '1',
                high: '2',
                low: '1',
                close: '1.5',
                volume: '10',
              },
            ],
          };
        }
        return { status: 'ok', press_releases: [] };
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-skip',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => {
          if (url.includes('/ticker/24hr')) {
            return [
              {
                symbol: 'BTCUSDT',
                lastPrice: '70000',
                priceChange: '1',
                priceChangePercent: '1',
                volume: '1',
                highPrice: '1',
                lowPrice: '1',
                prevClosePrice: '1',
              },
            ];
          }
          if (url.includes('/klines')) return [[1, '1', '1', '1', '1', '1']];
          return [];
        },
        twelveDataClient: client,
        evidenceFetchJson: async (url) => {
          if (url.includes('company_tickers') || url.includes('companyfacts')) {
            throw new Error('SEC must not run for crypto');
          }
          if (url.includes('gdelt')) return { articles: [] };
          if (url.includes('federalreserve.gov')) {
            return '<observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>';
          }
          if (url.includes('bls.gov') || url.includes('treasury.gov')) return {};
          return {};
        },
        scoreHeadline: () => null,
      },
    });
    const kind = snapshot.instruments[0]?.fundamentals?.kind;
    expect(kind === 'EQUITY_STATEMENTS').toBe(false);
    expect(snapshot.instruments[0]?.instrumentRef.symbol).toBe('BTCUSDT');
    expect(snapshot.instruments[0]?.sentiment).toBeNull();
    expect(snapshot.instruments[0]?.sentiment).not.toBe(0);
  });

  it('FX hydrate does not receive equity statements', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => ({
        status: 'ok',
        values: [{ datetime: '2024-01-02', open: '1', high: '1.1', low: '0.9', close: '1.05' }],
      }),
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-fx',
      universeId: 'FOREX_ALL',
      instruments: [fx('EUR/USD')],
      deps: {
        twelveDataClient: client,
        evidenceFetchJson: async (url) => {
          if (url.includes('companyfacts') || url.includes('company_tickers')) {
            throw new Error('SEC must not run for FX');
          }
          if (url.includes('gdelt')) return { articles: [] };
          if (
            url.includes('federalreserve.gov') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          )
            return '';
          return {};
        },
      },
    });
    expect(snapshot.instruments[0]?.fundamentals?.kind === 'EQUITY_STATEMENTS').toBe(false);
  });

  it('missing FinBERT is null, never numeric 0 or NEUTRAL; real near-zero stays MODEL_DERIVED', async () => {
    const missingClient = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => AAPL_OHLCV,
    });
    const missing = await hydrateBatchDataSnapshot({
      batchId: 'c-sent-miss',
      universeId: 'US_ALL',
      instruments: [usEquity('AAPL')],
      deps: {
        twelveDataClient: missingClient,
        evidenceFetchJson: async (url) => {
          if (url.includes('company_tickers.json')) {
            return { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } };
          }
          if (url.includes('companyfacts')) return { facts: { 'us-gaap': {} } };
          if (url.includes('gdelt')) {
            return {
              articles: [
                { title: 'Apple Inc guidance', url: 'https://ex', seendate: '20240102T120000Z' },
              ],
            };
          }
          if (
            url.includes('federalreserve.gov') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          )
            return '';
          return {};
        },
      },
    });
    expect(missing.snapshot.instruments[0]?.sentiment).toBeNull();
    expect(missing.snapshot.instruments[0]?.sentiment).not.toBe(0);
    expect(JSON.stringify(missing.snapshot.instruments[0]?.sentiment)).not.toContain('NEUTRAL');

    const zeroClient = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => AAPL_OHLCV,
    });
    const nearZero = await hydrateBatchDataSnapshot({
      batchId: 'c-sent-zero',
      universeId: 'US_ALL',
      instruments: [usEquity('AAPL')],
      deps: {
        twelveDataClient: zeroClient,
        evidenceFetchJson: async (url) => {
          if (url.includes('company_tickers.json')) {
            return { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } };
          }
          if (url.includes('companyfacts')) return { facts: { 'us-gaap': {} } };
          if (url.includes('gdelt')) {
            return {
              articles: [
                { title: 'Apple Inc guidance', url: 'https://ex', seendate: '20240102T120000Z' },
              ],
            };
          }
          if (
            url.includes('federalreserve.gov') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          )
            return '';
          return {};
        },
        scoreHeadline: () => 0,
      },
    });
    expect(nearZero.snapshot.instruments[0]?.sentiment).toEqual({
      source: 'MODEL_DERIVED',
      score: 0,
    });
  });

  it('unmatched GDELT is dropped and news stays UNAVAILABLE without a fabricated headline', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async (url) => {
        if (url.includes('/press_releases')) return { status: 'ok', press_releases: [] };
        return AAPL_OHLCV;
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-gdelt',
      universeId: 'US_ALL',
      instruments: [usEquity('AAPL')],
      deps: {
        twelveDataClient: client,
        evidenceFetchJson: async (url) => {
          if (url.includes('company_tickers.json')) return {};
          if (url.includes('gdelt')) {
            return { articles: [{ title: 'Unrelated global markets wrap', url: 'https://ex/b' }] };
          }
          if (
            url.includes('federalreserve.gov') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          )
            return '';
          return {};
        },
        scoreHeadline: () => 0.5,
      },
    });
    expect(snapshot.instruments[0]?.news?.headlineCount ?? 0).toBe(0);
    expect(snapshot.instruments[0]?.news?.reasonCode).toBe('GDELT_UNMATCHED');
    expect(snapshot.instruments[0]?.sentiment).toBeNull();
  });

  it('press_releases leftover exhaust marks remaining news TD_CREDIT_EXHAUSTED', async () => {
    const refs = [usEquity('AAPL'), usEquity('MSFT')];
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(3),
      fetchJson: async (url) => {
        if (url.includes('/press_releases'))
          return { status: 'ok', press_releases: [{ title: 'Apple Inc beat' }] };
        return {
          status: 'ok',
          values: [
            { datetime: '2024-01-02', open: '1', high: '2', low: '1', close: '1.5', volume: '10' },
          ],
        };
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-budget',
      universeId: 'US_ALL',
      instruments: refs,
      deps: {
        twelveDataClient: client,
        concurrency: 1,
        evidenceFetchJson: async (url) => {
          if (url.includes('gdelt')) return { articles: [] };
          if (
            url.includes('federalreserve.gov') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          )
            return '';
          if (url.includes('company_tickers')) return {};
          return {};
        },
      },
    });
    const newsReasons = snapshot.instruments.map((row) => row.news?.reasonCode);
    expect(newsReasons).toContain(TD_CREDIT_EXHAUSTED);
  });

  it('macro coverage is batch-level from snapshot.macro, not per-row CPI', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => AAPL_OHLCV,
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-macro',
      universeId: 'US_ALL',
      instruments: [usEquity('AAPL'), usEquity('MSFT')],
      deps: {
        twelveDataClient: client,
        evidenceFetchJson: async (url) => {
          if (url.includes('federalreserve.gov')) return 'DATE,FEDFUNDS\n2024-02-01,5.33\n';
          if (
            url.includes('gdelt') ||
            url.includes('company_tickers') ||
            url.includes('bls.gov') ||
            url.includes('treasury.gov')
          ) {
            return {};
          }
          return {};
        },
      },
    });
    expect(snapshot.macro).toBeDefined();
    expect(
      snapshot.instruments.every(
        (row) => !('macro' in row) || (row as { macro?: unknown }).macro == null,
      ),
    ).toBe(true);
    const macro = (snapshot.capabilityCoverage ?? []).find((c) => c.capability === 'macro');
    expect(macro?.eligible).toBe(1);
    expect(macro?.status).toBe('PARTIAL');
  });

  it('observe-only attach copies news/sentiment/macro and does not invent missing sentiment', () => {
    const intel = attachBatchInstrumentToIntelligenceSnapshot(
      {
        schemaVersion: 'intelligence.v1',
        engineVersion: 'test',
        generatedAt: 't',
        sourceDataTimestamp: 't',
        marketContext: { asOf: 't' } as never,
      },
      {
        instrumentRef: usEquity('AAPL'),
        dataStatus: 'AVAILABLE',
        news: { source: 'SOURCE_REPORTED', headlineCount: 2, asOf: 1 },
        sentiment: { source: 'MODEL_DERIVED', score: 0 },
      },
      {
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
              provider: 'fed',
            },
          ],
        },
      },
    );
    expect(intel.news?.headlineCount).toBe(2);
    expect(intel.sentiment).toEqual({ source: 'MODEL_DERIVED', score: 0 });
    expect(intel.macro?.seriesId).toBe('FEDFUNDS');
    expect(intel.macro?.series?.length).toBe(1);
    expect(intel.macro?.requestedCount).toBe(3);
  });

  it('returns the original intelligence snapshot when the batch row is missing', () => {
    const base = {
      schemaVersion: 'intelligence.v1',
      engineVersion: 'test',
      generatedAt: 't',
      sourceDataTimestamp: 't',
      marketContext: { asOf: 't' } as never,
    };
    expect(attachBatchInstrumentToIntelligenceSnapshot(base as never, undefined)).toBe(base);
  });

  it('keeps injected macro and records SEC fetch failure as UNAVAILABLE', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => AAPL_OHLCV,
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'c-sec-fail',
      universeId: 'US_ALL',
      instruments: [usEquity('AAPL')],
      deps: {
        twelveDataClient: client,
        scoreHeadline: async () => null,
        macroSnapshot: {
          source: 'SOURCE_REPORTED',
          requestedCount: 3,
          requestedSeries: ['FEDFUNDS', 'CPIAUCSL', 'CUUR0000SA0'],
          series: [
            {
              seriesId: 'FEDFUNDS',
              value: 5.33,
              asOf: 1,
              source: 'SOURCE_REPORTED',
              provider: 'fed',
            },
          ],
        },
        evidenceFetchJson: async (url) => {
          if (url.includes('company_tickers') || url.includes('companyfacts')) {
            throw new Error('sec down');
          }
          if (url.includes('gdelt')) return { articles: [] };
          throw new Error(`unexpected ${url}`);
        },
      },
    });
    expect(snapshot.instruments[0]?.fundamentals).toMatchObject({
      kind: 'UNAVAILABLE',
      reasonCode: 'SEC_FACTS_UNAVAILABLE',
    });
    expect(snapshot.macro?.series[0]?.seriesId).toBe('FEDFUNDS');
    expect(snapshot.instruments[0]?.news?.reasonCode).toBe('GDELT_UNMATCHED');
  });

  it('defaultEvidenceFetchJson reads Fed/Treasury text and JSON objects; FRED is excluded', async () => {
    const orig = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '<observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>',
      json: async () => ({ articles: [] }),
    })) as unknown as typeof fetch;
    try {
      await expect(
        defaultEvidenceFetchJson('https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS'),
      ).rejects.toThrow(/FRED_EXCLUDED/);
      await expect(
        defaultEvidenceFetchJson('https://www.federalreserve.gov/releases/h15/h15.xml'),
      ).resolves.toContain('5.33');
      await expect(
        defaultEvidenceFetchJson('https://api.gdeltproject.org/api/v2/doc/doc'),
      ).resolves.toEqual({
        articles: [],
      });
    } finally {
      global.fetch = orig;
    }
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    try {
      await expect(defaultEvidenceFetchJson('https://example.test/x')).rejects.toThrow(/HTTP 404/);
    } finally {
      global.fetch = orig;
    }
  });
});
