/**
 * Universe ingest: one provider, eligibility, pagination completeness,
 * last-known-good, commodities ≠ NSE equities, futures require contract identity.
 */
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  publishCanonicalUniverseSnapshot,
  type CanonicalUniverseInstrument,
} from '../canonical-universe-registry';
import { classifyCryptoEligibility, configuredCryptoUniverseProvider } from './crypto-eligibility';
import { normalizeBinanceExchangeInfo, normalizeCoinGeckoMarkets } from './crypto-providers';
import {
  mapBinanceFuturesContractType,
  normalizeBinanceFuturesExchangeInfo,
} from './crypto-futures';
import {
  ALPHA_VANTAGE_COMMODITY_FUNCTIONS,
  commodityProductsFromAvCatalog,
  isAvCommodityProbeOk,
} from './alpha-vantage-commodities';
import {
  commodityUniverseGate,
  futuresContractIdentity,
  nseEquityIsNotCommodity,
} from './commodity-futures';
import { mergeUsListings, normalizeNasdaqListed, normalizeOtherListed } from './nasdaq-trader-us';
import { parseApprovedFuturesFeed } from './mcx-approved-feed';

function eligibleRow(
  overrides: Partial<CanonicalUniverseInstrument> = {},
): CanonicalUniverseInstrument {
  return {
    symbol: 'BTCUSDT',
    name: 'BTC/USDT',
    venue: 'BINANCE',
    series: 'SPOT',
    isin: null,
    assetClass: 'CRYPTO_SPOT',
    quoteCurrency: 'USDT',
    provider: 'binance',
    providerAssetId: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    instrumentType: 'SPOT',
    eligibilityStatus: 'ELIGIBLE',
    ...overrides,
  };
}

describe('crypto universe eligibility', () => {
  it('defaults CRYPTO_UNIVERSE_PROVIDER to binance, never both', () => {
    const previous = process.env.CRYPTO_UNIVERSE_PROVIDER;
    delete process.env.CRYPTO_UNIVERSE_PROVIDER;
    expect(configuredCryptoUniverseProvider()).toBe('binance');
    process.env.CRYPTO_UNIVERSE_PROVIDER = 'coingecko';
    expect(configuredCryptoUniverseProvider()).toBe('coingecko');
    process.env.CRYPTO_UNIVERSE_PROVIDER = 'BINANCE';
    expect(configuredCryptoUniverseProvider()).toBe('binance');
    if (previous == null) delete process.env.CRYPTO_UNIVERSE_PROVIDER;
    else process.env.CRYPTO_UNIVERSE_PROVIDER = previous;
  });

  it('keeps Binance USDT/USDC TRADING spot and drops other quotes/break', () => {
    expect(
      classifyCryptoEligibility({
        provider: 'binance',
        providerAssetId: 'BTCUSDT',
        symbol: 'BTCUSDT',
        status: 'TRADING',
        tradable: true,
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
      }).status,
    ).toBe('ELIGIBLE');
    expect(
      classifyCryptoEligibility({
        provider: 'binance',
        providerAssetId: 'ETHBTC',
        status: 'TRADING',
        tradable: true,
        baseAsset: 'ETH',
        quoteAsset: 'BTC',
      }).status,
    ).toBe('EXCLUDED');
    expect(
      classifyCryptoEligibility({
        provider: 'binance',
        providerAssetId: 'SHIBUSDT',
        status: 'BREAK',
        tradable: true,
        baseAsset: 'SHIB',
        quoteAsset: 'USDT',
      }).status,
    ).toBe('DELISTED');
  });

  it('requires CoinGecko market data and does not treat ATH as listing history', () => {
    expect(
      classifyCryptoEligibility({
        provider: 'coingecko',
        providerAssetId: 'bitcoin',
        symbol: 'btc',
        price: 100,
        marketCap: 1e12,
      }).status,
    ).toBe('ELIGIBLE');
    expect(
      classifyCryptoEligibility({
        provider: 'coingecko',
        providerAssetId: 'ghost',
        price: null,
        marketCap: 1,
      }).status,
    ).toBe('EXCLUDED');
  });
});

