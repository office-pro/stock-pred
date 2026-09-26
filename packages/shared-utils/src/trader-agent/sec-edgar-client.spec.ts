import {
  companyFactsUrl,
  defaultSecFetchJson,
  parseCompanyFacts,
  parseCompanyTickers,
  padSecCik,
  SecEdgarClient,
  isUsListedEquity,
} from './sec-edgar-client';

const tickers = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
};

const facts = {
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      Revenues: {
        units: {
          USD: [{ val: 394328000000, end: '2024-09-28', form: '10-K' }],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [{ val: 93736000000, end: '2024-09-28', form: '10-K' }],
        },
      },
    },
  },
};

describe('SEC EDGAR client', () => {
  it('maps ticker → CIK without treating it as universe membership', async () => {
    const urls: string[] = [];
    const client = new SecEdgarClient({
      fetchJson: async (url) => {
        urls.push(url);
        if (url.includes('company_tickers.json')) return tickers;
        if (url.includes('CIK0000320193')) return facts;
        throw new Error(`unexpected ${url}`);
      },
    });
    const result = await client.companyFactsForTicker('AAPL');
    expect(result.match?.cik).toBe('0000320193');
    expect(result.payload?.kind).toBe('EQUITY_STATEMENTS');
    expect(result.payload && 'revenue' in result.payload ? result.payload.revenue : undefined).toBe(
      394328000000,
    );
    expect(result.entityName).toBe('Apple Inc.');
    expect(urls.some((u) => u.includes('company_tickers.json'))).toBe(true);
  });

  it('returns no payload when facts are empty', () => {
    expect(
      parseCompanyFacts({ entityName: 'Empty Co', facts: { 'us-gaap': {} } }).payload,
    ).toBeUndefined();
  });

  it('parses company_tickers.json rows', () => {
    const map = parseCompanyTickers(tickers);
    expect(map.get('AAPL')?.cik).toBe('0000320193');
  });

  it('isUsListedEquity is US EQUITY only', () => {
    expect(isUsListedEquity({ assetClass: 'EQUITY', venue: 'NASDAQ' })).toBe(true);
    expect(isUsListedEquity({ assetClass: 'EQUITY', venue: 'NSE' })).toBe(false);
    expect(isUsListedEquity({ assetClass: 'CRYPTO_SPOT', venue: 'BINANCE' })).toBe(false);
    expect(isUsListedEquity({ assetClass: 'FX', venue: 'OTC' })).toBe(false);
    expect(isUsListedEquity({ assetClass: 'ETF', venue: 'NASDAQ' })).toBe(false);
  });

  it('prefers 10-K over 10-Q on the same as-of and reads non-USD units', () => {
    const parsed = parseCompanyFacts({
      entityName: 'Apple Inc.',
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              EUR: [
                { val: 1, end: '2024-09-28', form: '10-Q' },
                { val: 2, end: '2024-09-28', form: '10-K' },
              ],
            },
          },
        },
      },
    });
    expect(parsed.payload?.revenue).toBe(2);
    expect(padSecCik(320193)).toBe('0000320193');
    expect(companyFactsUrl('320193')).toContain('CIK0000320193.json');
  });

  it('defaultSecFetchJson uses the SEC User-Agent and rejects HTTP errors', async () => {
    const orig = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    try {
      await expect(
        defaultSecFetchJson('https://www.sec.gov/files/company_tickers.json'),
      ).resolves.toEqual({
        ok: true,
      });
      expect(String((global.fetch as jest.Mock).mock.calls[0][1].headers['User-Agent'])).toContain(
        'stockpred',
      );
    } finally {
      global.fetch = orig;
    }
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    try {
      await expect(defaultSecFetchJson('https://www.sec.gov/x')).rejects.toThrow(/SEC HTTP 503/);
    } finally {
      global.fetch = orig;
    }
  });
});
