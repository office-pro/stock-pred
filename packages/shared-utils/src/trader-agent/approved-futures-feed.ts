/**
 * F3 — approved machine-readable MCX/CME futures feeds.
 * HTML / webpage payloads are rejected — never scrape.
 * FUTURES_ALL stays unsupported.
 */
import type {
  BatchCandle,
  BatchQuote,
  InstrumentRef,
  MarketSessionState,
  MarketSessionStatus,
} from '@stockpred/shared-types';
import { buildExchangeFuturesSession } from './market-session-state';

export type ApprovedFuturesUniverse = 'MCX_FUTURES_ALL' | 'CME_FUTURES_ALL';

export interface ApprovedFuturesContract {
  instrumentRef: InstrumentRef;
  providerAssetId: string;
  quote?: BatchQuote;
  candles?: BatchCandle[];
  asOf?: number;
  delayed?: boolean;
}

export interface ApprovedFuturesFeedResult {
  ok: boolean;
  universeId: ApprovedFuturesUniverse;
  reasonCode?: string;
  detail: string;
  contracts: ApprovedFuturesContract[];
  session?: MarketSessionState;
  rawRecordCount: number;
  rejectedCount: number;
}

export function isApprovedFuturesUniverse(
  universeId: string,
): universeId is ApprovedFuturesUniverse {
  const id = String(universeId ?? '').toUpperCase();
  return id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL';
}

export function approvedFeedEnvKey(
  universeId: string,
): 'MCX_APPROVED_FEED_URL' | 'CME_APPROVED_FEED_URL' | null {
  const id = String(universeId ?? '').toUpperCase();
  if (id === 'MCX_FUTURES_ALL') return 'MCX_APPROVED_FEED_URL';
  if (id === 'CME_FUTURES_ALL') return 'CME_APPROVED_FEED_URL';
  return null;
}

export function approvedFeedUrlForUniverse(
  universeId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = approvedFeedEnvKey(universeId);
  if (!key) return null;
  const url = String(env[key] ?? '').trim();
  return url || null;
}

export function looksLikeHtml(text: string): boolean {
  const head = String(text ?? '')
    .slice(0, 256)
    .toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<head');
}

export function futuresContractIdentity(input: {
  symbol: string;
  venue?: string;
  underlying?: string;
  contractMonth?: string;
  expiry?: string;
  contractType?: string;
}): string | null {
  const underlying = String(input.underlying ?? '').trim();
  const venue = String(input.venue ?? '').trim();
  const month = String(input.contractMonth ?? input.expiry ?? '').trim();
  const contractType = String(input.contractType ?? '').trim();
  if (!underlying || !venue) return null;
  if (!month && contractType.toUpperCase() !== 'PERPETUAL') return null;
  return `${venue}|${underlying}|${contractType || month}|${month}|${input.symbol}`.toUpperCase();
}

