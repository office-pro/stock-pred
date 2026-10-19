/**
 * One batch-level BLS v1 / Fed Board release / Treasury macro snapshot.
 * Skip a series on failure — never invent. Never per-instrument CPI.
 * FRED graph/API paths are excluded (token / retired path).
 */

import type { BatchMacroSeriesPoint, BatchMacroSnapshot } from '@stockpred/shared-types';

export const MACRO_REQUESTED_SERIES = ['FEDFUNDS', 'CPI', 'UNEMPLOYMENT', 'DGS10'] as const;

export const BLS_V1_TIMESERIES_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data';
export const BLS_CPI_SERIES = 'CUUR0000SA0';
export const BLS_UNEMPLOYMENT_SERIES = 'LNS14000000';

/** Primary: Board H.15 statistical-release XML (not DDP Build Your Package). */
export const FED_H15_XML_URL = 'https://www.federalreserve.gov/releases/h15/h15.xml';
/** Compatibility only while DDP remains available. */
export const FED_DDP_H15_CSV_URL =
  'https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=csv&label=include&layout=seriescolumn';

export function treasuryYieldCsvUrl(now = Date.now()): string {
  const year = new Date(now).getUTCFullYear();
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve`;
}

export type MacroFetch = (url: string) => Promise<unknown>;

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseLooseDate(dateRaw: string): number {
  const trimmed = dateRaw.trim();
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return Date.parse(`${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}T00:00:00Z`);
  }
  if (trimmed.length <= 7 && /^\d{4}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}-01T00:00:00Z`);
  }
  return Date.parse(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00Z`);
}

export function blsSeriesUrl(seriesId: string): string {
  return `${BLS_V1_TIMESERIES_URL}/${encodeURIComponent(seriesId)}`;
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

/** Board H.15 XML / RSS-like observation rows. Last numeric federal-funds-like value. */
export function parseFedReleaseXml(
  raw: unknown,
  seriesId = 'FEDFUNDS',
): BatchMacroSeriesPoint | undefined {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (!text.trim()) return undefined;
  const observations = [
    ...text.matchAll(
      /<(?:observation|kf:observation|obs)[^>]*(?:TIME_PERIOD|timePeriod|date)=["']([^"']+)["'][^>]*(?:OBS_VALUE|obsValue|value)=["']([^"']+)["'][^>]*>/gi,
    ),
    ...text.matchAll(
      /<(?:observation|kf:observation|obs)[^>]*(?:OBS_VALUE|obsValue|value)=["']([^"']+)["'][^>]*(?:TIME_PERIOD|timePeriod|date)=["']([^"']+)["'][^>]*>/gi,
    ),
  ];
  let last: BatchMacroSeriesPoint | undefined;
  for (const match of observations) {
    const dateRaw = match[1]?.includes('-') || /^\d{4}/.test(match[1] ?? '') ? match[1] : match[2];
    const valueRaw = dateRaw === match[1] ? match[2] : match[1];
    const value = asNum(valueRaw);
    const asOf = Date.parse(
      String(dateRaw).trim().length === 7 ? `${dateRaw}-01T00:00:00Z` : dateRaw,
    );
    if (value == null || !Number.isFinite(asOf)) continue;
    last = { seriesId, value, asOf, source: 'SOURCE_REPORTED', provider: 'fed' };
  }
  if (last) return last;
  const csvLike = parseCsvLastNumeric(text, seriesId, 'fed');
  return csvLike;
}

export function parseFedDdpCsv(
  raw: unknown,
  seriesId = 'FEDFUNDS',
): BatchMacroSeriesPoint | undefined {
  return parseCsvLastNumeric(
    typeof raw === 'string' ? raw : raw == null ? '' : String(raw),
    seriesId,
    'fed',
  );
}

export function parseTreasuryCsv(
  raw: unknown,
  seriesId = 'DGS10',
): BatchMacroSeriesPoint | undefined {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (!text.trim()) return undefined;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return undefined;
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const tenIdx = header.findIndex((h) => /^(10\s*yr|10\s*year)$/i.test(h) || h === 'DGS10');
  const dateIdx = header.findIndex((h) => /date/i.test(h));
  const valueIdx = tenIdx >= 0 ? tenIdx : header.length > 1 ? 1 : -1;
  if (valueIdx < 0) return undefined;
  let last: BatchMacroSeriesPoint | undefined;
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const value = asNum(cols[valueIdx]);
    const dateRaw = dateIdx >= 0 ? cols[dateIdx] : cols[0];
    if (value == null || !dateRaw) continue;
    const asOf = parseLooseDate(dateRaw);
    if (!Number.isFinite(asOf)) continue;
    last = { seriesId, value, asOf, source: 'SOURCE_REPORTED', provider: 'treasury' };
  }
  return last;
}

function parseCsvLastNumeric(
  text: string,
  seriesId: string,
  provider: BatchMacroSeriesPoint['provider'],
): BatchMacroSeriesPoint | undefined {
  if (!text.trim()) return undefined;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'));
  let last: BatchMacroSeriesPoint | undefined;
  for (const line of lines.slice(1)) {
    const [dateRaw, ...rest] = line.split(',');
    const valueRaw = rest.find((cell) => asNum(cell) != null);
    const value = asNum(valueRaw);
    if (!dateRaw || value == null) continue;
    const asOf = parseLooseDate(dateRaw.trim());
    if (!Number.isFinite(asOf)) continue;
    last = { seriesId, value, asOf, source: 'SOURCE_REPORTED', provider };
  }
  return last;
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

export async function fetchBatchMacroSnapshot(
  fetchJson: MacroFetch,
  now = Date.now(),
): Promise<BatchMacroSnapshot> {
  const series: BatchMacroSeriesPoint[] = [];

  const tryBls = async (id: string, asSeries: string) => {
    try {
      const point = parseBlsTimeseries(await fetchJson(blsSeriesUrl(id)), asSeries);
      if (point) series.push(point);
    } catch {
      /* skip missing series */
    }
  };

  try {
    const xml = await fetchJson(FED_H15_XML_URL);
    const point = parseFedReleaseXml(xml, 'FEDFUNDS');
    if (point) series.push(point);
  } catch {
    try {
      const csv = await fetchJson(FED_DDP_H15_CSV_URL);
      const point = parseFedDdpCsv(csv, 'FEDFUNDS');
      if (point) series.push(point);
    } catch {
      /* Fed unavailable */
    }
  }

  await tryBls(BLS_CPI_SERIES, 'CPI');
  await tryBls(BLS_UNEMPLOYMENT_SERIES, 'UNEMPLOYMENT');

  try {
    const point = parseTreasuryCsv(await fetchJson(treasuryYieldCsvUrl(now)), 'DGS10');
    if (point) series.push(point);
  } catch {
    /* Treasury unavailable */
  }

  return buildBatchMacroSnapshot(series);
}
