import {
  DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
  classifyQuoteStatus,
  isNseCashSessionOpen,
  isNseRegularSession,
  isUsableForAnalysis,
  isUsableForLiveTrading,
  resolveActiveIngestMode,
} from './market-hours';

describe('isNseRegularSession', () => {
  it('is open on a weekday during cash hours (IST)', () => {
    // Friday 14 Aug 2026, 10:00 IST = 04:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
    expect(isNseCashSessionOpen(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
  });

  it('opens at 09:15 IST and stays closed just before', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 44, 0))).toBe(false);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 45, 0))).toBe(true);
  });

  it('closes after 15:30 IST', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 0, 0))).toBe(true);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 1, 0))).toBe(false);
  });

  it('is closed on weekends', () => {
    // Saturday 15 Aug 2026, 11:00 IST = 05:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 15, 5, 30, 0))).toBe(false);
    // Sunday 16 Aug 2026, 11:00 IST
    expect(isNseRegularSession(Date.UTC(2026, 7, 16, 5, 30, 0))).toBe(false);
  });
});

describe('classifyQuoteStatus / live usability', () => {
  const openNow = Date.UTC(2026, 7, 14, 4, 30, 0); // Fri 10:00 IST
  const closedNow = Date.UTC(2026, 7, 14, 12, 0, 0); // Fri 17:30 IST

  it('marks fresh in-session quotes as LIVE and live-usable', () => {
    const status = classifyQuoteStatus(openNow - 5_000, openNow);
    expect(status).toBe('LIVE');
    expect(isUsableForLiveTrading(status)).toBe(true);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('marks in-session quotes older than TTL as STALE (not live-usable)', () => {
    const status = classifyQuoteStatus(openNow - DEFAULT_LIVE_QUOTE_MAX_AGE_MS - 1, openNow);
    expect(status).toBe('STALE');
    expect(isUsableForLiveTrading(status)).toBe(false);
    expect(isUsableForAnalysis(status)).toBe(false);
  });

  it('marks any quote as CLOSED_MARKET when session is closed', () => {
    const status = classifyQuoteStatus(closedNow - 1_000, closedNow);
    expect(status).toBe('CLOSED_MARKET');
    expect(isUsableForLiveTrading(status)).toBe(false);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('treats missing timestamps as STALE', () => {
    expect(classifyQuoteStatus(null, openNow)).toBe('STALE');
    expect(classifyQuoteStatus(0, openNow)).toBe('STALE');
  });

  it('resolves ingest mode from provider flags', () => {
    expect(resolveActiveIngestMode({ liveProviderEnabled: true, simulatedLiveFeed: false })).toBe(
      'LIVE_INGEST',
    );
    expect(resolveActiveIngestMode({ liveProviderEnabled: false, simulatedLiveFeed: true })).toBe(
      'LIVE_INGEST',
    );
    expect(resolveActiveIngestMode({ liveProviderEnabled: false, simulatedLiveFeed: false })).toBe(
      'EOD_INGEST',
    );
  });
});
