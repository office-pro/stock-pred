import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTwelveDataClientFromEnv,
  mapToTwelveDataSymbol,
  parseTwelveDataPressReleases,
  parseTwelveDataTimeSeries,
  TD_CREDIT_EXHAUSTED,
  TWELVE_DATA_FROZEN,
  TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN,
  TwelveDataClient,
  TwelveDataCreditBudget,
} from './twelve-data-client';

describe('TwelveDataClient', () => {
  it('calls time_series only and refuses indicator paths', async () => {
    const urls: string[] = [];
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(4),
      fetchJson: async (url) => {
        urls.push(url);
        expect(url).toContain('/time_series');
        expect(url).not.toMatch(/\/rsi|\/macd|\/adx/);
        return {
          status: 'ok',
          values: [
            {
              datetime: '2024-01-01',
              open: '1',
              high: '2',
              low: '0.5',
              close: '1.5',
              volume: '10',
            },
            {
              datetime: '2024-01-02',
              open: '1.5',
              high: '2.5',
              low: '1.4',
              close: '2',
              volume: '12',
            },
          ],
        };
      },
    });
    const raw = await client.timeSeries('AAPL');
    const parsed = parseTwelveDataTimeSeries(raw);
    expect(parsed.candles).toHaveLength(2);
    expect(parsed.quote?.price).toBe(2);
    expect(urls[0]).toContain('apikey=test-key');
    const src = readFileSync(join(__dirname, 'twelve-data-client.ts'), 'utf8');
    expect(src).not.toMatch(/['"`]\/(rsi|ema|macd|atr|adx|bbands|vwap)\b/);
  });

  it('throws TD_CREDIT_EXHAUSTED when the budget is empty', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(0),
      fetchJson: async () => {
        throw new Error('should not fetch');
      },
    });
    await expect(client.timeSeries('EUR/USD')).rejects.toMatchObject({ name: TD_CREDIT_EXHAUSTED });
  });

  it('calls press_releases on leftover credits and freezes afterwards', async () => {
    const urls: string[] = [];
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(2),
      fetchJson: async (url) => {
        urls.push(url);
        expect(url).not.toMatch(/\/rsi|\/macd|\/adx/);
        if (url.includes('/press_releases')) {
          return { status: 'ok', press_releases: [{ title: 'Apple reports quarterly results' }] };
        }
        return {
          status: 'ok',
          values: [
            {
              datetime: '2024-01-01',
              open: '1',
              high: '2',
              low: '0.5',
              close: '1.5',
              volume: '10',
            },
          ],
        };
      },
    });
    await client.timeSeries('AAPL');
    const raw = await client.pressReleases('AAPL');
    expect(raw.press_releases?.[0]?.title).toContain('Apple');
    expect(urls.some((u) => u.includes('/press_releases'))).toBe(true);
    expect(urls.some((u) => u.includes('/time_series'))).toBe(true);
    client.freeze();
    await expect(client.pressReleases('AAPL')).rejects.toMatchObject({ name: TWELVE_DATA_FROZEN });
  });

  it('press_releases throws TD_CREDIT_EXHAUSTED when the budget is empty', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(0),
      fetchJson: async () => {
        throw new Error('should not fetch');
      },
    });
    await expect(client.pressReleases('AAPL')).rejects.toMatchObject({ name: TD_CREDIT_EXHAUSTED });
  });

  it('maps crypto spot BTCUSDT → BTC/USD without mutating the frozen ref', () => {
    const ref = {
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO_SPOT',
      venue: 'BINANCE',
      canonicalSymbol: 'BTCUSDT',
    };
    expect(mapToTwelveDataSymbol(ref)).toBe('BTC/USD');
    expect(ref.symbol).toBe('BTCUSDT');
    expect(mapToTwelveDataSymbol({ symbol: 'EUR/USD', assetClass: 'FX' })).toBe('EUR/USD');
    expect(mapToTwelveDataSymbol({ symbol: 'AAPL', assetClass: 'EQUITY' })).toBe('AAPL');
  });

  it('rejects constructing indicator endpoint URLs', () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(8),
      fetchJson: async () => ({}),
    });
    expect(() => (client as unknown as { url: (path: string) => string }).url('/rsi')).toThrow(
      TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN,
    );
  });

  it('maps press_releases vendor 429 to TD_CREDIT_EXHAUSTED and parses data[]', async () => {
    const client = new TwelveDataClient({
      apiKey: 'test-key',
      budget: new TwelveDataCreditBudget(2),
      fetchJson: async () => ({ status: 'error', code: 429, message: 'limit' }),
    });
    await expect(client.pressReleases('AAPL')).rejects.toMatchObject({ name: TD_CREDIT_EXHAUSTED });
    expect(
      parseTwelveDataPressReleases({
        data: [{ title: '  Hello  ', datetime: '2024-01-01', url: 'https://ex' }],
      }),
    ).toEqual([{ title: 'Hello', datetime: '2024-01-01', url: 'https://ex' }]);
    expect(parseTwelveDataPressReleases(null)).toEqual([]);
  });

  it('forexPairs returns data rows and createTwelveDataClientFromEnv requires a key', async () => {
    expect(createTwelveDataClientFromEnv({ TWELVE_DATA_API_KEY: '' })).toBeNull();
    const client = createTwelveDataClientFromEnv(
      { TWELVE_DATA_API_KEY: 'env-key', TWELVE_DATA_CREDIT_BUDGET: '3' },
      {
        fetchJson: async () => ({ data: [{ symbol: 'EUR/USD' }] }),
      },
    );
    expect(client).not.toBeNull();
    await expect(client!.forexPairs()).resolves.toEqual([{ symbol: 'EUR/USD' }]);
  });
});
