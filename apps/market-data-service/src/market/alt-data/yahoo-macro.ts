import axios from 'axios';
import { USER_AGENT } from './news-nlp';

export interface MacroPoint {
  seriesId: string;
  asOfDate: Date;
  availableAt: Date;
  value: number;
  source: string;
}

const DAY_MS = 86_400_000;

/** USDINR prints during the NSE session; US/commodity closes land after NSE. */
const YAHOO_SERIES: Array<{ id: string; ticker: string; lagDays: number }> = [
  { id: 'usdinr', ticker: 'INR=X', lagDays: 0 },
  { id: 'brent', ticker: 'BZ=F', lagDays: 1 },
  { id: 'gold', ticker: 'GC=F', lagDays: 1 },
  { id: 'us10y', ticker: '^TNX', lagDays: 1 },
  { id: 'spx', ticker: '^GSPC', lagDays: 1 },
  { id: 'nasdaq', ticker: '^IXIC', lagDays: 1 },
  { id: 'dxy', ticker: 'DX-Y.NYB', lagDays: 1 },
];

const FRED_SERIES: Array<{ id: string; fred: string; lagDays: number }> = [
  { id: 'india_cpi', fred: 'FPCPITOTLZGIND', lagDays: 90 },
  { id: 'repo_rate', fred: 'INTDSRINM193N', lagDays: 14 },
  { id: 'fed_funds', fred: 'FEDFUNDS', lagDays: 21 },
  { id: 'us_cpi', fred: 'CPIAUCSL', lagDays: 45 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function yahooMacroAvailableAt(seriesId: string, asOfDate: Date): Date {
  const series = YAHOO_SERIES.find((row) => row.id === seriesId);
  const lagDays = series?.lagDays ?? 1;
  return new Date(asOfDate.getTime() + lagDays * DAY_MS);
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

function utcDay(ms: number): Date {
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function fetchYahooMacroSeries(): Promise<MacroPoint[]> {
  const points: MacroPoint[] = [];
  for (const series of YAHOO_SERIES) {
    try {
      const response = await axios.get<YahooChart>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(series.ticker)}`,
        {
          params: { range: '5y', interval: '1d' },
          timeout: 12_000,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        },
      );
      const result = response.data.chart?.result?.[0];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const stamps = result?.timestamp ?? [];
      for (let i = 0; i < stamps.length; i += 1) {
        const close = closes[i];
        if (close == null || !Number.isFinite(close)) continue;
        const asOfDate = utcDay(stamps[i] * 1000);
        points.push({
          seriesId: series.id,
          asOfDate,
          availableAt: yahooMacroAvailableAt(series.id, asOfDate),
          value: close,
          source: 'yahoo',
        });
      }
    } catch {
      /* series may 401/404; skip */
    }
    await sleep(350);
  }
  return points;
}

export async function fetchFredSeries(): Promise<MacroPoint[]> {
  const points: MacroPoint[] = [];
  for (const series of FRED_SERIES) {
    try {
      const response = await axios.get<string>(
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series.fred)}`,
        {
          timeout: 15_000,
          responseType: 'text',
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
          validateStatus: () => true,
        },
      );
      if (response.status >= 400 || typeof response.data !== 'string') continue;
      const lines = response.data.split(/\r?\n/).slice(1);
      for (const line of lines) {
        const [dateRaw, valueRaw] = line.split(',');
        if (!dateRaw || valueRaw == null || valueRaw === '.' || valueRaw === '') continue;
        const value = Number(valueRaw);
        if (!Number.isFinite(value)) continue;
        const asOfDate = new Date(`${dateRaw.trim()}T00:00:00Z`);
        if (Number.isNaN(asOfDate.getTime())) continue;
        const availableAt = new Date(asOfDate.getTime() + series.lagDays * DAY_MS);
        points.push({
          seriesId: series.id,
          asOfDate,
          availableAt,
          value,
          source: 'fred',
        });
      }
    } catch {
      /* FRED is optional */
    }
  }
  return points;
}
