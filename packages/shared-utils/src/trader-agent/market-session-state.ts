/**
 * Backend MarketSessionState — FE must consume this, not clock-infer OPEN/CLOSED.
 * Separate from MultiAssetDataStatus and universe membership.
 */

import type {
  AssetClass,
  MarketSessionState,
  MarketSessionStatus,
  MultiAssetDataStatus,
  VenueId,
} from '@stockpred/shared-types';
import {
  classifyQuoteStatus,
  isNseCashSessionOpen,
  DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
  DEFAULT_FRESH_QUOTE_MAX_AGE_MS,
} from '../market-hours';

const IST = 'Asia/Kolkata';
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: IST });

function sessionDateIst(now: number): string {
  return IST_DATE.format(new Date(now));
}

function mapNseSessionStatus(now: number): MarketSessionStatus {
  if (!isNseCashSessionOpen(now)) {
    // Coarse CLOSED — holidays not calendared here; UNKNOWN only when clocks fail.
    const ist = new Date(now + (5 * 60 + 30) * 60 * 1000);
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const weekday = ist.getUTCDay();
    if (weekday === 0 || weekday === 6) return 'CLOSED';
    if (minutes < 9 * 60 + 15 && minutes >= 9 * 60) return 'PRE_OPEN';
    if (minutes > 15 * 60 + 30 && minutes < 16 * 60) return 'POST_CLOSE';
    return 'CLOSED';
  }
  return 'OPEN';
}

function freshnessToMultiAsset(
  status: ReturnType<typeof classifyQuoteStatus>,
): MultiAssetDataStatus {
  if (status === 'LIVE') return 'LIVE';
  if (status === 'DELAYED') return 'DELAYED';
  if (status === 'STALE') return 'STALE';
  if (status === 'CLOSED_MARKET') return 'HISTORICAL';
  if (status === 'UNKNOWN') return 'UNKNOWN';
  return 'OFFLINE';
}

export function buildNseMarketSessionState(input?: {
  now?: number;
  lastMarketUpdateAt?: number | null;
  source?: string;
}): MarketSessionState {
  const now = input?.now ?? Date.now();
  const status = mapNseSessionStatus(now);
  const last = input?.lastMarketUpdateAt ?? null;
  const quoteStatus = classifyQuoteStatus(last, now);
  const dataStatus = freshnessToMultiAsset(quoteStatus);
  const isOpen = status === 'OPEN';
  const ageMs = last != null && Number.isFinite(last) ? Math.max(0, now - last) : null;
  const isLive =
    isOpen &&
    (dataStatus === 'LIVE' || dataStatus === 'DELAYED') &&
    ageMs != null &&
    ageMs <= DEFAULT_LIVE_QUOTE_MAX_AGE_MS;

  return {
    venue: 'NSE',
    assetClass: 'EQUITY',
    status,
    timezone: IST,
    sessionDate: sessionDateIst(now),
    isLive,
    isTradable: isOpen && isLive,
    lastMarketUpdateAt: last,
    dataAsOf: last,
    dataAgeMs: ageMs,
    source: input?.source ?? 'market-data-service',
    dataStatus: isOpen ? dataStatus : dataStatus === 'LIVE' ? 'HISTORICAL' : dataStatus,
  };
}

/** Closed markets must never report LIVE. */
export function sanitizeSessionLiveConsistency(state: MarketSessionState): MarketSessionState {
  if (state.status !== 'OPEN' && (state.isLive || state.dataStatus === 'LIVE')) {
    return {
      ...state,
      isLive: false,
      isTradable: false,
      dataStatus: state.dataStatus === 'LIVE' ? 'HISTORICAL' : state.dataStatus,
    };
  }
  return state;
}

export function buildCommodityMarketSessionState(input?: {
  now?: number;
  lastMarketUpdateAt?: number | null;
  source?: string;
}): MarketSessionState {
  const now = input?.now ?? Date.now();
  const last = input?.lastMarketUpdateAt ?? null;
  const ageMs = last != null && Number.isFinite(last) ? Math.max(0, now - last) : null;
  return {
    venue: 'ALPHA_VANTAGE',
    assetClass: 'COMMODITY',
    status: 'CLOSED',
    timezone: 'UTC',
    sessionDate: new Date(now).toISOString().slice(0, 10),
    isLive: false,
    isTradable: false,
    lastMarketUpdateAt: last,
    dataAsOf: last,
    dataAgeMs: ageMs,
    source: input?.source ?? 'mds:commodity',
    dataStatus: last != null ? 'HISTORICAL' : 'MISSING',
  };
}

export function buildCryptoMarketSessionState(input?: {
  now?: number;
  lastMarketUpdateAt?: number | null;
  source?: string;
  venue?: VenueId;
  assetClass?: AssetClass;
  freshMaxAgeMs?: number;
  maxLiveAgeMs?: number;
}): MarketSessionState {
  const now = input?.now ?? Date.now();
  const last = input?.lastMarketUpdateAt ?? null;
  const quoteStatus = classifyQuoteStatus(
    last,
    now,
    input?.maxLiveAgeMs ?? DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
    input?.freshMaxAgeMs ?? DEFAULT_FRESH_QUOTE_MAX_AGE_MS,
    { alwaysOpen: true },
  );
  const dataStatus = freshnessToMultiAsset(quoteStatus);
  const ageMs = last != null && Number.isFinite(last) ? Math.max(0, now - last) : null;
  return {
    venue: input?.venue ?? 'BINANCE',
    assetClass: input?.assetClass ?? 'CRYPTO_SPOT',
    status: 'OPEN',
    timezone: 'UTC',
    sessionDate: new Date(now).toISOString().slice(0, 10),
    isLive: dataStatus === 'LIVE' || dataStatus === 'DELAYED',
    isTradable: false,
    lastMarketUpdateAt: last,
    dataAsOf: last,
    dataAgeMs: ageMs,
    source: input?.source ?? 'mds:crypto',
    dataStatus,
  };
}

