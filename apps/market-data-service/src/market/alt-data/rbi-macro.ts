/**
 * RBI / DBIE India macro series — public CSV/API only (no HTML scrape).
 * Prefer these over FRED for india_cpi / repo_rate when available.
 */

import axios from 'axios';
import { USER_AGENT } from './news-nlp';
import type { MacroPoint } from './yahoo-macro';

const DAY_MS = 86_400_000;

/**
 * RBI key rates — public SDDS / policy page CSV mirrors vary.
 * We try the RBI DBIE SDMX JSON for policy repo when reachable; skip quietly on failure.
 * Never invent values; never label FRED as RBI.
 */
const RBI_REPO_SDMX =
  'https://api.dbie.rbi.org.in/DBIEAPI/Statistics/SDMX/data/RBIPOLICYRATE/all/all';

function utcDay(ms: number): Date {
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseLooseNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Extract {date,value} pairs from loose SDMX / tabular JSON. */
export function parseRbiSdmxObservations(payload: unknown): Array<{ asOf: Date; value: number }> {
  const out: Array<{ asOf: Date; value: number }> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    const time =
      rec.TIME_PERIOD ?? rec.timePeriod ?? rec.asOfDate ?? rec.date ?? rec.obsTime ?? rec.period;
    const value = rec.OBS_VALUE ?? rec.obsValue ?? rec.value ?? rec.rate;
    if (time != null && value != null) {
      const n = parseLooseNumber(value);
      const d = new Date(String(time).length <= 10 ? `${String(time)}T00:00:00Z` : String(time));
      if (n != null && !Number.isNaN(d.getTime())) {
        out.push({ asOf: utcDay(d.getTime()), value: n });
      }
    }
    for (const child of Object.values(rec)) walk(child);
  };
  walk(payload);
  return out;
}

export async function fetchRbiMacroSeries(): Promise<MacroPoint[]> {
  const points: MacroPoint[] = [];
  try {
    const response = await axios.get<unknown>(RBI_REPO_SDMX, {
      timeout: 12_000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/csv,*/*' },
      validateStatus: () => true,
    });
    if (response.status < 400 && response.data != null) {
      for (const obs of parseRbiSdmxObservations(response.data)) {
        points.push({
          seriesId: 'repo_rate',
          asOfDate: obs.asOf,
          availableAt: new Date(obs.asOf.getTime() + 1 * DAY_MS),
          value: obs.value,
          source: 'rbi',
        });
      }
    }
  } catch {
    /* RBI optional — FRED may supply repo_rate with source:fred */
  }
  return points;
}

/**
 * Prefer RBI points when both RBI and FRED cover the same seriesId+asOfDate.
 */
export function preferRbiMacroPoints(points: MacroPoint[]): MacroPoint[] {
  const byKey = new Map<string, MacroPoint>();
  for (const point of points) {
    const key = `${point.seriesId}|${point.asOfDate.toISOString().slice(0, 10)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, point);
      continue;
    }
    if (existing.source !== 'rbi' && point.source === 'rbi') {
      byKey.set(key, point);
    }
  }
  return [...byKey.values()];
}
