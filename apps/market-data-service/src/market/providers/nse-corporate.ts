/**
 * NSE corporate announcements / actions — permitted NSE JSON APIs only.
 * Same session/gap pattern as nse-fundamentals. No scrape bypass.
 */

import axios from 'axios';
import { withRetry } from '@stockpred/shared-utils';

const REQUEST_GAP_MS = 400;
const SESSION_TTL_MS = 20 * 60_000;
const NSE_HOME = 'https://www.nseindia.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface NseCorporatePanelRow {
  symbol: string;
  kind: 'ANNOUNCEMENT' | 'SHAREHOLDING' | 'CORPORATE_ACTION';
  event_type: string;
  headline: string;
  category?: string;
  published_at: string;
  available_at: string;
  source: string;
  url?: string;
  action_type?: string;
  ex_date?: string;
}

function asRecord(node: unknown): Record<string, unknown> {
  return node && typeof node === 'object' && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : {};
}

function asArray(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  const rec = asRecord(node);
  for (const key of ['data', 'corpAnnounce', 'corporateAnnouncements', 'corporateActions']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

function pickStr(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = Object.keys(row).find((c) => c.toLowerCase() === key.toLowerCase());
    if (!found) continue;
    const value = String(row[found] ?? '').trim();
    if (value) return value;
  }
  return null;
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

export function parseNseAnnouncements(symbol: string, payload: unknown): NseCorporatePanelRow[] {
  const now = new Date().toISOString();
  const out: NseCorporatePanelRow[] = [];
  for (const item of asArray(payload)) {
    const row = asRecord(item);
    const headline =
      pickStr(row, ['desc', 'subject', 'an_dt', 'attchmntText', 'headline', 'description']) ?? null;
    if (!headline) continue;
    const published =
      pickStr(row, ['an_dt', 'broadcastDateTime', 'date', 'exDate', 'publishedAt']) ?? now;
    const category = pickStr(row, ['desc', 'subject', 'industry', 'category']) ?? undefined;
    out.push({
      symbol: symbol.toUpperCase(),
      kind: 'ANNOUNCEMENT',
      event_type: category ?? 'ANNOUNCEMENT',
      headline,
      category,
      published_at: published,
      available_at: published,
      source: 'nse-corporate-announcements',
      url: pickStr(row, ['attchmntFile', 'url', 'link']) ?? undefined,
    });
  }
  return out;
}

export function parseNseCorporateActions(symbol: string, payload: unknown): NseCorporatePanelRow[] {
  const now = new Date().toISOString();
  const out: NseCorporatePanelRow[] = [];
  for (const item of asArray(payload)) {
    const row = asRecord(item);
    const action =
      pickStr(row, ['purpose', 'actionType', 'ca_type', 'subject', 'series']) ?? 'CORPORATE_ACTION';
    const exDate = pickStr(row, ['exDate', 'ex_dt', 'recordDate']);
    const published = pickStr(row, ['exDate', 'ex_dt', 'recDate', 'date']) ?? now;
    out.push({
      symbol: symbol.toUpperCase(),
      kind: 'CORPORATE_ACTION',
      event_type: action,
      headline: action,
      action_type: action,
      ex_date: exDate ?? undefined,
      published_at: published,
      available_at: published,
      source: 'nse-corporate-actions',
    });
  }
  return out;
}

/** Shareholding from fundamentals panel promoter/institution — evidence kind SHAREHOLDING. */
export function shareholdingFromFundamentals(input: {
  symbol: string;
  promoter_holding?: number | null;
  institution_holding?: number | null;
  as_of_date?: string | null;
  available_at?: string | null;
}): NseCorporatePanelRow[] {
  const out: NseCorporatePanelRow[] = [];
  const asOf = input.available_at ?? input.as_of_date ?? new Date().toISOString();
  if (input.promoter_holding != null && Number.isFinite(input.promoter_holding)) {
    out.push({
      symbol: input.symbol.toUpperCase(),
      kind: 'SHAREHOLDING',
      event_type: 'PROMOTER_HOLDING',
      headline: `Promoter holding ${input.promoter_holding}%`,
      category: 'SHAREHOLDING',
      published_at: asOf,
      available_at: asOf,
      source: 'nse-shareholding',
    });
  }
  if (input.institution_holding != null && Number.isFinite(input.institution_holding)) {
    out.push({
      symbol: input.symbol.toUpperCase(),
      kind: 'SHAREHOLDING',
      event_type: 'INSTITUTION_HOLDING',
      headline: `Institution holding ${input.institution_holding}%`,
      category: 'SHAREHOLDING',
      published_at: asOf,
      available_at: asOf,
      source: 'nse-shareholding',
    });
  }
  return out;
}

export class NseCorporateClient {
  private chain: Promise<void> = Promise.resolve();
  private cookie = '';
  private cookieAt = 0;

  async fetchCorporatePanel(symbol: string): Promise<NseCorporatePanelRow[]> {
    const encoded = encodeURIComponent(symbol);
    const announcements = await this.scheduled(() =>
      this.getJson(
        `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encoded}`,
      ),
    );
    const actions = await this.scheduled(() =>
      this.getJson(
        `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encoded}`,
      ),
    );
    return [
      ...parseNseAnnouncements(symbol, announcements),
      ...parseNseCorporateActions(symbol, actions),
    ];
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
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 15_000,
      validateStatus: () => true,
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
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Referer: NSE_HOME,
            Cookie: cookie,
          },
          timeout: 15_000,
          validateStatus: () => true,
        });
        if (response.status === 401 || response.status === 403) {
          await this.ensureCookie(true);
          throw new Error(`NSE_CORPORATE_HTTP_${response.status}`);
        }
        if (response.status >= 400) {
          throw new Error(`NSE_CORPORATE_HTTP_${response.status}`);
        }
        return response.data;
      },
      { retries: 1, delayMs: 700, backoff: 1.4 },
    );
  }
}

export const nseCorporateClient = new NseCorporateClient();
