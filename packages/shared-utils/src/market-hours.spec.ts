import {
  classifyQuoteStatus,
  COINGECKO_FRESH_QUOTE_MAX_AGE_MS,
  COINGECKO_MAX_QUOTE_AGE_MS,
} from './market-hours';

describe('classifyQuoteStatus asset-class awareness', () => {
  const thursdayNightIst = Date.parse('2026-09-17T20:00:00+05:30');

  it('does not label crypto CLOSED_MARKET when NSE is shut', () => {
    const quoteAt = thursdayNightIst - 10_000;
    expect(classifyQuoteStatus(quoteAt, thursdayNightIst)).toBe('CLOSED_MARKET');
    expect(
      classifyQuoteStatus(quoteAt, thursdayNightIst, undefined, undefined, { alwaysOpen: true }),
    ).toBe('LIVE');
  });

  it('labels CoinGecko ~60s age DELAYED and never invents LIVE', () => {
    const now = Date.parse('2026-09-17T12:00:00Z');
    const age60 = now - 60_000;
    expect(
      classifyQuoteStatus(
        age60,
        now,
        COINGECKO_MAX_QUOTE_AGE_MS,
        COINGECKO_FRESH_QUOTE_MAX_AGE_MS,
        { alwaysOpen: true },
      ),
    ).toBe('DELAYED');
    expect(COINGECKO_FRESH_QUOTE_MAX_AGE_MS).toBe(0);
  });
});
