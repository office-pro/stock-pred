/**
 * Analysis period (lookback) vs candle resolution vs prediction horizon.
 * These are independent: 6 months of daily candles evaluating the next 1 month.
 */

import type { AnalysisPeriod, AnalysisResolution, AnalysisWindow } from '@stockpred/shared-types';

export const ANALYSIS_PERIODS: readonly AnalysisPeriod[] = ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'];

export const ANALYSIS_PERIOD_LABELS: Record<AnalysisPeriod, string> = {
  '1W': '1 Week',
  '1M': '1 Month',
  '3M': '3 Months',
  '6M': '6 Months',
  '1Y': '1 Year',
  CUSTOM: 'Custom',
};

export const ANALYSIS_RESOLUTIONS: readonly AnalysisResolution[] = ['5m', '15m', '1H', '4H', '1D'];

export function defaultAnalysisPeriod(): AnalysisPeriod {
  return '3M';
}

export function defaultAnalysisResolution(): AnalysisResolution {
  return '1D';
}

export function isAnalysisPeriod(value: string | undefined | null): value is AnalysisPeriod {
  const v = normalizePeriodToken(value);
  return (ANALYSIS_PERIODS as readonly string[]).includes(v);
}

function normalizePeriodToken(raw?: string | null): string {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (v === '12M') return '1Y';
  return v;
}

export function normalizeAnalysisPeriod(raw?: string | null): AnalysisPeriod {
  const token = normalizePeriodToken(raw);
  if ((ANALYSIS_PERIODS as readonly string[]).includes(token)) return token as AnalysisPeriod;
  return defaultAnalysisPeriod();
}

export function normalizeAnalysisResolution(raw?: string | null): AnalysisResolution {
  const v = String(raw ?? '').trim();
  const upper = v.toUpperCase();
  if (v === '5m' || upper === '5M') return '5m';
  if (v === '15m' || upper === '15M') return '15m';
  if (upper === '1H') return '1H';
  if (upper === '4H') return '4H';
  if (upper === '1D') return '1D';
  return defaultAnalysisResolution();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAnalysisWindow(
  window: { startDate?: string; endDate?: string } | undefined,
): AnalysisWindow {
  const startDate = String(window?.startDate ?? '').trim();
  const endDate = String(window?.endDate ?? '').trim();
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    throw new Error('CUSTOM analysis period requires startDate and endDate as YYYY-MM-DD');
  }
  if (startDate > endDate) {
    throw new Error('CUSTOM analysis window startDate must be on or before endDate');
  }
  return { startDate, endDate };
}

export const ANALYSIS_PERIOD_LOOKBACK_DAYS: Record<Exclude<AnalysisPeriod, 'CUSTOM'>, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

export function defaultCustomAnalysisWindow(now = new Date()): AnalysisWindow {
  return windowEndingToday(ANALYSIS_PERIOD_LOOKBACK_DAYS['6M'], now);
}

/** Inclusive calendar window implied by a preset lookback. CUSTOM requires analysisWindow. */
export function analysisWindowFromPeriod(
  period: AnalysisPeriod,
  window?: AnalysisWindow,
  now = new Date(),
): AnalysisWindow {
  if (period === 'CUSTOM') return parseAnalysisWindow(window);
  return windowEndingToday(ANALYSIS_PERIOD_LOOKBACK_DAYS[period], now);
}

function windowEndingToday(lookbackDays: number, now: Date): AnalysisWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - lookbackDays);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}
