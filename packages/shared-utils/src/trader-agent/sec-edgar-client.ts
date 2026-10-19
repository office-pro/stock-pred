/**
 * Keyless SEC EDGAR companyfacts. Ticker → CIK is identity enrichment only —
 * never universe membership (US_ALL stays NASDAQ Trader).
 */

import type {
  EquityStatementsPayload,
  FundamentalPayload,
  InstrumentRef,
} from '@stockpred/shared-types';

export const SEC_EDGAR_USER_AGENT = 'stockpred research contact@example.com';
export const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_COMPANYFACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts';

export const US_EQUITY_VENUES = new Set([
  'NASDAQ',
  'NYSE',
  'AMEX',
  'NYSE_ARCA',
  'BATS',
  'IEX',
  'US',
]);

export type SecFetchJson = (url: string) => Promise<unknown>;

export interface SecTickerRow {
  cik_str?: number | string;
  ticker?: string;
  title?: string;
}

export interface SecCikMatch {
  cik: string;
  ticker: string;
  title?: string;
}

const REVENUE_TAGS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
];
const NET_INCOME_TAGS = [
  'NetIncomeLoss',
  'ProfitLoss',
  'NetIncomeLossAvailableToCommonStockholdersBasic',
];
const ROE_TAGS = ['ReturnOnEquity', 'ReturnOnAverageEquity'];

export function isUsListedEquity(ref: Pick<InstrumentRef, 'assetClass' | 'venue'>): boolean {
  if (String(ref.assetClass ?? '').toUpperCase() !== 'EQUITY') return false;
  return US_EQUITY_VENUES.has(
    String(ref.venue ?? '')
      .trim()
      .toUpperCase(),
  );
}

export function padSecCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, '');
  return digits.padStart(10, '0');
}

export function companyFactsUrl(cik: string): string {
  return `${SEC_COMPANYFACTS_BASE}/CIK${padSecCik(cik)}.json`;
}

export async function defaultSecFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': SEC_EDGAR_USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  return res.json();
}

export function parseCompanyTickers(raw: unknown): Map<string, SecCikMatch> {
  const map = new Map<string, SecCikMatch>();
  if (!raw || typeof raw !== 'object') return map;
  for (const row of Object.values(raw as Record<string, SecTickerRow>)) {
    const ticker = String(row?.ticker ?? '')
      .trim()
      .toUpperCase();
    if (!ticker || row?.cik_str == null) continue;
    map.set(ticker, {
      cik: padSecCik(row.cik_str),
      ticker,
      title: row.title ? String(row.title) : undefined,
    });
  }
  return map;
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function latestUsGaap(
  gaap: Record<string, unknown> | undefined,
  tags: string[],
): { val: number; end: number } | undefined {
  if (!gaap) return undefined;
  for (const tag of tags) {
    const node = gaap[tag] as
      | { units?: Record<string, Array<{ val?: unknown; end?: string; form?: string }>> }
      | undefined;
    const units = node?.units ?? {};
    const preferred = units.USD ?? units['USD/shares'] ?? units.pure ?? Object.values(units)[0];
    if (!Array.isArray(preferred) || preferred.length === 0) continue;
    const ranked = [...preferred]
      .map((row) => ({
        val: asNum(row.val),
        end: Date.parse(String(row.end ?? '')),
        form: String(row.form ?? ''),
      }))
      .filter((row) => row.val != null && Number.isFinite(row.end))
      .sort((a, b) => {
        if (b.end !== a.end) return b.end - a.end;
        const rank = (form: string) => (form === '10-K' ? 2 : form === '10-Q' ? 1 : 0);
        return rank(b.form) - rank(a.form);
      });
    const hit = ranked[0];
    if (hit?.val != null) return { val: hit.val, end: hit.end };
  }
  return undefined;
}

export function parseCompanyFacts(raw: unknown): {
  payload: EquityStatementsPayload | undefined;
  entityName?: string;
} {
  if (!raw || typeof raw !== 'object') return { payload: undefined };
  const rec = raw as {
    entityName?: string;
    facts?: { 'us-gaap'?: Record<string, unknown> };
  };
  const gaap = rec.facts?.['us-gaap'];
  const revenue = latestUsGaap(gaap, REVENUE_TAGS);
  const netIncome = latestUsGaap(gaap, NET_INCOME_TAGS);
  const roe = latestUsGaap(gaap, ROE_TAGS);
  if (!revenue && !netIncome && !roe) {
    return { payload: undefined, entityName: rec.entityName };
  }
  const asOf = Math.max(revenue?.end ?? 0, netIncome?.end ?? 0, roe?.end ?? 0) || undefined;
  const payload: EquityStatementsPayload = { kind: 'EQUITY_STATEMENTS' };
  if (revenue) payload.revenue = revenue.val;
  if (netIncome) payload.netIncome = netIncome.val;
  if (roe) payload.roe = roe.val;
  if (asOf) payload.asOf = asOf;
  return { payload, entityName: rec.entityName };
}

export class SecEdgarClient {
  private readonly fetchJson: SecFetchJson;
  private tickerCache: Map<string, SecCikMatch> | undefined;

  constructor(opts: { fetchJson?: SecFetchJson } = {}) {
    this.fetchJson = opts.fetchJson ?? defaultSecFetchJson;
  }

  async loadTickers(): Promise<Map<string, SecCikMatch>> {
    if (this.tickerCache) return this.tickerCache;
    const raw = await this.fetchJson(SEC_COMPANY_TICKERS_URL);
    this.tickerCache = parseCompanyTickers(raw);
    return this.tickerCache;
  }

  async lookupCik(ticker: string): Promise<SecCikMatch | undefined> {
    const map = await this.loadTickers();
    return map.get(
      String(ticker ?? '')
        .trim()
        .toUpperCase(),
    );
  }

  async companyFactsForTicker(ticker: string): Promise<{
    match?: SecCikMatch;
    payload?: EquityStatementsPayload;
    entityName?: string;
  }> {
    const match = await this.lookupCik(ticker);
    if (!match) return {};
    const raw = await this.fetchJson(companyFactsUrl(match.cik));
    const parsed = parseCompanyFacts(raw);
    return { match, payload: parsed.payload, entityName: parsed.entityName ?? match.title };
  }
}

export function unavailableEquityFacts(reasonCode: string, message: string): FundamentalPayload {
  return { kind: 'UNAVAILABLE', reasonCode, message };
}