describe('crypto provider normalization', () => {
  it('normalizes Binance exchangeInfo without inventing symbols', () => {
    const result = normalizeBinanceExchangeInfo({
      symbols: [
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          isSpotTradingAllowed: true,
        },
        {
          symbol: 'ETHBTC',
          status: 'TRADING',
          baseAsset: 'ETH',
          quoteAsset: 'BTC',
          isSpotTradingAllowed: true,
        },
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          isSpotTradingAllowed: true,
        },
        { symbol: '' },
      ],
    });
    expect(result.provider).toBe('binance');
    expect(result.instruments.map((row) => row.providerAssetId)).toEqual(['BTCUSDT']);
    expect(result.excludedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.incompleteFetch).toBe(false);
  });

  it('keys CoinGecko identity on provider asset id, not ticker', () => {
    const result = normalizeCoinGeckoMarkets([
      [
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 100, market_cap: 1e12 },
        {
          id: 'bitcoin-cash',
          symbol: 'btc',
          name: 'Bitcoin Cash',
          current_price: 50,
          market_cap: 1e9,
        },
        { id: 'ghost', symbol: 'ghost', name: 'Ghost', current_price: null, market_cap: 1 },
        { id: 'bitcoin', symbol: 'btc', name: 'dup', current_price: 100, market_cap: 1 },
      ],
    ]);
    expect(result.provider).toBe('coingecko');
    expect(result.instruments.map((row) => row.providerAssetId)).toEqual([
      'bitcoin',
      'bitcoin-cash',
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it('does not silently merge Binance and CoinGecko universes', () => {
    const binance = normalizeBinanceExchangeInfo({
      symbols: [
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          isSpotTradingAllowed: true,
        },
      ],
    });
    const gecko = normalizeCoinGeckoMarkets([
      [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 1, market_cap: 1 }],
    ]);
    expect(binance.provider).not.toBe(gecko.provider);
    expect(new Set([binance.provider, gecko.provider])).toEqual(new Set(['binance', 'coingecko']));
  });

  it('treats a full last CoinGecko page at the cap as incomplete', () => {
    const result = normalizeCoinGeckoMarkets(
      [[{ id: 'a', symbol: 'a', current_price: 1, market_cap: 1 }]],
      {
        pageCapReached: true,
        pageSize: 1,
      },
    );
    expect(result.incompleteFetch).toBe(true);
    expect(result.providerReportedTotal).toBeGreaterThan(result.receivedTotal);
  });
});

describe('commodity vs futures identity', () => {
  it('keeps COMMODITY_ALL as products and FUTURES_ALL/MCX/CME gated without scrape', () => {
    const products = commodityUniverseGate('COMMODITY_ALL');
    const contracts = commodityUniverseGate('FUTURES_ALL');
    const mcx = commodityUniverseGate('MCX_FUTURES_ALL');
    const cme = commodityUniverseGate('CME_FUTURES_ALL');
    expect(products.supported).toBe(false);
    expect(products.identityModel).toBe('PRODUCT');
    expect(contracts.identityModel).toBe('CONTRACT');
    expect(products.detail).toMatch(/not NSE/);
    expect(contracts.detail).toMatch(/unsupported|CRYPTO_FUTURES_ALL/i);
    expect(mcx.scrapeForbidden).toBe(true);
    expect(cme.scrapeForbidden).toBe(true);
    expect(mcx.detail).toMatch(/do not scrape/i);
    expect(cme.detail).toMatch(/do not scrape/i);
  });

  it('never treats NSE gold-company equities as commodities', () => {
    expect(nseEquityIsNotCommodity('GOLDBEES', 'Nippon Gold ETF')).toBe(true);
  });

  it('refuses futures identity without venue + underlying + month', () => {
    expect(futuresContractIdentity({ symbol: 'CL' })).toBeNull();
    expect(
      futuresContractIdentity({
        symbol: 'CLZ26',
        venue: 'NYMEX',
        underlying: 'CL',
        contractMonth: '2026-12',
      }),
    ).toBe('NYMEX|CL|2026-12|2026-12|CLZ26');
  });
});

describe('crypto futures identity', () => {
  it('classifies perpetual vs quarterly and never joins on ticker', () => {
    const result = normalizeBinanceFuturesExchangeInfo({
      symbols: [
        {
          symbol: 'BTCUSDT',
          contractType: 'PERPETUAL',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          deliveryDate: 253402300799000,
        },
        {
          symbol: 'BTCUSDT_251226',
          contractType: 'CURRENT_QUARTER',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          deliveryDate: Date.UTC(2025, 11, 26),
        },
        {
          symbol: 'ETHUSDT',
          contractType: 'PERPETUAL',
          status: 'BREAK',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
        },
      ],
    });
    expect(mapBinanceFuturesContractType('PERPETUAL')).toBe('PERPETUAL');
    expect(result.instruments.map((row) => row.providerAssetId)).toEqual([
      'BTCUSDT:PERPETUAL',
      'BTCUSDT_251226:QUARTERLY:2025-12',
    ]);
    expect(result.instruments[0]?.assetClass).toBe('CRYPTO_FUTURE');
    expect(result.excludedCount).toBe(1);
  });
});

describe('alpha vantage commodity catalog', () => {
  it('publishes products from the AV catalog fixture, not a hardcoded GOLD contract list', () => {
    const rows = commodityProductsFromAvCatalog(ALPHA_VANTAGE_COMMODITY_FUNCTIONS);
    expect(rows.length).toBe(ALPHA_VANTAGE_COMMODITY_FUNCTIONS.length);
    expect(rows.every((row) => row.contractType === 'PRODUCT')).toBe(true);
    expect(rows.every((row) => row.assetClass === 'COMMODITY')).toBe(true);
    expect(rows.every((row) => row.venue === 'ALPHA_VANTAGE')).toBe(true);
    expect(rows.map((row) => row.providerAssetId).sort()).toEqual(
      ALPHA_VANTAGE_COMMODITY_FUNCTIONS.map((row) => row.function).sort(),
    );
    expect(rows.some((row) => row.venue === 'MCX' || row.contractType === 'MONTHLY')).toBe(false);
    expect(isAvCommodityProbeOk({ Note: 'rate limit' })).toBe(false);
    expect(isAvCommodityProbeOk({ data: [{ date: '2024-01-01', value: '70' }] })).toBe(true);
  });
});

