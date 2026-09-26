/**
 * Twelve Data vendor client — quotes + OHLCV + press_releases (+ forex_pairs membership).
 * Never call TD indicator endpoints (/rsi, /macd, /adx, …). Technicals are local.
 * After BatchDataSnapshot.frozen, freeze() must hold: no further TD HTTP.
 */

export const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
export const TD_CREDIT_EXHAUSTED = 'TD_CREDIT_EXHAUSTED';
export const TWELVE_DATA_REQUIRES_GROW = 'TWELVE_DATA_REQUIRES_GROW';
export const TWELVE_DATA_API_KEY_MISSING = 'TWELVE_DATA_API_KEY_MISSING';
export const TWELVE_DATA_FROZEN = 'TWELVE_DATA_FROZEN';
export const TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN = 'TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN';

const FORBIDDEN_INDICATOR_PATH =
  /\/(rsi|ema|macd|atr|adx|bbands|vwap|sma|plus_di|minus_di|stoch|cci|obv)\b/i;
const FORBIDDEN_COMMODITY_PATH = /\/(commodities|commodity)\b/i;

export class TwelveDataCreditBudget {
  remaining: number;

  constructor(remaining: number) {
    this.remaining = Math.max(0, Number.isFinite(remaining) ? remaining : 0);
  }

  consume(cost = 1): void {
    const n = Math.max(1, cost);
    if (this.remaining < n) {
      const err = new Error(TD_CREDIT_EXHAUSTED);
      err.name = TD_CREDIT_EXHAUSTED;
      throw err;
    }
    this.remaining -= n;
  }
}

export interface TwelveDataTimeSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface TwelveDataTimeSeriesResponse {
  meta?: { symbol?: string; interval?: string; currency?: string };
  values?: TwelveDataTimeSeriesValue[];
  status?: string;
  code?: number | string;
  message?: string;
}

export interface TwelveDataForexPairRow {
  symbol?: string;
  currency_group?: string;
  currency_base?: string;
  currency_quote?: string;
}

export interface TwelveDataPressRelease {
  title: string;
  datetime?: string;
  url?: string;
}

export interface TwelveDataPressReleasesResponse {
  meta?: { symbol?: string };
  press_releases?: Array<{ title?: string; datetime?: string; date?: string; url?: string }>;
  data?: Array<{ title?: string; datetime?: string; date?: string; url?: string }>;
  status?: string;
  code?: number | string;
  message?: string;
}

export type TwelveDataFetchJson = (url: string) => Promise<unknown>;

export interface TwelveDataClientOptions {
  apiKey: string;
  fetchJson?: TwelveDataFetchJson;
  budget?: TwelveDataCreditBudget;
}

export function twelveDataApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.TWELVE_DATA_API_KEY ?? '').trim();
}

export function assertTwelveDataSafePath(path: string): void {
  assertSafePath(path);
}

export function hasTwelveDataApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return twelveDataApiKey(env).length > 0;
}

export function twelveDataCreditBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TWELVE_DATA_CREDIT_BUDGET ?? 8);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8;
}

function assertSafePath(path: string): void {
  if (FORBIDDEN_INDICATOR_PATH.test(path)) {
    const err = new Error(TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN);
    err.name = TWELVE_DATA_INDICATOR_ENDPOINT_FORBIDDEN;
    throw err;
  }
  if (FORBIDDEN_COMMODITY_PATH.test(path)) {
    const err = new Error(TWELVE_DATA_REQUIRES_GROW);
    err.name = TWELVE_DATA_REQUIRES_GROW;
    throw err;
  }
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseTwelveDataDatetime(raw: string): number | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

export async function defaultTwelveDataFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'stockpred-twelve-data/1.0' },
  });
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    code?: number | string;
    message?: string;
  } | null;
  if (res.status === 429 || Number(body?.code) === 429) {
    const err = new Error(TD_CREDIT_EXHAUSTED);
    err.name = TD_CREDIT_EXHAUSTED;
    throw err;
  }
  if (!res.ok) {
    throw new Error(
      body?.message ? `Twelve Data HTTP ${res.status}: ${body.message}` : `HTTP ${res.status}`,
    );
  }
  return body;
}

export class TwelveDataClient {
  private frozen = false;
  private readonly apiKey: string;
  private readonly fetchJson: TwelveDataFetchJson;
  readonly budget: TwelveDataCreditBudget;

  constructor(opts: TwelveDataClientOptions) {
    this.apiKey = String(opts.apiKey ?? '').trim();
    if (!this.apiKey) {
      const err = new Error(TWELVE_DATA_API_KEY_MISSING);
      err.name = TWELVE_DATA_API_KEY_MISSING;
      throw err;
    }
    this.fetchJson = opts.fetchJson ?? defaultTwelveDataFetch;
    this.budget = opts.budget ?? new TwelveDataCreditBudget(8);
  }

  freeze(): void {
    this.frozen = true;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  assertNotFrozen(): void {
    if (this.frozen) {
      const err = new Error(TWELVE_DATA_FROZEN);
      err.name = TWELVE_DATA_FROZEN;
      throw err;
    }
  }

  private url(path: string, params: Record<string, string> = {}): string {
    assertSafePath(path);
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const u = new URL(normalized, TWELVE_DATA_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value) u.searchParams.set(key, value);
    }
    u.searchParams.set('apikey', this.apiKey);
    return u.toString();
  }

