/**
 * Optional approved machine-readable futures feed (MCX/CME).
 * HTML / webpage payloads are rejected — never scrape.
 */

import type { CanonicalUniverseInstrument } from '../canonical-universe-registry';
import { commodityUniverseGate, futuresContractIdentity } from './commodity-futures';

export interface ApprovedFuturesFeedResult {
  ok: boolean;
  reasonCode?: string;
  detail: string;
  instruments: CanonicalUniverseInstrument[];
  rawRecordCount: number;
  rejectedCount: number;
  excludedCount: number;
}

interface FeedContract {
  symbol?: string;
  name?: string;
  underlying?: string;
  venue?: string;
  contractMonth?: string;
  expiry?: string;
  contractType?: string;
  contractMultiplier?: number;
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 256).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<head');
}

export function parseApprovedFuturesFeed(
  raw: string,
  universeId: 'MCX_FUTURES_ALL' | 'CME_FUTURES_ALL',
): ApprovedFuturesFeedResult {
  const gate = commodityUniverseGate(universeId);
  if (looksLikeHtml(raw)) {
    return {
      ok: false,
      reasonCode: 'SCRAPE_FORBIDDEN',
      detail: `${universeId}: payload looks like HTML. ${gate.detail}`,
      instruments: [],
      rawRecordCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      detail: `${universeId}: approved feed must be JSON (not CSV webpage). ${gate.detail}`,
      instruments: [],
      rawRecordCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
    };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { instruments?: unknown[] }).instruments)
      ? (parsed as { instruments: unknown[] }).instruments
      : Array.isArray((parsed as { contracts?: unknown[] }).contracts)
        ? (parsed as { contracts: unknown[] }).contracts
        : null;
  if (!rows) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      detail: `${universeId}: JSON must be an array or { instruments | contracts }.`,
      instruments: [],
      rawRecordCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
    };
  }
  const defaultVenue = universeId === 'MCX_FUTURES_ALL' ? 'MCX' : 'CME';
  const instruments: CanonicalUniverseInstrument[] = [];
  let rejectedCount = 0;
  const excludedCount = 0;
  for (const item of rows) {
    const row = (item ?? {}) as FeedContract;
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    const underlying = String(row.underlying ?? '')
      .trim()
      .toUpperCase();
    const venue = String(row.venue ?? defaultVenue)
      .trim()
      .toUpperCase();
    const identity = futuresContractIdentity({
      symbol,
      venue,
      underlying,
      contractMonth: row.contractMonth,
      expiry: row.expiry,
      contractType: row.contractType,
    });
    if (!symbol || !identity) {
      rejectedCount += 1;
      continue;
    }
    instruments.push({
      symbol,
      name: String(row.name ?? symbol).trim(),
      venue,
      series: 'FUT',
      isin: null,
      assetClass: 'COMMODITY_FUTURE',
      quoteCurrency: universeId === 'MCX_FUTURES_ALL' ? 'INR' : 'USD',
      underlying,
      expiry: row.expiry,
      contractMonth: row.contractMonth,
      contractMultiplier: row.contractMultiplier,
      provider: defaultVenue.toLowerCase(),
      providerAssetId: identity,
      contractType:
        String(row.contractType ?? 'MONTHLY').toUpperCase() === 'QUARTERLY'
          ? 'QUARTERLY'
          : 'MONTHLY',
      instrumentType: 'FUTURES_CONTRACT',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: 'approved_feed_contract',
    });
  }
  if (instruments.length === 0) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      detail: `${universeId}: approved feed had no valid contract identities.`,
      instruments: [],
      rawRecordCount: rows.length,
      rejectedCount,
      excludedCount,
    };
  }
  return {
    ok: true,
    detail: `${universeId}: ${instruments.length} contracts from approved feed`,
    instruments,
    rawRecordCount: rows.length,
    rejectedCount,
    excludedCount,
  };
}

export async function fetchApprovedFuturesFeed(
  universeId: 'MCX_FUTURES_ALL' | 'CME_FUTURES_ALL',
): Promise<ApprovedFuturesFeedResult> {
  const envKey =
    universeId === 'MCX_FUTURES_ALL' ? 'MCX_APPROVED_FEED_URL' : 'CME_APPROVED_FEED_URL';
  const url = String(process.env[envKey] ?? '').trim();
  const gate = commodityUniverseGate(universeId);
  if (!url) {
    return {
      ok: false,
      reasonCode: gate.reasonCode,
      detail: `${envKey} unset. ${gate.detail}`,
      instruments: [],
      rawRecordCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
    };
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'stockpred-universe-ingest/1.0',
    },
  });
  if (!response.ok) {
    return {
      ok: false,
      reasonCode: 'UNIVERSE_REFRESH_FAILED',
      detail: `${universeId}: ${envKey} HTTP ${response.status}`,
      instruments: [],
      rawRecordCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
    };
  }
  const text = await response.text();
  return parseApprovedFuturesFeed(text, universeId);
}