describe('canonical snapshot last-known-good', () => {
  let dir: string;
  const previous = process.env.CANONICAL_UNIVERSE_SNAPSHOT_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stockpred-universe-'));
    process.env.CANONICAL_UNIVERSE_SNAPSHOT_DIR = dir;
  });

  afterEach(() => {
    if (previous == null) delete process.env.CANONICAL_UNIVERSE_SNAPSHOT_DIR;
    else process.env.CANONICAL_UNIVERSE_SNAPSHOT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes CRYPTO_SPOT_ALL and retains last-known-good on empty fetch', () => {
    const first = publishCanonicalUniverseSnapshot({
      universeId: 'CRYPTO_SPOT_ALL',
      source: 'binance',
      provider: 'binance',
      instruments: [eligibleRow()],
      sourceCount: 1,
      rawRecordCount: 1,
      rejectedCount: 0,
      duplicateCount: 0,
      excludedCount: 0,
      receivedTotal: 1,
      providerReportedTotal: 1,
    });
    expect(first.published).toBe(true);
    expect(first.snapshot?.eligibleRecordCount).toBe(1);
    expect(existsSync(join(dir, 'CRYPTO_ALL.active.json'))).toBe(true);

    const empty = publishCanonicalUniverseSnapshot({
      universeId: 'CRYPTO_ALL',
      source: 'binance',
      provider: 'binance',
      instruments: [],
      sourceCount: 0,
      rawRecordCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      excludedCount: 0,
    });
    expect(empty.published).toBe(false);
    expect(empty.snapshot?.version).toBe(first.snapshot?.version);

    const incomplete = publishCanonicalUniverseSnapshot({
      universeId: 'CRYPTO_ALL',
      source: 'coingecko',
      provider: 'coingecko',
      instruments: [
        eligibleRow({ provider: 'coingecko', providerAssetId: 'bitcoin', symbol: 'BTC' }),
      ],
      sourceCount: 4000,
      rawRecordCount: 250,
      rejectedCount: 0,
      duplicateCount: 0,
      excludedCount: 0,
      receivedTotal: 250,
      providerReportedTotal: 4000,
    });
    expect(incomplete.published).toBe(false);
    expect(incomplete.snapshot?.ingestionRun?.provider).toBe('binance');
  });
});

describe('US NASDAQ Trader listings', () => {
  it('keeps listed equities, drops test issues, and does not invent tickers', () => {
    const nasdaq = normalizeNasdaqListed(
      [
        'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares',
        'AAPL|Apple Inc.|Q|N|N|100|N|N',
        'ZZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N',
        'QQQ|Invesco QQQ Trust|G|N|N|100|Y|N',
        'File Creation Time: 0917202618:02|||||',
      ].join('\n'),
    );
    expect(nasdaq.instruments.map((row) => row.symbol).sort()).toEqual(['AAPL', 'QQQ']);
    expect(nasdaq.instruments.find((row) => row.symbol === 'AAPL')?.assetClass).toBe('EQUITY');
    expect(nasdaq.instruments.find((row) => row.symbol === 'QQQ')?.assetClass).toBe('ETF');
    expect(nasdaq.excludedCount).toBe(1);
    const other = normalizeOtherListed(
      [
        'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol',
        'IBM|International Business Machines|N|IBM|N|100|N|IBM',
        'AAPL|Apple Inc.|N|AAPL|N|100|N|AAPL',
      ].join('\n'),
    );
    const merged = mergeUsListings(nasdaq, other);
    expect(merged.instruments.map((row) => row.symbol).sort()).toEqual(['AAPL', 'IBM', 'QQQ']);
    expect(merged.instruments.find((row) => row.symbol === 'IBM')?.venue).toBe('NYSE');
  });
});

describe('approved MCX/CME feed', () => {
  it('rejects HTML and missing contract identity; accepts JSON contracts', () => {
    const html = parseApprovedFuturesFeed('<html><body>GOLD</body></html>', 'MCX_FUTURES_ALL');
    expect(html.ok).toBe(false);
    expect(html.reasonCode).toBe('SCRAPE_FORBIDDEN');
    const json = parseApprovedFuturesFeed(
      JSON.stringify({
        contracts: [
          {
            symbol: 'GOLD26OCTFUT',
            name: 'Gold Oct 2026',
            underlying: 'GOLD',
            venue: 'MCX',
            contractMonth: '2026-10',
            expiry: '2026-10-05',
            contractType: 'MONTHLY',
          },
        ],
      }),
      'MCX_FUTURES_ALL',
    );
    expect(json.ok).toBe(true);
    expect(json.instruments).toHaveLength(1);
    expect(json.instruments[0]?.providerAssetId).toContain('MCX|GOLD');
  });
});
