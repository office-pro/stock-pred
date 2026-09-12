/** NSE regular session in Asia/Kolkata: weekdays 09:15–15:30. IST has no DST. */

import type { DataFreshnessStatus, IngestMode } from '@stockpred/shared-types';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const SESSION_OPEN_MIN = 9 * 60 + 15;
const SESSION_CLOSE_MIN = 15 * 60 + 30;

/** Default Risk / Gate quote-age ceiling — must stay aligned with risk-engine maxQuoteAgeMs. */
export const DEFAULT_LIVE_QUOTE_MAX_AGE_MS = 60_000;

/**
 * Quotes younger than this are labeled LIVE (fresh).
 * Between this and {@link DEFAULT_LIVE_QUOTE_MAX_AGE_MS} → DELAYED (not an auth state).
 */
export const DEFAULT_FRESH_QUOTE_MAX_AGE_MS = 30_000;

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
 * Does not replace the trading quote-age gate; it labels freshness for intel/ops.
 *
 * @param maxLiveAgeMs Risk ceiling (default 60s). Age above this → STALE.
 * @param freshMaxAgeMs Fresh band (default 30s). Age at/below → LIVE; between → DELAYED.
 */
export function classifyQuoteStatus(
  quoteTimestampMs: number | null | undefined,
  now = Date.now(),
  maxLiveAgeMs = DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
  freshMaxAgeMs = DEFAULT_FRESH_QUOTE_MAX_AGE_MS,
): DataFreshnessStatus {
  if (quoteTimestampMs == null || !Number.isFinite(quoteTimestampMs) || quoteTimestampMs <= 0) {
    return 'UNKNOWN';
  }
  if (!isNseCashSessionOpen(now)) {
    return 'CLOSED_MARKET';
  }
  const age = now - quoteTimestampMs;
  if (age < 0) {
    // Clock skew: treat as stale rather than inventing LIVE.
    return 'STALE';
  }
  if (age <= freshMaxAgeMs) return 'LIVE';
  if (age <= maxLiveAgeMs) return 'DELAYED';
  return 'STALE';
}

/**
 * Freshness alone does not block when status is LIVE or DELAYED
 * (age ≤ existing Risk maxQuoteAgeMs). Not an authorization API —
 * Risk / Portfolio / Policy / Gate still decide execution.
 */
export function isUsableForLiveTrading(status: DataFreshnessStatus): boolean {
  return status === 'LIVE' || status === 'DELAYED';
}

/** Analysis / ML / EOD / delayed consumers — STALE/UNKNOWN stay labeled, not neutralized. */
export function isUsableForAnalysis(status: DataFreshnessStatus): boolean {
  return (
    status === 'LIVE' ||
    status === 'DELAYED' ||
    status === 'CLOSED_MARKET' ||
    status === 'STALE' ||
    status === 'UNKNOWN'
  );
}

export function resolveActiveIngestMode(input: {
  liveProviderEnabled: boolean;
  simulatedLiveFeed: boolean;
}): IngestMode {
  if (input.liveProviderEnabled) return 'LIVE_INGEST';
  if (input.simulatedLiveFeed) return 'LIVE_INGEST';
  return 'EOD_INGEST';
}