export function buildMarketsSessionCard(input: {
  nse?: MarketSessionState;
  us?: MarketSessionState | null;
  crypto?: MarketSessionState | null;
  futures?: MarketSessionState | null;
}): Array<{
  venue: string;
  status: MarketSessionStatus;
  liveLabel: string;
  dataAsOf?: number | null;
  dataAgeMs?: number | null;
  source?: string;
  dataStatus?: MultiAssetDataStatus;
}> {
  const rows: Array<{
    key: string;
    state: MarketSessionState | null | undefined;
    defaultVenue: VenueId;
    defaultAsset: AssetClass;
  }> = [
    { key: 'NSE', state: input.nse, defaultVenue: 'NSE', defaultAsset: 'EQUITY' },
    { key: 'US', state: input.us, defaultVenue: 'NYSE', defaultAsset: 'EQUITY' },
    { key: 'Crypto', state: input.crypto, defaultVenue: 'CRYPTO', defaultAsset: 'CRYPTO_SPOT' },
    {
      key: 'Futures',
      state: input.futures,
      defaultVenue: 'NSE_FO',
      defaultAsset: 'INDEX_FUTURE',
    },
  ];
  return rows.map((r) => {
    if (!r.state) {
      return {
        venue: r.key,
        status: 'UNKNOWN' as MarketSessionStatus,
        liveLabel: 'Not available',
        dataStatus: 'MISSING' as MultiAssetDataStatus,
      };
    }
    const s = sanitizeSessionLiveConsistency(r.state);
    const liveLabel =
      s.status === 'OPEN'
        ? s.isLive
          ? 'OPEN • LIVE'
          : `OPEN • ${s.dataStatus ?? 'UNKNOWN'}`
        : String(s.status);
    return {
      venue: r.key,
      status: s.status,
      liveLabel,
      dataAsOf: s.dataAsOf,
      dataAgeMs: s.dataAgeMs,
      source: s.source,
      dataStatus: s.dataStatus,
    };
  });
}

export function buildExchangeFuturesSession(input: {
  venue: 'MCX' | 'CME';
  now?: number;
  lastMarketUpdateAt?: number | null;
  feedStatus?: MarketSessionStatus;
  delayed?: boolean;
  source?: string;
}): MarketSessionState {
  const now = input.now ?? Date.now();
  const last = input.lastMarketUpdateAt ?? null;
  const ageMs = last != null && Number.isFinite(last) ? Math.max(0, now - last) : null;
  const timezone = input.venue === 'MCX' ? IST : 'America/Chicago';
  const status = input.feedStatus ?? coarseFuturesSessionStatus(input.venue, now);
  const quoteStatus = classifyQuoteStatus(
    last,
    now,
    DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
    DEFAULT_FRESH_QUOTE_MAX_AGE_MS,
    { alwaysOpen: true },
  );
  let dataStatus = freshnessToMultiAsset(quoteStatus);
  if (input.delayed && last != null && dataStatus !== 'MISSING') {
    dataStatus = 'DELAYED';
  }
  const isOpen = status === 'OPEN';
  const isLive = isOpen && (dataStatus === 'LIVE' || dataStatus === 'DELAYED');
  return sanitizeSessionLiveConsistency({
    venue: input.venue,
    assetClass: 'COMMODITY_FUTURE',
    status,
    timezone,
    sessionDate:
      input.venue === 'MCX'
        ? sessionDateIst(now)
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now)),
    isLive,
    isTradable: false,
    lastMarketUpdateAt: last,
    dataAsOf: last,
    dataAgeMs: ageMs,
    source: input.source ?? `approved-feed:${input.venue.toLowerCase()}`,
    dataStatus: last != null ? dataStatus : 'MISSING',
  });
}

function coarseFuturesSessionStatus(venue: 'MCX' | 'CME', now: number): MarketSessionStatus {
  if (venue === 'MCX') {
    const ist = new Date(now + (5 * 60 + 30) * 60 * 1000);
    const weekday = ist.getUTCDay();
    if (weekday === 0 || weekday === 6) return 'CLOSED';
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (minutes >= 9 * 60 && minutes <= 23 * 60 + 30) return 'OPEN';
    return 'CLOSED';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutes = hour * 60 + minute;
  if (weekday === 'Sat') return 'CLOSED';
  if (weekday === 'Fri' && minutes >= 16 * 60) return 'CLOSED';
  if (weekday === 'Sun' && minutes < 17 * 60) return 'CLOSED';
  if (minutes >= 16 * 60 && minutes < 17 * 60) return 'CLOSED';
  return 'OPEN';
}

export { DEFAULT_LIVE_QUOTE_MAX_AGE_MS, DEFAULT_FRESH_QUOTE_MAX_AGE_MS };
