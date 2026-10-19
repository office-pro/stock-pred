import { normalizeTwelveDataForexPairs } from './twelve-data-forex';

describe('twelve-data forex membership', () => {
  it('normalizes provider /forex_pairs rows and never invents symbols', () => {
    const fetched = normalizeTwelveDataForexPairs({
      data: [
        {
          symbol: 'EUR/USD',
          currency_group: 'Major',
          currency_base: 'Euro',
          currency_quote: 'US Dollar',
        },
        { symbol: 'EUR/USD', currency_base: 'Euro', currency_quote: 'US Dollar' },
        { symbol: '', currency_base: 'skip' },
      ],
    });
    expect(fetched.instruments.map((row) => row.symbol)).toEqual(['EUR/USD']);
    expect(fetched.instruments[0]?.assetClass).toBe('FX');
    expect(fetched.instruments[0]?.venue).toBe('TWELVE_DATA');
    expect(fetched.duplicateCount).toBe(1);
    expect(fetched.rejectedCount).toBe(1);
    expect(fetched.source).toBe('twelve-data:/forex_pairs');
  });
});
