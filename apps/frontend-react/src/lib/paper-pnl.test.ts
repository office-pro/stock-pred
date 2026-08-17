import {
  dayChangePercent,
  formatListedTime,
  formatQuoteDelay,
  holdingForSymbol,
  livePrice,
  paperPnl,
  pickLiveQuote,
} from './paper-pnl';

describe('paperPnl', () => {
  it('reports profit percent vs buy price', () => {
    expect(paperPnl({ live: 110, boughtAt: 100, quantity: 10 })).toEqual({
      amount: 100,
      percent: 10,
    });
  });

  it('reports loss percent vs buy price', () => {
    expect(paperPnl({ live: 90, boughtAt: 100, quantity: 5 })).toEqual({
      amount: -50,
      percent: -10,
    });
  });
});

describe('dayChangePercent', () => {
  it('is vs previous close, not the buy price', () => {
    expect(dayChangePercent(110, 100)).toBe(10);
    expect(dayChangePercent(90, 100)).toBe(-10);
    expect(dayChangePercent(100, 0)).toBeNull();
  });
});

describe('livePrice', () => {
  it('prefers the live tick over the quote', () => {
    expect(livePrice(100, 101.5)).toBe(101.5);
    expect(livePrice(100, undefined)).toBe(100);
  });
});

describe('pickLiveQuote', () => {
  it('keeps a newer REST quote over a stale websocket tick', () => {
    expect(
      pickLiveQuote({
        quotePrice: 250,
        quoteTime: 2_000,
        tickPrice: 240,
        tickTime: 1_000,
      }),
    ).toEqual({ price: 250, listedAt: 2_000 });
  });

  it('uses a newer tick when it is actually later', () => {
    expect(
      pickLiveQuote({
        quotePrice: 250,
        quoteTime: 1_000,
        tickPrice: 251,
        tickTime: 2_000,
      }),
    ).toEqual({ price: 251, listedAt: 2_000 });
  });
});

describe('formatQuoteDelay', () => {
  it('reports seconds between listed time and now', () => {
    expect(formatQuoteDelay(1_000, 16_000)).toBe('15s delay');
    expect(formatQuoteDelay(1_000, 121_000)).toBe('2m delay');
    expect(formatQuoteDelay(undefined, 1_000)).toBeNull();
  });
});

describe('holdingForSymbol', () => {
  it('matches the open lot ignoring case', () => {
    const lot = holdingForSymbol(
      [
        {
          symbol: 'RELIANCE',
          quantity: 2,
          entryPrice: 1,
          currentPrice: 1,
          target: 1,
          stopLoss: 1,
          unrealizedPnl: 0,
        },
      ],
      'reliance',
    );
    expect(lot?.quantity).toBe(2);
  });
});

describe('formatListedTime', () => {
  it('prints the quote stamp in IST, not the machine local zone', () => {
    const stamp = formatListedTime(Date.UTC(2026, 7, 14, 10, 0, 0));
    expect(stamp).toContain('IST');
    expect(stamp).toMatch(/14 Aug 2026/);
    expect(stamp).toMatch(/3:30:00/);
  });

  it('returns null for a missing stamp', () => {
    expect(formatListedTime(undefined)).toBeNull();
    expect(formatListedTime(0)).toBeNull();
  });
});
