/** NSE regular session in Asia/Kolkata: weekdays 09:15–15:30. IST has no DST. */

import type { DataFreshnessStatus, IngestMode } from '@stockpred/shared-types';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const SESSION_OPEN_MIN = 9 * 60 + 15;
const SESSION_CLOSE_MIN = 15 * 60 + 30;

/** Default live quote TTL — must stay aligned with risk/gate maxQuoteAgeMs (60s). */
export const DEFAULT_LIVE_QUOTE_MAX_AGE_MS = 60_000;

function istClock(now: number): { weekday: number; minutes: number } {
  const ist = new Date(now + IST_OFFSET_MS);
  return {
    weekday: ist.getUTCDay(),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** True while the NSE cash market is in regular trading hours. */
export function isNseRegularSession(now = Date.now()): boolean {
  const { weekday, minutes } = istClock(now);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= SESSION_OPEN_MIN && minutes <= SESSION_CLOSE_MIN;
}

/** Alias — cash-session open check for ingest/routing contracts. */
export function isNseCashSessionOpen(now = Date.now()): boolean {
  return isNseRegularSession(now);
}

/**
 * Classify a quote timestamp for consumers.
 * Does not replace the trading quote-age gate; it labels why a quote is/isn't live.
 */
export function classifyQuoteStatus(
  quoteTimestampMs: number | null | undefined,
  now = Date.now(),
  maxLiveAgeMs = DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
): DataFreshnessStatus {
  if (quoteTimestampMs == null || !Number.isFinite(quoteTimestampMs) || quoteTimestampMs <= 0) {
    return 'STALE';
  }
  if (!isNseCashSessionOpen(now)) {
    return 'CLOSED_MARKET';
  }
  const age = now - quoteTimestampMs;
  if (age < 0) {
    // Clock skew: treat as stale rather than inventing LIVE.
    return 'STALE';
  }
  return age <= maxLiveAgeMs ? 'LIVE' : 'STALE';
}

/** Only LIVE quotes are candidates for live/PAPER entry decisions. */
export function isUsableForLiveTrading(status: DataFreshnessStatus): boolean {
  return status === 'LIVE';
}

/** Analysis / ML / EOD consumers may use CLOSED_MARKET; STALE is weak for both. */
export function isUsableForAnalysis(status: DataFreshnessStatus): boolean {
  return status === 'LIVE' || status === 'CLOSED_MARKET';
}

export function resolveActiveIngestMode(input: {
  liveProviderEnabled: boolean;
  simulatedLiveFeed: boolean;
}): IngestMode {
  if (input.liveProviderEnabled) return 'LIVE_INGEST';
  if (input.simulatedLiveFeed) return 'LIVE_INGEST';
  return 'EOD_INGEST';
}
