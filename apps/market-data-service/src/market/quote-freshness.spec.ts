import { isFreshMemoryQuote, MDS_QUOTE_MEMORY_TTL_MS } from './quote-freshness';

describe('isFreshMemoryQuote', () => {
  const now = 1_700_000_000_000;

  it('fresh lastLiveRefresh → no provider needed', () => {
    expect(
      isFreshMemoryQuote({
        hasUsablePrice: true,
        lastLiveRefreshMs: now - 1_000,
        lastTickTimeMs: now - 1_000,
        sessionOpen: true,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('stale lastLiveRefresh during session → not fresh', () => {
    expect(
      isFreshMemoryQuote({
        hasUsablePrice: true,
        lastLiveRefreshMs: now - MDS_QUOTE_MEMORY_TTL_MS - 1,
        lastTickTimeMs: now - MDS_QUOTE_MEMORY_TTL_MS - 1,
        sessionOpen: true,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('usable price while cash session is closed is fresh (no after-hours Yahoo)', () => {
    expect(
      isFreshMemoryQuote({
        hasUsablePrice: true,
        lastLiveRefreshMs: null,
        lastTickTimeMs: now - 6 * 60 * 60 * 1000,
        sessionOpen: false,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('no usable price is never fresh', () => {
    expect(
      isFreshMemoryQuote({
        hasUsablePrice: false,
        lastLiveRefreshMs: now,
        sessionOpen: false,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('recent lastTick during session is fresh even without lastLiveRefresh', () => {
    expect(
      isFreshMemoryQuote({
        hasUsablePrice: true,
        lastLiveRefreshMs: null,
        lastTickTimeMs: now - 5_000,
        sessionOpen: true,
        nowMs: now,
      }),
    ).toBe(true);
  });
});
