/**
 * CRYPTO-BATCH-EVIDENCE-INTEGRATION — provenance + identity + coverage.
 * Presence alone is not acceptance. After freeze: no provider HTTP.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { InstrumentRef } from '@stockpred/shared-types';
import {
  attachBatchInstrumentToIntelligenceSnapshot,
  CRYPTO_SHARED_GDELT_QUERIES,
  extraCryptoGdeltQueries,
  FED_H15_XML_URL,
  frozenCryptoNewsAliases,
  hydrateBatchDataSnapshot,
  isBitcoinNetworkRef,
  NO_MATCHING_RETRIEVED_NEWS,
  networkProjectForRef,
  selectBatchProvider,
} from './index';
import { geckoIdForOnchain } from './crypto-onchain-evidence';

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

function llamaChainsBody(): string {
  return JSON.stringify([
    { gecko_id: 'bitcoin', name: 'Bitcoin', tvl: 1_500_000_000 },
    { gecko_id: 'ethereum', name: 'Ethereum', tvl: 40_000_000_000 },
    { gecko_id: 'solana', name: 'Solana', tvl: 5_000_000_000 },
  ]);
}

function llamaProtocolsBody(): string {
  return JSON.stringify([
    { gecko_id: 'ethereum', chain: 'Ethereum', tvl: 40_000_000_000, fees24h: 12_000_000 },
    { gecko_id: 'solana', chain: 'Solana', tvl: 5_000_000_000, fees24h: 1_000_000 },
  ]);
}

function binanceCryptoFetch(url: string, symbols: Record<string, string>): unknown {
  if (url.includes('coingecko') || url.includes('stlouisfed') || url.includes('fredgraph')) {
    throw new Error(`excluded url ${url}`);
  }
  if (url.includes('/ticker/24hr')) {
    return Object.entries(symbols).map(([symbol, lastPrice]) => ({
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
    return Object.entries(symbols).map(([symbol, lastPrice]) => ({
      symbol,
      markPrice: lastPrice,
      indexPrice: String(Number(lastPrice) - 10),
      lastFundingRate: '0.0008',
    }));
  }
  if (url.includes('/openInterest')) {
    const symbol = new URL(url).searchParams.get('symbol') ?? 'BTCUSDT';
    if (!symbols[symbol]) return {};
    return { symbol, openInterest: '12345' };
  }
  if (url.includes('/klines')) {
    return Array.from({ length: 30 }, (_, i) => [
      1_700_000_000_000 + i,
      '1',
      '2',
      '0.5',
      '1.5',
      '10',
    ]);
  }
  return {};
}

function cryptoEvidenceFetch(url: string): unknown {
  if (url.includes('gdeltproject.org')) {
    const query = decodeURIComponent(url);
    const articles = [];
    if (/bitcoin/i.test(query)) {
      articles.push({
        title: 'Bitcoin ETF inflows hit a record',
        url: 'https://ex/btc',
        seendate: '20240102T120000Z',
      });
    }
    if (/ethereum/i.test(query)) {
      articles.push({
        title: 'Ethereum validators exit queue shrinks',
        url: 'https://ex/eth',
        seendate: '20240102T120000Z',
      });
    }
    articles.push({
      title: 'Unrelated global markets wrap',
      url: 'https://ex/drop',
      seendate: '20240102T120000Z',
    });
    return { articles };
  }
  if (url.includes('federalreserve.gov') || url.includes('h15')) {
    return '<observation TIME_PERIOD="2024-02" OBS_VALUE="5.33"/>';
  }
  if (url.includes('bls.gov')) {
    return {
      Results: { series: [{ data: [{ year: '2024', period: 'M02', value: '310.5' }] }] },
    };
  }
  if (url.includes('treasury.gov') || url.includes('daily-treasury')) {
    return 'Date,10 Yr\n02/01/2024,4.22\n';
  }
  if (url.includes('company_tickers') || url.includes('companyfacts')) {
    throw new Error('SEC must not run for crypto');
  }
  throw new Error(`unexpected evidence url ${url}`);
}

describe('CRYPTO-BATCH-EVIDENCE-INTEGRATION', () => {
  it('source scan excludes CoinGecko HTTP, FRED API/graph CSV, and token env for these providers', () => {
    const hydrate = readFileSync(join(__dirname, 'batch-data-hydrate.ts'), 'utf8');
    const macro = readFileSync(join(__dirname, 'batch-macro-client.ts'), 'utf8');
    const evidence = readFileSync(join(__dirname, 'batch-evidence-attach.ts'), 'utf8');
    expect(hydrate).not.toMatch(/api\.coingecko\.com/);
    expect(hydrate).not.toMatch(/simple\/price/);
    expect(macro).not.toMatch(/https?:\/\/[^\s'"]*stlouisfed/);
    expect(macro).not.toMatch(/https?:\/\/[^\s'"]*fredgraph/);
    expect(macro).not.toMatch(/BLS_API_KEY|FRED_API_KEY/);
    expect(evidence).not.toMatch(/api\.coingecko\.com/);
    expect(evidence).not.toMatch(/https?:\/\/[^\s'"]*stlouisfed/);
    expect(macro).toContain(FED_H15_XML_URL);
    expect(selectBatchProvider('CRYPTO_SPOT_ALL', [cryptoSpot('BTCUSDT')]).provider).toBe(
      'binance-spot',
    );
    expect(
      selectBatchProvider('CRYPTO_ALL', [cryptoSpot('ETHUSDT')], { twelveDataAvailable: true })
        .provider,
    ).toBe('binance-spot');
  });

  it('BTC spot attaches market, mempool NETWORK_PROJECT, mapped perp identity, batch macro, and alias-matched news', async () => {
    const scored: string[] = [];
    const fetchJson = jest.fn(async (url: string) =>
      binanceCryptoFetch(url, { BTCUSDT: '70000', XYZUSDT: '2' }),
    );
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'crypto-btc',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT'), cryptoSpot('XYZUSDT')],
      deps: {
        fetchJson,
        evidenceFetchJson: async (url) => cryptoEvidenceFetch(url),
        scoreHeadline: (title) => {
          scored.push(title);
          return 0.42;
        },
        onchainBody: llamaChainsBody(),
        networkProtocolsBody: llamaProtocolsBody(),
        mempoolSnapshot: {
          difficulty: 90_000_000_000_000,
          hashrate: 700,
          fees24h: 18,
          asOf: 1_700_000_000_000,
        },
        now: () => 1_700_000_000_000,
      },
    });
    expect(snapshot.frozen).toBe(true);
    expect(snapshot.instruments.every((row) => !('macro' in row))).toBe(true);
    expect(snapshot.macro?.series.length).toBeGreaterThan(0);
    expect(snapshot.macro?.series.every((row) => row.provider !== ('fred' as never))).toBe(true);

    const btc = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'BTCUSDT')!;
    const alt = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'XYZUSDT')!;
    expect(btc.quote?.price).toBe(70000);
    expect(btc.dataStatus).toBe('AVAILABLE');
    expect(btc.fundamentals).toMatchObject({
      kind: 'NETWORK_PROJECT',
      provider: 'mempool',
      difficulty: 90_000_000_000_000,
    });
    expect(btc.onchain?.provider).toBe('defillama');
    expect(btc.onchain?.tvlUsd).toBe(1_500_000_000);
    expect(btc.fundamentals).not.toEqual(btc.onchain);
    expect(btc.news?.headlineCount).toBe(1);
    expect(btc.sentiment).toEqual({ source: 'MODEL_DERIVED', score: 0.42 });
    expect(btc.derivatives?.sourceInstrument).toBe('BINANCE_FUTURES:BTCUSDT');
    expect(btc.derivatives?.contractType).toBe('PERPETUAL');
    expect(btc.derivatives?.markPrice).toBe(70000);
    expect(btc.derivatives?.openInterest).toBe(12345);
    expect(btc.derivatives?.fundingExtreme).toBe(true);
    expect(btc.instrumentRef.symbol).not.toBe(btc.derivatives?.sourceInstrument);

    expect(alt.quote?.price).toBe(2);
    expect(alt.fundamentals?.kind).toBe('UNAVAILABLE');
    expect(alt.news?.reasonCode).toBe(NO_MATCHING_RETRIEVED_NEWS);
    expect(alt.sentiment).toBeNull();
    expect(alt.sentiment).not.toBe(0);
    expect(alt.derivatives?.sourceInstrument).toBe('BINANCE_FUTURES:XYZUSDT');

    expect(scored).toEqual(['Bitcoin ETF inflows hit a record']);
    expect(scored.some((title) => /unrelated/i.test(title))).toBe(false);
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('coingecko'))).toBe(false);
    const callsAfterFreeze = fetchJson.mock.calls.length;
    expect(snapshot.frozen).toBe(true);
    expect(fetchJson.mock.calls.length).toBe(callsAfterFreeze);

    const intel = attachBatchInstrumentToIntelligenceSnapshot(
      {
        schemaVersion: 'intelligence.v1',
        engineVersion: 'test',
        generatedAt: 't',
        sourceDataTimestamp: 't',
        marketContext: { asOf: 't' } as never,
      },
      btc,
      snapshot,
    );
    expect(intel.derivatives?.sourceInstrument).toBe('BINANCE_FUTURES:BTCUSDT');
    expect(intel.derivatives?.contractType).toBe('PERPETUAL');
    expect(intel.fundamental).toMatchObject({ kind: 'NETWORK_PROJECT', provider: 'mempool' });
    expect(intel.onchain?.provider).toBe('defillama');
    expect(intel.macro?.series?.length).toBe(snapshot.macro?.series.length);
    expect(intel.macro?.requestedSeries).toEqual(snapshot.macro?.requestedSeries);
  });

  it('ETH/SOL network fundamentals use DefiLlama, never mempool', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'crypto-eth',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('ETHUSDT'), cryptoSpot('SOLUSDT')],
      deps: {
        fetchJson: async (url) => binanceCryptoFetch(url, { ETHUSDT: '3500', SOLUSDT: '150' }),
        skipEvidence: true,
        onchainBody: llamaChainsBody(),
        networkProtocolsBody: llamaProtocolsBody(),
        mempoolSnapshot: { difficulty: 1, asOf: 1 },
        now: () => 2,
      },
    });
    const eth = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'ETHUSDT')!;
    const sol = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'SOLUSDT')!;
    expect(isBitcoinNetworkRef(eth.instrumentRef)).toBe(false);
    expect(eth.fundamentals).toMatchObject({ kind: 'NETWORK_PROJECT', provider: 'defillama' });
    expect(sol.fundamentals).toMatchObject({ kind: 'NETWORK_PROJECT', provider: 'defillama' });
    expect((eth.fundamentals as { provider?: string }).provider).not.toBe('mempool');
    expect(eth.onchain?.geckoId).toBe('ethereum');
    expect(eth.onchain?.tvlUsd).toBe(40_000_000_000);
  });

  it('spot without a matching USDT-M perpetual leaves derivatives UNAVAILABLE — not fabricated spot OI', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'crypto-noperp',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('AAAUSDT')],
      deps: {
        fetchJson: async (url) => {
          if (url.includes('/premiumIndex')) return [];
          return binanceCryptoFetch(url, { AAAUSDT: '9' });
        },
        skipEvidence: true,
        skipOnchain: true,
        skipNetwork: true,
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.quote?.price).toBe(9);
    expect(row?.derivatives).toBeUndefined();
    const coverage = snapshot.capabilityCoverage?.find((c) => c.capability === 'derivatives');
    expect(coverage?.status).toBe('UNAVAILABLE');
    expect(coverage?.reason).not.toBe('SPOT_ASSET');
  });

  it('shared GDELT queries stay capped and unmatched titles are dropped', () => {
    expect(CRYPTO_SHARED_GDELT_QUERIES).toEqual(['bitcoin', 'ethereum', 'cryptocurrency']);
    const extras = extraCryptoGdeltQueries([
      cryptoSpot('BTCUSDT'),
      cryptoSpot('ETHUSDT'),
      cryptoSpot('SOLUSDT'),
      cryptoSpot('DOGEUSDT'),
    ]);
    expect(extras).not.toContain('bitcoin');
    expect(extras.length).toBeLessThanOrEqual(5);
    expect(frozenCryptoNewsAliases(cryptoSpot('BTCUSDT'))).toEqual(
      expect.arrayContaining(['BTCUSDT', 'BTC', 'bitcoin']),
    );
    expect(geckoIdForOnchain(cryptoSpot('ETHUSDT'))).toBe('ethereum');
    expect(
      networkProjectForRef(cryptoSpot('ETHUSDT'), {
        mempool: { difficulty: 1, asOf: 1 },
        now: 1,
      }).kind,
    ).toBe('UNAVAILABLE');
  });
});
