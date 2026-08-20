import axios from 'axios';
import { withRetry } from '@stockpred/shared-utils';
import {
  availableAtFromPeriodEnd,
  computeDisplayScore,
  emptySnapshot,
  type FundamentalSnapshotInput,
} from './yahoo-fundamentals';

const REQUEST_GAP_MS = 400;
const SESSION_TTL_MS = 20 * 60_000;
const NSE_HOME = 'https://www.nseindia.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function asRecord(node: unknown): Record<string, unknown> {
  return node && typeof node === 'object' && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const found = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (!found) continue;
    const value = num(row[found]);
    if (value != null) return value;
  }
  return null;
}

function pickStr(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (!found) continue;
    const value = String(row[found] ?? '').trim();
    if (value) return value;
  }
  return null;
}

export function parseNseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const dmy = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (dmy) {
    const month = MONTHS[dmy[2].toUpperCase()];
    if (month) return new Date(Date.UTC(Number(dmy[3]), month - 1, Number(dmy[1])));
  }
  const slash = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw.trim());
  if (slash) return new Date(Date.UTC(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1])));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resultRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const root = asRecord(payload);
  for (const key of ['data', 'results', 'financialResults', 'corporateFinancialResults']) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  return [];
}

export function parseNseFinancialResults(
  symbol: string,
  payload: unknown,
): FundamentalSnapshotInput[] {
  const rows = resultRows(payload)
    .map((row) => {
      const end =
        parseNseDate(pickStr(row, ['toDate', 'to_date', 'reToDate', 'periodTo', 'endingDate'])) ??
        parseNseDate(pickStr(row, ['fromDate', 'from_date', 'reFromDate']));
      if (!end) return null;
      const broadcast = parseNseDate(
        pickStr(row, ['broadcastingDate', 'dateOfExchangeIntimation', 'filingDate', 'relatingTo']),
      );
      const revenue = pickNum(row, ['income', 'totalIncome', 'revenue', 'netSales', 'sales']);
      const pat = pickNum(row, [
        'netProfit',
        'profitAfterTax',
        'proftAftTax',
        'pat',
        'profitAfterTaxConsolidated',
      ]);
      const snapshot = emptySnapshot(symbol, end, 'nse');
      snapshot.availableAt = broadcast ?? availableAtFromPeriodEnd(end);
      snapshot.revenue = revenue;
      snapshot.pat = pat;
      snapshot.eps = pickNum(row, ['basicEPS', 'dilutedEPS', 'eps', 'basicEps']);
      snapshot.ebit = pickNum(row, [
        'profitBeforeInterestDepTaxes',
        'pbidt',
        'ebit',
        'operatingProfit',
      ]);
      snapshot.equity = pickNum(row, ['equity', 'paidUpEquity', 'shareCapital']);
      snapshot.displayScore = computeDisplayScore(snapshot);
      return snapshot;
    })
    .filter((row): row is FundamentalSnapshotInput => row != null)
    .filter((row) => row.revenue != null || row.pat != null || row.eps != null)
    .sort((a, b) => a.asOfDate.getTime() - b.asOfDate.getTime());

  return rows.map((row, index) => {
    const prior = rows
      .slice(0, index)
      .reverse()
      .find(
        (candidate) =>
          Math.abs(row.asOfDate.getTime() - candidate.asOfDate.getTime() - 365.25 * 86_400_000) <
          50 * 86_400_000,
      );
    if (prior) {
      if (row.revenue != null && prior.revenue) row.revYoy = row.revenue / prior.revenue - 1;
      if (row.pat != null && prior.pat) row.patYoy = row.pat / prior.pat - 1;
      if (row.eps != null && prior.eps) row.epsYoy = row.eps / prior.eps - 1;
    }
    if (row.revenue && row.pat != null) row.netMargin = row.pat / row.revenue;
    if (row.revenue && row.ebit != null) row.opMargin = row.ebit / row.revenue;
    row.displayScore = computeDisplayScore(row);
    return row;
  });
}

