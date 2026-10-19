/**
 * Canonical observed current-session 1D return.
 * DO NOT use for historical / walk-forward / training features — use periodReturn on
 * timestamp-valid closes instead. Prediction horizon "1D" is unrelated.
 *
 * Audit (2026-09-15):
 * - Sector: WAS bar periodReturn(closes,1) → ADOPT (current-session observed)
 * - Batch / Market Overview / quotes: StockQuote.changePercent (LTP vs previousClose) → ALIGN
 * - TradePlan expected return / Prediction / Bull-Run horizons "1D" → DO NOT ADOPT (forward)
 * - Historical intelligence / manipulation / walk-forward → KEEP periodReturn (historical)
 * - Continuous refresh: freshness only → no return calc change
 */
import type {
  CurrentSessionReturn1d,
  SessionReturn1dSource,
  SessionReturn1dStatus,
} from '@stockpred/shared-types';
import {
  classifyQuoteStatus,
  DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
  isNseCashSessionOpen,
} from '../market-hours';
import { round4 } from './b9-b17-helpers';

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

export function istSessionDate(ms: number): string {
  return IST_DATE.format(new Date(ms));
}

export interface SessionReturn1dInput {
  /** Daily candles oldest→newest; may include evolving today tip. */
  candles: Array<{ close?: number; time?: number } | null | undefined>;
  /** Live last traded price when available. */
  lastPrice?: number | null;
  /** Prior completed session close from quote/provider when known. */
  previousClose?: number | null;
  /** Quote / last-tick timestamp (ms). */
  quoteUpdatedAt?: number | null;
  now?: number;
  analysisAt?: number | string;
  /** Max age for usable LIVE/DELAYED LTP during open session (default Risk ceiling). */
  maxLiveAgeMs?: number;
}

function finitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Strip trailing flat phantom tip (holiday/pre-open close == prior close). */
export function stripFlatPhantomTip(
  candles: Array<{ close?: number; time?: number } | null | undefined>,
): Array<{ close: number; time?: number }> {
  const rows: Array<{ close: number; time?: number }> = [];
  for (const c of candles) {
    if (!c || !finitePositive(c.close)) continue;
    rows.push({ close: c.close, time: typeof c.time === 'number' ? c.time : undefined });
  }
  while (rows.length >= 2) {
    const a = rows[rows.length - 1];
    const b = rows[rows.length - 2];
    if (Math.abs(a.close - b.close) / b.close < 1e-9) {
      rows.pop();
      continue;
    }
    break;
  }
  return rows;
}

function mapQuoteToSessionStatus(
  status: ReturnType<typeof classifyQuoteStatus>,
): SessionReturn1dStatus {
  if (status === 'LIVE') return 'LIVE';
  if (status === 'DELAYED') return 'DELAYED';
  if (status === 'CLOSED_MARKET') return 'CLOSED_MARKET';
  if (status === 'STALE') return 'STALE';
  return 'UNKNOWN';
}

/**
 * Observed current-session 1D = effectivePrice / referenceClose - 1.
 * Never invents LIVE 0% for a holiday tip stamped at previous close.
 */