  async timeSeries(
    symbol: string,
    interval = '1day',
    outputsize = 100,
  ): Promise<TwelveDataTimeSeriesResponse> {
    this.assertNotFrozen();
    this.budget.consume(1);
    const raw = (await this.fetchJson(
      this.url('/time_series', {
        symbol,
        interval,
        outputsize: String(outputsize),
        order: 'ASC',
      }),
    )) as TwelveDataTimeSeriesResponse;
    if (raw?.status === 'error') {
      const code = Number(raw.code);
      if (code === 429) {
        const err = new Error(TD_CREDIT_EXHAUSTED);
        err.name = TD_CREDIT_EXHAUSTED;
        throw err;
      }
      throw new Error(raw.message || 'Twelve Data time_series error');
    }
    return raw;
  }

  async forexPairs(): Promise<TwelveDataForexPairRow[]> {
    this.assertNotFrozen();
    this.budget.consume(1);
    const raw = (await this.fetchJson(this.url('/forex_pairs'))) as {
      data?: TwelveDataForexPairRow[];
      status?: string;
      message?: string;
      code?: number | string;
    };
    if (raw?.status === 'error') {
      throw new Error(raw.message || 'Twelve Data forex_pairs error');
    }
    return Array.isArray(raw?.data) ? raw.data : [];
  }

  async pressReleases(symbol: string): Promise<TwelveDataPressReleasesResponse> {
    this.assertNotFrozen();
    this.budget.consume(1);
    const raw = (await this.fetchJson(
      this.url('/press_releases', { symbol }),
    )) as TwelveDataPressReleasesResponse;
    if (raw?.status === 'error') {
      const code = Number(raw.code);
      if (code === 429) {
        const err = new Error(TD_CREDIT_EXHAUSTED);
        err.name = TD_CREDIT_EXHAUSTED;
        throw err;
      }
      throw new Error(raw.message || 'Twelve Data press_releases error');
    }
    return raw;
  }
}

export function createTwelveDataClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { fetchJson?: TwelveDataFetchJson; budget?: TwelveDataCreditBudget } = {},
): TwelveDataClient | null {
  const key = twelveDataApiKey(env);
  if (!key) return null;
  return new TwelveDataClient({
    apiKey: key,
    fetchJson: opts.fetchJson,
    budget: opts.budget ?? new TwelveDataCreditBudget(twelveDataCreditBudgetFromEnv(env)),
  });
}

export function parseTwelveDataTimeSeries(raw: TwelveDataTimeSeriesResponse | null | undefined): {
  quote?: {
    price: number;
    volume?: number;
    dayHigh?: number;
    dayLow?: number;
    previousClose?: number;
  };
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
} {
  const values = [...(raw?.values ?? [])].sort((a, b) => {
    const ta = parseTwelveDataDatetime(a.datetime) ?? 0;
    const tb = parseTwelveDataDatetime(b.datetime) ?? 0;
    return ta - tb;
  });
  const candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }> = [];
  for (const row of values) {
    const time = parseTwelveDataDatetime(row.datetime);
    const open = asNum(row.open);
    const high = asNum(row.high);
    const low = asNum(row.low);
    const close = asNum(row.close);
    if (time == null || open == null || high == null || low == null || close == null) continue;
    const volume = asNum(row.volume);
    candles.push({ time, open, high, low, close, ...(volume != null ? { volume } : {}) });
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return {
    quote: last
      ? {
          price: last.close,
          volume: last.volume,
          dayHigh: last.high,
          dayLow: last.low,
          previousClose: prev?.close,
        }
      : undefined,
    candles,
  };
}

export function parseTwelveDataPressReleases(
  raw: TwelveDataPressReleasesResponse | null | undefined,
): TwelveDataPressRelease[] {
  const list = raw?.press_releases ?? raw?.data ?? [];
  if (!Array.isArray(list)) return [];
  const out: TwelveDataPressRelease[] = [];
  for (const row of list) {
    const title = String(row?.title ?? '').trim();
    if (!title) continue;
    const datetime = row.datetime ?? row.date;
    out.push({
      title,
      ...(datetime ? { datetime: String(datetime) } : {}),
      ...(row.url ? { url: String(row.url) } : {}),
    });
  }
  return out;
}

/** Provider-boundary symbol only. Never mutates frozen InstrumentRef. */
export function mapToTwelveDataSymbol(ref: {
  symbol: string;
  assetClass: string;
  canonicalSymbol?: string;
}): string {
  const raw = String(ref.canonicalSymbol || ref.symbol || '')
    .trim()
    .toUpperCase();
  if (!raw) return raw;
  if (ref.assetClass === 'FX') {
    if (raw.includes('/')) return raw;
    if (/^[A-Z]{6}$/.test(raw)) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
    return raw;
  }
  if (ref.assetClass === 'CRYPTO_SPOT') {
    if (raw.includes('/')) return raw;
    const m = raw.match(/^([A-Z0-9]{2,15})(USDT|USDC|BUSD|USD)$/);
    if (m) return `${m[1]}/USD`;
    return raw;
  }
  return raw;
}
