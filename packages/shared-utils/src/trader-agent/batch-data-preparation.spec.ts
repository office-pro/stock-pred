/**
 * Locked Multi-Asset Batch data-preparation contract.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { InstrumentRef } from '@stockpred/shared-types';
import { sanitizeFundamentalPayload } from '@stockpred/shared-types';
import {
  attachBatchInstrumentToIntelligenceSnapshot,
  buildIntelligenceSnapshot,
  computeBatchDataReadiness,
  CryptoFuturesAdapter,
  evaluateRisk,
  evaluateTrade,
  hydrateBatchDataSnapshot,
  quotesMapFromSnapshot,
  resolveIntelligenceUniverse,
  selectBatchProvider,
  universeForcesNotReady,
} from './index';
import {
  TD_CREDIT_EXHAUSTED,
  TwelveDataClient,
  TwelveDataCreditBudget,
} from './twelve-data-client';

function cryptoFuture(symbol: string): InstrumentRef {
  return new CryptoFuturesAdapter().resolveInstrument(symbol);
}

function cryptoSpot(symbol: string, venue: 'BINANCE' | 'COINGECKO' = 'BINANCE'): InstrumentRef {
  return {
    symbol,
    assetClass: 'CRYPTO_SPOT',
    venue,
    quoteCurrency: 'USDT',
    canonicalSymbol: symbol,
    providerAssetId: venue === 'COINGECKO' ? symbol.toLowerCase() : symbol,
  };
}

function commodity(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'COMMODITY',
    venue: 'ALPHA_VANTAGE',
    quoteCurrency: 'USD',
    canonicalSymbol: symbol,
    providerAssetId: symbol,
    contractType: 'PRODUCT',
  };
}

function binanceFuturesFetch(
  url: string,
  prices: Record<string, string> = { BTCUSDT: '70000' },
): unknown {
  const last = (symbol: string) => prices[symbol] ?? prices[symbol.replace('USDT', 'USDT')];
  if (url.includes('/ticker/24hr')) {
    return Object.entries(prices).map(([symbol, lastPrice]) => ({
      symbol,
      lastPrice,
      priceChange: '100',
      priceChangePercent: '1.4',
      volume: '10',
      highPrice: lastPrice,
      lowPrice: lastPrice,
      prevClosePrice: lastPrice,
    }));
  }
  if (url.includes('/premiumIndex')) {
    return Object.entries(prices).map(([symbol, lastPrice]) => ({
      symbol,
      markPrice: lastPrice,
      indexPrice: String(Number(lastPrice) - 10),
      lastFundingRate: '0.0001',
    }));
  }
  if (url.includes('/openInterest')) {
    const symbol = new URL(url).searchParams.get('symbol') ?? 'BTCUSDT';
    if (last(symbol) == null) return {};
    return { symbol, openInterest: '12345' };
  }
  if (url.includes('/fundingRate')) {
    return [{ fundingRate: '0.0001' }];
  }
  if (url.includes('/klines')) {
    return [[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']];
  }
  return {};
}

describe('Batch data preparation contract', () => {
  it('membership missing → NOT_READY, no invented list', async () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'CRYPTO_ALL' })).toThrow(
      /NOT_READY|UNSUPPORTED_UNIVERSE/,
    );
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'b-empty',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments: [],
      eligible: 0,
      deps: { fetchJson: async () => [] },
    });
    expect(snapshot.instruments).toEqual([]);
    expect(report.readiness).toBe('NOT_READY');
    expect(report.reasons.some((r) => r.includes('MEMBERSHIP_SNAPSHOT_MISSING'))).toBe(true);
  });

  it('empty MDS still hydrates crypto futures from mocked HTTP and freezes snapshot', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-fut',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments: [cryptoFuture('BTCUSDT:PERPETUAL')],
      deps: {
        fetchJson: async (url) => binanceFuturesFetch(url),
      },
    });
    expect(snapshot.frozen).toBe(true);
    expect(snapshot.instruments[0]?.quote?.price).toBe(70000);
    expect(snapshot.instruments[0]?.derivatives?.openInterest).toBe(12345);
    expect(snapshot.instruments[0]?.derivatives?.basis).toBe(10);
    expect(snapshot.instruments[0]?.derivatives?.sourceInstrument).toBe('BINANCE_FUTURES:BTCUSDT');
    expect(snapshot.instruments[0]?.derivatives?.contractType).toBe('PERPETUAL');
    expect(quotesMapFromSnapshot(snapshot).get('BTCUSDT')?.price).toBe(70000);
    expect(quotesMapFromSnapshot(snapshot).get('BTCUSDT')?.exchange).not.toBe('NSE');
    expect(quotesMapFromSnapshot(snapshot).get('BTCUSDT')?.venue).toBe('BINANCE');
  });

  it('worker does not fetch after freeze; later mock price is ignored', async () => {
    let price = '70000';
    const fetchJson = jest.fn(async (url: string) => binanceFuturesFetch(url, { BTCUSDT: price }));
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-freeze',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments: [cryptoFuture('BTCUSDT')],
      deps: { fetchJson },
    });
    const callsAfterFreeze = fetchJson.mock.calls.length;
    price = '99999';
    expect(snapshot.instruments[0]?.quote?.price).toBe(70000);
    expect(quotesMapFromSnapshot(snapshot).get('BTCUSDT')?.price).toBe(70000);
    expect(fetchJson.mock.calls.length).toBe(callsAfterFreeze);
  });

  it('eligible denominator stays 850 when 5 fail hydrate', async () => {
    const instruments = Array.from({ length: 850 }, (_, i) => cryptoFuture(`S${i}USDT`));
    const prices: Record<string, string> = {};
    for (let i = 0; i < 845; i += 1) prices[`S${i}USDT`] = '100';
    const { report } = await hydrateBatchDataSnapshot({
      batchId: 'b-denom',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments,
      eligible: 850,
      deps: {
        fetchJson: async (url) => binanceFuturesFetch(url, prices),
        concurrency: 50,
      },
    });
    expect(report.eligible).toBe(850);
    expect(report.available).toBe(845);
    expect(report.unavailable).toBe(5);
    expect(report.readiness).toBe('READY_PARTIAL');
  });

  it('below BATCH_MIN_REQUIRED_COVERAGE_PCT → NOT_READY (no silent 20/850 report)', async () => {
    const instruments = Array.from({ length: 850 }, (_, i) => cryptoFuture(`S${i}USDT`));
    const prices: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) prices[`S${i}USDT`] = '100';
    const { report } = await hydrateBatchDataSnapshot({
      batchId: 'b-low',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments,
      eligible: 850,
      deps: {
        fetchJson: async (url) => binanceFuturesFetch(url, prices),
        concurrency: 50,
      },
    });
    expect(report.eligible).toBe(850);
    expect(report.available).toBe(20);
    expect(report.readiness).toBe('NOT_READY');
    expect(report.coveragePct).toBeCloseTo((20 / 850) * 100);
  });

  it('never hydrates CoinGecko HTTP or joins Binance from a CoinGecko venue', async () => {
    const fetchJson = jest.fn(async (url: string) => {
      if (url.includes('coingecko')) throw new Error('COINGECKO_EXCLUDED');
      if (url.includes('binance')) {
        return [{ symbol: 'BTCUSDT', lastPrice: '70000' }];
      }
      return {};
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-join',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('bitcoin', 'COINGECKO')],
      deps: { fetchJson },
    });
    expect(
      selectBatchProvider('CRYPTO_SPOT_ALL', [cryptoSpot('bitcoin', 'COINGECKO')]).provider,
    ).toBe('binance-spot');
    expect(snapshot.provider).toBe('binance-spot');
    expect(snapshot.instruments[0]?.reasonCode).toBe('PROVIDER_MISMATCH');
    expect(snapshot.instruments[0]?.quote?.price).toBeUndefined();
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('coingecko'))).toBe(false);
  });

  it('CRYPTO_SPOT_ALL quotes keep BINANCE venue and never stamp NSE', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-spot-id',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => {
          if (url.includes('/ticker/24hr')) {
            return [
              {
                symbol: 'BTCUSDT',
                lastPrice: '70000',
                priceChange: '100',
                priceChangePercent: '1.4',
                volume: '10',
                highPrice: '70000',
                lowPrice: '69000',
                prevClosePrice: '69900',
              },
            ];
          }
          if (url.includes('/klines')) {
            return [[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']];
          }
          return {};
        },
      },
    });
    const quote = quotesMapFromSnapshot(snapshot).get('BTCUSDT');
    expect(quote?.venue).toBe('BINANCE');
    expect(quote?.exchange).toBe('BINANCE');
    expect(snapshot.instruments.filter((row) => row.instrumentRef.venue === 'NSE')).toHaveLength(0);
    expect(snapshot.identityCounts?.quarantined).toBe(0);
  });

  it('missing OI → UNAVAILABLE/MISSING_INPUT, not oi: 0', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-oi',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments: [cryptoFuture('BTCUSDT')],
      deps: {
        fetchJson: async (url) => {
          if (url.includes('openInterest')) return {};
          return binanceFuturesFetch(url);
        },
      },
    });
    const row = snapshot.instruments[0]!;
    expect(row.derivatives?.openInterest).toBeUndefined();
    expect(row.derivatives).not.toEqual(expect.objectContaining({ openInterest: 0 }));
    expect(row.reasonCode).toBe('MISSING_INPUT');
    expect(row.dataStatus).toBe('PARTIAL');
  });

  it('rejects EQUITY_STATEMENTS on CRYPTO_FUTURE', () => {
    const payload = sanitizeFundamentalPayload('CRYPTO_FUTURE', {
      kind: 'EQUITY_STATEMENTS',
      pe: 12,
    });
    expect(payload).toEqual({
      kind: 'UNAVAILABLE',
      reasonCode: 'ASSET_CLASS_MISMATCH',
      message: expect.stringContaining('CRYPTO_FUTURE'),
    });
  });

  it('commodity without keyless series is UNAVAILABLE; universe may be READY_PARTIAL', async () => {
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'b-com',
      universeId: 'COMMODITY_ALL',
      instruments: [commodity('WTI'), commodity('ALUMINUM')],
      eligible: 2,
      deps: {
        fetchJson: async (url) => {
          if (url.includes('CL=F')) {
            return {
              chart: {
                result: [
                  {
                    timestamp: [1_700_000_000],
                    meta: { regularMarketPrice: 73.2 },
                    indicators: {
                      quote: [{ open: [73], high: [74], low: [72], close: [73.2], volume: [1] }],
                    },
                  },
                ],
              },
            };
          }
          throw new Error('no series');
        },
        eiaSeries: {
          'PET.RWTC.D': [{ t: 1_700_000_000_000, v: 73.1 }],
        },
      },
    });
    expect(snapshot.instruments.find((r) => r.instrumentRef.symbol === 'WTI')?.dataStatus).toBe(
      'AVAILABLE',
    );
    expect(
      snapshot.instruments.find((r) => r.instrumentRef.symbol === 'ALUMINUM')?.dataStatus,
    ).toBe('UNAVAILABLE');
    expect(
      snapshot.instruments.find((r) => r.instrumentRef.symbol === 'ALUMINUM')?.reasonCode,
    ).toBe('NO_PROVIDER_DATA');
    expect(report.readiness).toBe('READY_PARTIAL');
    expect(report.eligible).toBe(2);
  });

  it('MCX_FUTURES_ALL / CME_FUTURES_ALL → NOT_READY, no scrape', async () => {
    expect(universeForcesNotReady('MCX_FUTURES_ALL')).toBe('MCX_FUTURES_NO_APPROVED_FEED');
    expect(universeForcesNotReady('CME_FUTURES_ALL')).toBe('CME_FUTURES_NO_APPROVED_FEED');
    const fetchJson = jest.fn(async () => {
      throw new Error('should not scrape');
    });
    const { report } = await hydrateBatchDataSnapshot({
      batchId: 'b-mcx',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [
        {
          symbol: 'GOLD26',
          assetClass: 'COMMODITY_FUTURE',
          venue: 'MCX',
          quoteCurrency: 'INR',
        },
      ],
      deps: { fetchJson, env: {} },
    });
    expect(report.readiness).toBe('NOT_READY');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('FUTURES_ALL stays GENERIC_FUTURES_UNSUPPORTED', async () => {
    expect(universeForcesNotReady('FUTURES_ALL')).toBe('GENERIC_FUTURES_UNSUPPORTED');
    expect(selectBatchProvider('FUTURES_ALL', []).reason).toBe('GENERIC_FUTURES_UNSUPPORTED');
    const fetchJson = jest.fn(async () => {
      throw new Error('should not fetch generic futures');
    });
    const fetchText = jest.fn(async () => {
      throw new Error('should not fetch generic futures');
    });
    const { report, snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-fut-all',
      universeId: 'FUTURES_ALL',
      instruments: [
        {
          symbol: 'ES',
          assetClass: 'INDEX_FUTURE',
          venue: 'CME',
          quoteCurrency: 'USD',
        },
      ],
      deps: { fetchJson, fetchText, env: {} },
    });
    expect(report.readiness).toBe('NOT_READY');
    expect(report.reasons).toContain('GENERIC_FUTURES_UNSUPPORTED');
    expect(snapshot.instruments[0]?.reasonCode).toBe('GENERIC_FUTURES_UNSUPPORTED');
    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('crypto futures bullRun stays UNAVAILABLE after klines+OI', async () => {
    await hydrateBatchDataSnapshot({
      batchId: 'b-br',
      universeId: 'CRYPTO_FUTURES_ALL',
      instruments: [cryptoFuture('BTCUSDT')],
      deps: { fetchJson: async (url) => binanceFuturesFetch(url) },
    });
    expect(new CryptoFuturesAdapter().capabilities().bullRun).toBe('UNAVAILABLE');
    expect(new CryptoFuturesAdapter().capabilities().derivatives).toBe('PARTIAL');
    expect(new CryptoFuturesAdapter().capabilities().positioning).toBe('UNAVAILABLE');
  });

  it('no Twelve Data indicator APIs; freeze holds after hydrate', () => {
    const clientSrc = readFileSync(join(__dirname, 'twelve-data-client.ts'), 'utf8');
    expect(clientSrc).not.toMatch(/['"`]\/(rsi|ema|macd|atr|adx|bbands|vwap|sma)\b/);
    const hydrate = readFileSync(join(__dirname, 'batch-data-hydrate.ts'), 'utf8');
    expect(hydrate).not.toMatch(/ALPHAVANTAGE_API_KEY|ALPHA_VANTAGE_API_KEY/);
    expect(hydrate).toMatch(/tdClient\.freeze\(\)|client\.freeze\(\)/);
  });

  it('coverage example keeps denominator 1000', () => {
    const report = computeBatchDataReadiness({
      instruments: [
        ...Array.from({ length: 900 }, (_, i) => ({
          instrumentRef: cryptoFuture(`A${i}`),
          dataStatus: 'AVAILABLE' as const,
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          instrumentRef: cryptoFuture(`P${i}`),
          dataStatus: 'PARTIAL' as const,
        })),
        ...Array.from({ length: 70 }, (_, i) => ({
          instrumentRef: cryptoFuture(`U${i}`),
          dataStatus: 'UNAVAILABLE' as const,
        })),
      ],
      eligible: 1000,
      requiredCapabilities: ['marketData'],
    });
    expect(report.eligible).toBe(1000);
    expect(report.available).toBe(900);
    expect(report.partial).toBe(20);
    expect(report.unavailable).toBe(70);
    expect(report.readiness).toBe('READY_PARTIAL');
  });
});

describe('Batch snapshot isolation from auth', () => {
  it('Risk is unchanged when IntelligenceSnapshot carries derivatives', () => {
    const analysis = {
      symbol: 'BTCUSDT',
      currentPrice: 70000,
      decision: 'BUY',
      scores: {
        fundamental: 70,
        technical: 80,
        sentiment: 60,
        quant: 65,
        macro: 55,
        sector: 60,
        risk: 70,
        overall: 78,
      },
      setup: {
        instrument: 'BTCUSDT',
        direction: 'LONG',
        entry: 70000,
        stopLoss: 69000,
        target1: 72000,
        target2: null,
        target3: null,
        riskReward: 2,
        positionSize: 1,
        expectedHoldingPeriod: '1-5d',
        confidence: 78,
        invalidation: 'Close below stop',
      },
      marketRegime: 'RISK_ON',
      thesis: 'Perp basis',
      counterThesis: 'Funding squeeze',
      invalidation: 'Close below stop',
      risks: [],
      action: 'Propose long',
      usedCapabilities: ['quotes'],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: Date.now(),
      disclaimer: 'test',
    } as const;
    const decision = evaluateTrade({ analysis: analysis as never });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const snap = attachBatchInstrumentToIntelligenceSnapshot(
      buildIntelligenceSnapshot({ analysis: analysis as never, decision }),
      {
        instrumentRef: cryptoFuture('BTCUSDT'),
        dataStatus: 'AVAILABLE',
        derivatives: {
          markPrice: 70010,
          indexPrice: 70000,
          openInterest: 12345,
          lastFundingRate: 0.0001,
          basis: 10,
          source: 'ENGINE_DERIVED',
        },
      },
    );
    expect(snap.derivatives?.openInterest).toBe(12345);
    expect(evaluateRisk(riskInput)).toEqual(riskA);
  });

  it('Twelve Data US hydrate keeps frozen InstrumentRef and local ENGINE_DERIVED technicals', async () => {
    const ref: InstrumentRef = {
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      venue: 'NASDAQ',
      quoteCurrency: 'USD',
      canonicalSymbol: 'AAPL',
    };
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async (url) => {
        expect(url).toContain('/time_series');
        expect(url).toContain('symbol=AAPL');
        expect(url).not.toMatch(/\/rsi|\/macd|\/adx/);
        return {
          status: 'ok',
          values: Array.from({ length: 40 }, (_, i) => {
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
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-td-us',
      universeId: 'US_ALL',
      instruments: [ref],
      deps: { twelveDataClient: client },
    });
    expect(snapshot.provider).toBe('twelve-data');
    expect(snapshot.frozen).toBe(true);
    expect(client.isFrozen).toBe(true);
    expect(snapshot.instruments[0]?.instrumentRef).toEqual(ref);
    expect(snapshot.instruments[0]?.technicals?.source).toBe('ENGINE_DERIVED');
    expect(snapshot.instruments[0]?.technicals?.rsi).toEqual(expect.any(Number));
    await expect(client.timeSeries('AAPL')).rejects.toMatchObject({ name: 'TWELVE_DATA_FROZEN' });
  });

  it('Twelve Data credit exhaust marks remaining rows TD_CREDIT_EXHAUSTED', async () => {
    const refs: InstrumentRef[] = ['AAPL', 'MSFT'].map((symbol) => ({
      symbol,
      assetClass: 'EQUITY',
      venue: 'NASDAQ',
      quoteCurrency: 'USD',
      canonicalSymbol: symbol,
    }));
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(1),
      fetchJson: async () => ({
        status: 'ok',
        values: [
          { datetime: '2024-01-02', open: '1', high: '2', low: '1', close: '1.5', volume: '10' },
        ],
      }),
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-td-budget',
      universeId: 'US_ALL',
      instruments: refs,
      deps: { twelveDataClient: client, concurrency: 1 },
    });
    const reasons = snapshot.instruments.map((row) => row.reasonCode);
    expect(reasons).toContain(TD_CREDIT_EXHAUSTED);
    expect(
      snapshot.instruments.some(
        (row) => row.dataStatus === 'AVAILABLE' || row.dataStatus === 'PARTIAL',
      ),
    ).toBe(true);
  });

  it('does not use Twelve Data for CRYPTO_* market hydrate', async () => {
    const ref = cryptoSpot('BTCUSDT');
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => {
        throw new Error('Twelve Data must not hydrate CRYPTO_*');
      },
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'b-td-crypto',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [ref],
      deps: {
        twelveDataClient: client,
        fetchJson: async (url) => {
          expect(url).not.toMatch(/twelvedata|coingecko/);
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
          if (url.includes('/klines')) {
            return [[1_700_000_000_000, '1', '2', '0.5', '70000', '10']];
          }
          return [];
        },
      },
    });
    expect(snapshot.provider).toBe('binance-spot');
    expect(snapshot.instruments[0]?.instrumentRef.symbol).toBe('BTCUSDT');
    expect(snapshot.instruments[0]?.instrumentRef.venue).toBe('BINANCE');
    expect(snapshot.instruments[0]?.quote?.price).toBe(70000);
  });
});
