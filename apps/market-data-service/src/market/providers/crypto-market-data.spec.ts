import {
  configuredCryptoMarketDataProvider,
  cryptoUniverseMatchesMarketData,
  normalizeBinanceTicker24hr,
  normalizeCoinGeckoSimplePrice,
  remapBinanceFuturesPrints,
  resolveCryptoPrintKeys,
} from './crypto-market-data';

describe('crypto market-data providers', () => {
  it('defaults CRYPTO_MARKET_DATA_PROVIDER to binance and never selects twelve data', () => {
    expect(configuredCryptoMarketDataProvider(undefined)).toBe('binance');
    expect(configuredCryptoMarketDataProvider('coingecko')).toBe('coingecko');
    expect(configuredCryptoMarketDataProvider('twelve')).toBe('binance');
  });

  it('never fills Binance quotes from CoinGecko payloads', () => {
    const binance = normalizeBinanceTicker24hr(
      [
        {
          symbol: 'BTCUSDT',
          lastPrice: '100',
          volume: '1',
          highPrice: '1',
          lowPrice: '1',
          openPrice: '1',
          closeTime: 1,
        },
      ],
      new Set(['BTCUSDT']),
    );
    const gecko = normalizeCoinGeckoSimplePrice(
      { bitcoin: { usd: 99, usd_24h_vol: 1 } },
      new Set(['bitcoin']),
    );
    expect(binance[0]?.provider).toBe('binance');
    expect(gecko[0]?.provider).toBe('coingecko');
    expect(binance.map((row) => row.providerAssetId)).not.toEqual(
      gecko.map((row) => row.providerAssetId),
    );
    expect(cryptoUniverseMatchesMarketData('binance', 'coingecko')).toBe(false);
    expect(cryptoUniverseMatchesMarketData('coingecko', 'binance')).toBe(false);
  });

  it('does not join spot ticker prints onto perpetual membership keys', () => {
    const rows: Array<[string, { assetClass?: string; symbol: string; providerAssetId?: string }]> =
      [
        ['BTCUSDT', { assetClass: 'CRYPTO_SPOT', symbol: 'BTCUSDT', providerAssetId: 'BTCUSDT' }],
        [
          'BTCUSDT:PERPETUAL',
          { assetClass: 'CRYPTO_FUTURE', symbol: 'BTCUSDT', providerAssetId: 'BTCUSDT:PERPETUAL' },
        ],
      ];
    expect(
      resolveCryptoPrintKeys({ providerAssetId: 'BTCUSDT', provider: 'binance' }, rows),
    ).toEqual(['BTCUSDT']);
    expect(
      resolveCryptoPrintKeys({ providerAssetId: 'BTCUSDT', provider: 'binance-futures' }, rows),
    ).toEqual(['BTCUSDT:PERPETUAL']);
    expect(
      remapBinanceFuturesPrints(
        [
          {
            providerAssetId: 'BTCUSDT',
            price: 1,
            volume: 1,
            high: 1,
            low: 1,
            open: 1,
            listedAt: 1,
            provider: 'binance',
            providerSelectionReason: 'test',
          },
        ],
        rows.map(([, row]) => row),
      )[0]?.providerAssetId,
    ).toBe('BTCUSDT:PERPETUAL');
  });
});
