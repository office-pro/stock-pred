/**
 * One batch-level BLS / FRED macro snapshot. Skip a series on failure — never invent.
 * Coverage is batch-level from this object, not per-instrument CPI.
 */

import type { BatchMacroSeriesPoint, BatchMacroSnapshot } from '@stockpred/shared-types';

export const MACRO_REQUESTED_SERIES = ['FEDFUNDS', 'CPIAUCSL', 'CUUR0000SA0'] as const;
export const FRED_GRAPH_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const BLS_TIMESERIES_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data';

export type MacroFetch = (url: string) => Promise<unknown>;

export function fredCsvUrl(seriesId: string): string {
  return `${FRED_GRAPH_CSV}?id=${encodeURIComponent(seriesId)}`;
}

export function blsSeriesUrl(seriesId: string): string {
  return `${BLS_TIMESERIES_URL}/${encodeURIComponent(seriesId)}`;
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseFredCsv(raw: unknown, seriesId: string): BatchMacroSeriesPoint | undefined {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (!text.trim()) return undefined;
  const lines = text.split(/\r?\n/).slice(1);
  let last: BatchMacroSeriesPoint | undefined;
  for (const line of lines) {
    const [dateRaw, valueRaw] = line.split(',');
    if (!dateRaw || valueRaw == null || valueRaw === '.' || valueRaw.trim() === '') continue;
    const value = asNum(valueRaw);
    const asOf = Date.parse(`${dateRaw.trim()}T00:00:00Z`);
    if (value == null || !Number.isFinite(asOf)) continue;
    last = {
      seriesId,
      value,
      asOf,
      source: 'SOURCE_REPORTED',
      provider: 'fred',
    };
  }
  return last;
}

export function parseBlsTimeseries(
  raw: unknown,
  seriesId: string,
): BatchMacroSeriesPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as {
    status?: string;
    Results?: {
      series?: Array<{
        seriesID?: string;
        data?: Array<{ year?: string; period?: string; value?: string }>;
      }>;
    };
  };
  const rows = rec.Results?.series?.[0]?.data;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  for (const row of rows) {
    const year = String(row.year ?? '');
    const period = String(row.period ?? '');
    const value = asNum(row.value);
    const month = period.startsWith('M') ? period.slice(1) : '';
    if (!year || !month || value == null) continue;
    const asOf = Date.parse(`${year}-${month.padStart(2, '0')}-01T00:00:00Z`);
    if (!Number.isFinite(asOf)) continue;
    return {
      seriesId,
      value,
      asOf,
      source: 'SOURCE_REPORTED',
      provider: 'bls',
    };
  }
  return undefined;
}

export function buildBatchMacroSnapshot(series: BatchMacroSeriesPoint[]): BatchMacroSnapshot {
  const requestedSeries = [...MACRO_REQUESTED_SERIES];
  const asOf = series.reduce((max, row) => Math.max(max, row.asOf), 0) || undefined;
  return {
    source: 'SOURCE_REPORTED',
    requestedCount: requestedSeries.length,
    requestedSeries,
    series,
    ...(asOf ? { asOf } : {}),
    ...(series.length === 0 ? { reasonCode: 'MACRO_SERIES_UNAVAILABLE' } : {}),
  };
}

export async function fetchBatchMacroSnapshot(fetchJson: MacroFetch): Promise<BatchMacroSnapshot> {
  const series: BatchMacroSeriesPoint[] = [];

  const tryFred = async (id: string) => {
    try {
      const point = parseFredCsv(await fetchJson(fredCsvUrl(id)), id);
      if (point) series.push(point);
    } catch {
      /* skip missing series */
    }
  };
  const tryBls = async (id: string) => {
    try {
      const point = parseBlsTimeseries(await fetchJson(blsSeriesUrl(id)), id);
      if (point) series.push(point);
    } catch {
      /* skip missing series */
    }
  };

  await tryFred('FEDFUNDS');
  await tryFred('CPIAUCSL');
  await tryBls('CUUR0000SA0');
  return buildBatchMacroSnapshot(series);
}