export function parseNseQuote(symbol: string, payload: unknown): FundamentalSnapshotInput | null {
  const root = asRecord(payload);
  const info = asRecord(root.info);
  const metadata = asRecord(root.metadata);
  const price = asRecord(root.priceInfo);
  const industry = pickStr(info, ['industry']) ?? pickStr(metadata, ['industry', 'pdSectorInd']);
  const pe = pickNum(metadata, ['pdSymbolPe', 'pe']) ?? pickNum(price, ['pe']);
  const pb = pickNum(metadata, ['pdSymbolPb', 'pb']);
  const eps = pickNum(metadata, ['eps']);
  if (pe == null && pb == null && eps == null && !industry) return null;
  const row = emptySnapshot(symbol, utcToday(), 'nse-quote');
  row.availableAt = row.asOfDate;
  row.sector = industry;
  row.trailingPe = pe != null && pe > 0 ? pe : null;
  row.priceToBook = pb != null && pb > 0 ? pb : null;
  row.trailingEps = eps;
  row.displayScore = computeDisplayScore(row);
  return row;
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function appendCookies(existing: string, setCookie?: string | string[]): string {
  const list = !setCookie ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  const map = new Map<string, string>();
  for (const pair of existing
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const raw of list) {
    const first = String(raw).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq > 0) map.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

export class NseFundamentalsClient {
  private chain: Promise<void> = Promise.resolve();
  private cookie = '';
  private cookieAt = 0;

  async fetchSnapshots(symbol: string): Promise<FundamentalSnapshotInput[]> {
    const encoded = encodeURIComponent(symbol);
    const quarterly = await this.scheduled(() =>
      this.getJson(
        `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&symbol=${encoded}`,
      ),
    );
    let rows = parseNseFinancialResults(symbol, quarterly);
    if (rows.length === 0) {
      const annual = await this.scheduled(() =>
        this.getJson(
          `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Annual&symbol=${encoded}`,
        ),
      );
      rows = parseNseFinancialResults(symbol, annual);
    }
    const quote = await this.scheduled(() =>
      this.getJson(`https://www.nseindia.com/api/quote-equity?symbol=${encoded}`),
    );
    const quoteRow = parseNseQuote(symbol, quote);
    if (rows.length > 0 && quoteRow) {
      const latest = rows[rows.length - 1];
      latest.trailingPe = latest.trailingPe ?? quoteRow.trailingPe;
      latest.priceToBook = latest.priceToBook ?? quoteRow.priceToBook;
      latest.trailingEps = latest.trailingEps ?? quoteRow.trailingEps;
      latest.sector = latest.sector ?? quoteRow.sector;
      latest.displayScore = computeDisplayScore(latest);
      return rows;
    }
    if (rows.length > 0) return rows;
    return quoteRow ? [quoteRow] : [];
  }

  private scheduled<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
    );
    return result;
  }

  private async ensureCookie(force = false): Promise<string> {
    if (!force && this.cookie && Date.now() - this.cookieAt < SESSION_TTL_MS) {
      return this.cookie;
    }
    const home = await axios.get(NSE_HOME, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 12_000,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    this.cookie = appendCookies('', home.headers['set-cookie']);
    this.cookieAt = Date.now();
    return this.cookie;
  }

  private async getJson(url: string): Promise<unknown> {
    return withRetry(
      async () => {
        const cookie = await this.ensureCookie();
        const response = await axios.get(url, {
          timeout: 15_000,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json,text/plain,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: NSE_HOME,
            Cookie: cookie,
          },
          validateStatus: () => true,
        });
        this.cookie = appendCookies(this.cookie, response.headers['set-cookie']);
        if (response.status === 401 || response.status === 403) {
          await this.ensureCookie(true);
          throw new Error(`NSE ${response.status}`);
        }
        if (response.status >= 400) {
          throw new Error(`NSE HTTP ${response.status}`);
        }
        return response.data;
      },
      { retries: 1, delayMs: 700, backoff: 1.4 },
    );
  }
}