export function computeCurrentSessionReturn1d(input: SessionReturn1dInput): CurrentSessionReturn1d {
  const now = input.now ?? Date.now();
  const analysisAt = input.analysisAt ?? new Date(now).toISOString();
  const maxLiveAgeMs = input.maxLiveAgeMs ?? DEFAULT_LIVE_QUOTE_MAX_AGE_MS;
  const empty = (
    dataStatus: SessionReturn1dStatus,
    source: SessionReturn1dSource = 'NONE',
  ): CurrentSessionReturn1d => ({
    return1d: null,
    referenceClose: null,
    effectivePrice: null,
    sessionDate: null,
    dataStatus,
    source,
    dataAsOf: null,
    receivedAt: input.quoteUpdatedAt ?? null,
    analysisAt,
  });

  const stripped = stripFlatPhantomTip(input.candles);
  if (stripped.length < 1) return empty('UNAVAILABLE');

  const tip = stripped[stripped.length - 1];
  const tipDate = tip.time != null ? istSessionDate(tip.time) : null;
  const todayIst = istSessionDate(now);
  const sessionOpen = isNseCashSessionOpen(now);

  const quoteTs =
    input.quoteUpdatedAt != null &&
    Number.isFinite(input.quoteUpdatedAt) &&
    input.quoteUpdatedAt > 0
      ? input.quoteUpdatedAt
      : null;
  const quoteStatus = classifyQuoteStatus(quoteTs, now, maxLiveAgeMs);
  const liveUsable =
    sessionOpen &&
    (quoteStatus === 'LIVE' || quoteStatus === 'DELAYED') &&
    finitePositive(input.lastPrice);

  let referenceClose: number | null = finitePositive(input.previousClose)
    ? input.previousClose
    : null;

  // If tip is today's bar (or live), reference is prior bar / previousClose.
  const tipIsToday = tipDate != null && tipDate === todayIst;
  const tipIsPriorCalendarDay = tipDate != null && tipDate < todayIst;
  if (referenceClose == null) {
    if (stripped.length >= 2 && (tipIsToday || liveUsable)) {
      referenceClose = stripped[stripped.length - 2].close;
    } else if (stripped.length >= 2) {
      // Prior session: last completed move = tip vs prior tip after phantom strip.
      referenceClose = stripped[stripped.length - 2].close;
    }
  }

  if (!finitePositive(referenceClose)) return empty('UNAVAILABLE');

  const flatVsRef =
    finitePositive(input.lastPrice) &&
    Math.abs(input.lastPrice - referenceClose) / referenceClose < 1e-9;

  // --- Live LTP path ---
  // Weekday clock does not know NSE holidays: a flat print with tip still on a prior
  // calendar day must not be advertised as LIVE 0% "today".
  if (liveUsable && finitePositive(input.lastPrice) && !(flatVsRef && tipIsPriorCalendarDay)) {
    const effectivePrice = input.lastPrice;
    const return1d = round4(effectivePrice / referenceClose - 1);
    return {
      return1d,
      referenceClose,
      effectivePrice,
      sessionDate: todayIst,
      dataStatus: mapQuoteToSessionStatus(quoteStatus),
      source: 'LIVE_LTP',
      dataAsOf: quoteTs,
      receivedAt: quoteTs,
      analysisAt,
    };
  }

  // --- Today's completed / evolving session close on tip ---
  if (tipIsToday && finitePositive(tip.close)) {
    // Flat tip vs reference after strip already removed pure phantoms; still avoid fake LIVE.
    const effectivePrice = tip.close;
    const return1d = round4(effectivePrice / referenceClose - 1);
    const dataStatus: SessionReturn1dStatus = sessionOpen
      ? quoteStatus === 'STALE'
        ? 'STALE'
        : 'DELAYED'
      : 'CLOSED_MARKET';
    return {
      return1d,
      referenceClose,
      effectivePrice,
      sessionDate: tipDate,
      dataStatus,
      source: 'SESSION_CLOSE',
      dataAsOf: tip.time ?? quoteTs,
      receivedAt: quoteTs,
      analysisAt,
    };
  }

  // --- Prior completed session (weekend / holiday / pre-open) ---
  if (stripped.length >= 2) {
    const effectivePrice = tip.close;
    const ref = stripped[stripped.length - 2].close;
    const return1d = round4(effectivePrice / ref - 1);
    return {
      return1d,
      referenceClose: ref,
      effectivePrice,
      sessionDate: tipDate,
      dataStatus: 'PRIOR_SESSION',
      source: 'PRIOR_SESSION',
      dataAsOf: tip.time ?? null,
      receivedAt: quoteTs,
      analysisAt,
    };
  }

  return empty('UNAVAILABLE');
}

/** Percent form used by StockQuote.changePercent (aligned with MDS toQuote). */
export function sessionReturn1dToPercent(return1d: number | null): number {
  if (return1d == null || !Number.isFinite(return1d)) return 0;
  return Math.round(return1d * 10_000) / 100;
}
