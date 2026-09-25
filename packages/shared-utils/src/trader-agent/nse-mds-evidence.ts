/**
 * NSE/BSE MDS panel overlay for batch hydrate.
 * Coverage capability remains `fundamentals`. EQUITY_STATEMENTS only when
 * revenue | netIncome | roe exists (same gate as SEC parseCompanyFacts).
 * Join via instrumentIdentityKey — never a bare ticker.
 */

import type {
  BatchInstrumentData,
  EquityStatementsPayload,
  FundamentalPayload,
  InstrumentRef,
} from '@stockpred/shared-types';
import { sanitizeFundamentalPayload } from '@stockpred/shared-types';
import { instrumentIdentityKey } from './instrument-registry';
import { unavailableEquityFacts } from './sec-edgar-client';

export const MDS_FUNDAMENTALS_MISSING = 'MDS_FUNDAMENTALS_MISSING';
export const MDS_FUNDAMENTALS_PANEL_ERROR = 'MDS_FUNDAMENTALS_PANEL_ERROR';
export const MDS_NEWS_PANEL_ERROR = 'MDS_NEWS_PANEL_ERROR';

export interface NseMdsFundamentalsPanelRow {
  symbol?: string;
  trailing_pe?: number | null;
  price_to_book?: number | null;
  roe?: number | null;
  revenue?: number | null;
  pat?: number | null;
  as_of_date?: string | null;
  available_at?: string | null;
  source?: string | null;
}

export interface NseMdsNewsPanelRow {
  symbol?: string;
  news_count_7d?: number | null;
  news_sent_7d?: number | null;
  as_of_date?: string | null;
  available_at?: string | null;
  source?: string | null;
}

export interface NseMdsEvidenceInput {
  fundamentalsRows?: NseMdsFundamentalsPanelRow[];
  newsRows?: NseMdsNewsPanelRow[];
  fundamentalsUnavailableReason?: string;
  newsUnavailableReason?: string;
}

export function finitePanelNum(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

export function isIndianCashEquityRef(ref: InstrumentRef): boolean {
  const assetClass = String(ref.assetClass ?? '').toUpperCase();
  const venue = String(ref.venue ?? '').toUpperCase();
  return (assetClass === 'EQUITY' || assetClass === 'ETF') && (venue === 'NSE' || venue === 'BSE');
}

export function hasEquityStatementsGate(row: NseMdsFundamentalsPanelRow | undefined): boolean {
  if (!row) return false;
  return (
    finitePanelNum(row.revenue) != null ||
    finitePanelNum(row.pat) != null ||
    finitePanelNum(row.roe) != null
  );
}

export function parsePanelAsOf(
  ...values: Array<string | number | null | undefined>
): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return undefined;
}

export function indexLatestPanelBySymbol<T extends { symbol?: string }>(
  rows: T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows ?? []) {
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (symbol) map.set(symbol, row);
  }
  return map;
}

export function indexPanelByInstrumentIdentity<T extends { symbol?: string }>(
  instruments: InstrumentRef[],
  rows: T[] | undefined,
): Map<string, T> {
  const bySymbol = indexLatestPanelBySymbol(rows);
  const out = new Map<string, T>();
  for (const ref of instruments) {
    if (!isIndianCashEquityRef(ref)) continue;
    const hit = bySymbol.get(
      String(ref.symbol ?? '')
        .trim()
        .toUpperCase(),
    );
    if (!hit) continue;
    out.set(instrumentIdentityKey(ref), hit);
  }
  return out;
}

export function payloadFromNseFundamentalsPanel(
  row: NseMdsFundamentalsPanelRow | undefined,
  reason = MDS_FUNDAMENTALS_MISSING,
): FundamentalPayload {
  if (!hasEquityStatementsGate(row)) {
    return unavailableEquityFacts(
      reason,
      reason === MDS_FUNDAMENTALS_PANEL_ERROR
        ? 'MDS fundamentals panel failed'
        : 'Panel row lacks revenue, netIncome, or roe',
    );
  }
  const payload: EquityStatementsPayload = { kind: 'EQUITY_STATEMENTS' };
  const pe = finitePanelNum(row!.trailing_pe);
  const pb = finitePanelNum(row!.price_to_book);
  const roe = finitePanelNum(row!.roe);
  const revenue = finitePanelNum(row!.revenue);
  const netIncome = finitePanelNum(row!.pat);
  const asOf = parsePanelAsOf(row!.as_of_date, row!.available_at);
  if (pe != null) payload.pe = pe;
  if (pb != null) payload.pb = pb;
  if (roe != null) payload.roe = roe;
  if (revenue != null) payload.revenue = revenue;
  if (netIncome != null) payload.netIncome = netIncome;
  if (asOf != null) payload.asOf = asOf;
  return payload;
}

export function overlayNseMdsEvidence(
  rows: BatchInstrumentData[],
  input: NseMdsEvidenceInput | undefined,
): BatchInstrumentData[] {
  if (!input) return rows;
  const instruments = rows.map((row) => row.instrumentRef);
  const fundamentalsByKey = indexPanelByInstrumentIdentity(instruments, input.fundamentalsRows);
  const newsByKey = indexPanelByInstrumentIdentity(instruments, input.newsRows);
  return rows.map((row) => {
    if (!isIndianCashEquityRef(row.instrumentRef)) return row;
    const key = instrumentIdentityKey(row.instrumentRef);
    const fundRow = fundamentalsByKey.get(key);
    const newsRow = newsByKey.get(key);
    const fundamentals = sanitizeFundamentalPayload(
      row.instrumentRef.assetClass,
      payloadFromNseFundamentalsPanel(fundRow, input.fundamentalsUnavailableReason),
    );
    const newsAsOf = parsePanelAsOf(newsRow?.as_of_date, newsRow?.available_at);
    const count = finitePanelNum(newsRow?.news_count_7d);
    const sent = finitePanelNum(newsRow?.news_sent_7d);
    const newsReason =
      !newsRow && input.newsUnavailableReason
        ? input.newsUnavailableReason
        : count == null || count <= 0
          ? 'NO_NEWS'
          : undefined;
    return {
      ...row,
      fundamentals,
      news: {
        source: 'SOURCE_REPORTED',
        headlineCount: count != null && count > 0 ? count : 0,
        ...(newsAsOf != null ? { asOf: newsAsOf } : {}),
        ...(newsReason ? { reasonCode: newsReason } : {}),
      },
      sentiment: sent != null ? { source: 'MODEL_DERIVED', score: sent } : null,
    };
  });
}