function asContractType(raw: unknown): InstrumentRef['contractType'] {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (
    value === 'PERPETUAL' ||
    value === 'MONTHLY' ||
    value === 'QUARTERLY' ||
    value === 'PRODUCT'
  ) {
    return value;
  }
  return undefined;
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseCandles(raw: unknown): BatchCandle[] {
  if (!Array.isArray(raw)) return [];
  const out: BatchCandle[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const time = asNum(rec.time) ?? asNum(rec.t);
    const open = asNum(rec.open) ?? asNum(rec.o);
    const high = asNum(rec.high) ?? asNum(rec.h);
    const low = asNum(rec.low) ?? asNum(rec.l);
    const close = asNum(rec.close) ?? asNum(rec.c);
    const volume = asNum(rec.volume) ?? asNum(rec.v);
    if (time == null || open == null || high == null || low == null || close == null) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function parseQuote(raw: unknown): BatchQuote | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const price = asNum(rec.price) ?? asNum(rec.last) ?? asNum(rec.close);
  if (price == null || price <= 0) return undefined;
  return {
    price,
    change: asNum(rec.change),
    changePercent: asNum(rec.changePercent),
    volume: asNum(rec.volume),
    dayHigh: asNum(rec.dayHigh) ?? asNum(rec.high),
    dayLow: asNum(rec.dayLow) ?? asNum(rec.low),
    previousClose: asNum(rec.previousClose),
  };
}

function expectedVenue(universeId: ApprovedFuturesUniverse): 'MCX' | 'CME' {
  return universeId === 'MCX_FUTURES_ALL' ? 'MCX' : 'CME';
}

export function parseApprovedFuturesHydrateFeed(
  raw: string,
  universeId: ApprovedFuturesUniverse,
  now = Date.now(),
): ApprovedFuturesFeedResult {
  if (looksLikeHtml(raw)) {
    return {
      ok: false,
      universeId,
      reasonCode: 'SCRAPE_FORBIDDEN',
      detail: `${universeId}: payload looks like HTML. Do not scrape delayed webpages.`,
      contracts: [],
      rawRecordCount: 0,
      rejectedCount: 0,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      universeId,
      reasonCode: 'UNSUPPORTED_FEED',
      detail: `${universeId}: approved feed must be JSON.`,
      contracts: [],
      rawRecordCount: 0,
      rejectedCount: 0,
    };
  }
  const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(rec.instruments)
      ? rec.instruments
      : Array.isArray(rec.contracts)
        ? rec.contracts
        : null;
  if (!rows) {
    return {
      ok: false,
      universeId,
      reasonCode: 'UNSUPPORTED_FEED',
      detail: `${universeId}: JSON must be an array or { instruments | contracts }.`,
      contracts: [],
      rawRecordCount: 0,
      rejectedCount: 0,
    };
  }
  const venue = expectedVenue(universeId);
  const contracts: ApprovedFuturesContract[] = [];
  let rejectedCount = 0;
  for (const item of rows) {
    const row = (item ?? {}) as Record<string, unknown>;
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    const underlying = String(row.underlying ?? '')
      .trim()
      .toUpperCase();
    const rowVenue = String(row.venue ?? venue)
      .trim()
      .toUpperCase();
    if (rowVenue !== venue) {
      rejectedCount += 1;
      continue;
    }
    const identity = futuresContractIdentity({
      symbol,
      venue: rowVenue,
      underlying,
      contractMonth: row.contractMonth != null ? String(row.contractMonth) : undefined,
      expiry: row.expiry != null ? String(row.expiry) : undefined,
      contractType: row.contractType != null ? String(row.contractType) : undefined,
    });
    if (!symbol || !identity) {
      rejectedCount += 1;
      continue;
    }
    const quote = parseQuote(row.quote);
    const candles = parseCandles(row.candles);
    const asOf =
      asNum(row.asOf) ??
      asNum(
        row.quote && typeof row.quote === 'object'
          ? (row.quote as { asOf?: unknown }).asOf
          : undefined,
      );
    contracts.push({
      instrumentRef: {
        symbol,
        assetClass: 'COMMODITY_FUTURE',
        venue: rowVenue,
        quoteCurrency: universeId === 'MCX_FUTURES_ALL' ? 'INR' : 'USD',
        canonicalSymbol: symbol,
        providerAssetId: identity,
        underlying: underlying || undefined,
        contractType: asContractType(row.contractType),
        expiry: row.expiry != null ? String(row.expiry) : undefined,
        contractMonth: row.contractMonth != null ? String(row.contractMonth) : undefined,
      },
      providerAssetId: identity,
      ...(quote ? { quote } : {}),
      ...(candles.length ? { candles } : {}),
      ...(asOf != null ? { asOf } : {}),
      delayed: row.delayed === true || String(row.dataStatus ?? '').toUpperCase() === 'DELAYED',
    });
  }
  if (contracts.length === 0) {
    return {
      ok: false,
      universeId,
      reasonCode: 'NO_VALID_CONTRACTS',
      detail: `${universeId}: approved feed had no valid contract identities.`,
      contracts: [],
      rawRecordCount: rows.length,
      rejectedCount,
    };
  }
  const feedSession =
    rec.session && typeof rec.session === 'object'
      ? (rec.session as Record<string, unknown>)
      : undefined;
  const last = contracts.map((c) => c.asOf).find((n) => n != null) ?? null;
  const session = buildExchangeFuturesSession({
    venue,
    now,
    lastMarketUpdateAt: last,
    feedStatus:
      typeof feedSession?.status === 'string'
        ? (feedSession.status as MarketSessionStatus)
        : undefined,
    delayed: contracts.some((c) => c.delayed),
  });
  return {
    ok: true,
    universeId,
    detail: `${universeId}: ${contracts.length} contracts from approved feed`,
    contracts,
    session,
    rawRecordCount: rows.length,
    rejectedCount,
  };
}

export async function discoverApprovedFuturesFeed(
  universeId: string,
  deps: {
    approvedFuturesFeedUrl?: string;
    approvedFuturesFeedBody?: string;
    fetchText?: (url: string) => Promise<string>;
    env?: NodeJS.ProcessEnv;
    now?: number;
  } = {},
): Promise<ApprovedFuturesFeedResult | null> {
  if (!isApprovedFuturesUniverse(universeId)) return null;
  const body = deps.approvedFuturesFeedBody;
  if (body != null) {
    return parseApprovedFuturesHydrateFeed(body, universeId, deps.now);
  }
  const url = String(
    deps.approvedFuturesFeedUrl ?? approvedFeedUrlForUniverse(universeId, deps.env) ?? '',
  ).trim();
  if (!url) return null;
  const fetchText =
    deps.fetchText ??
    (async (target: string) => {
      const res = await fetch(target, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'stockpred-batch-hydrate/1.0',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  try {
    const text = await fetchText(url);
    return parseApprovedFuturesHydrateFeed(text, universeId, deps.now);
  } catch (error) {
    return {
      ok: false,
      universeId,
      reasonCode: 'UNIVERSE_REFRESH_FAILED',
      detail: `${universeId}: approved feed fetch failed (${error instanceof Error ? error.message : String(error)})`,
      contracts: [],
      rawRecordCount: 0,
      rejectedCount: 0,
    };
  }
}
