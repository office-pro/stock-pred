/**
 * Required historical series = Analysis Period + technical warm-up + max feature/model lookback.
 * Prediction horizon does NOT increase the download.
 */

import type { AnalysisPeriod, AnalysisWindow } from '@stockpred/shared-types';
import { analysisWindowFromPeriod } from './analysis-period';

/** EMA200 warm-up. */
export const TECHNICAL_WARMUP_BARS = 200;
/** RS / feature window used by compareToBenchmark. */
export const FEATURE_MODEL_LOOKBACK_BARS = 60;

export function historicalRequirementKey(input: {
  symbol: string;
  provider: string;
  venue: string;
  timeframe: string;
  start?: string;
  end?: string;
  lookback?: string;
  limit?: number;
}): string {
  const range =
    input.start && input.end
      ? `range=${input.start}:${input.end}`
      : input.lookback
        ? `lookback=${input.lookback}`
        : `limit=${input.limit ?? ''}`;
  return [input.symbol, input.provider, input.venue, input.timeframe, range].join(':');
}

export function sufficientDailyCandleLimit(
  period: AnalysisPeriod,
  window?: AnalysisWindow,
): {
  limit: number;
  lookback: string;
  startDate: string;
  endDate: string;
} {
  const win = analysisWindowFromPeriod(period, window);
  const start = Date.parse(`${win.startDate}T00:00:00Z`);
  const end = Date.parse(`${win.endDate}T00:00:00Z`);
  const calendarDays = Math.max(1, Math.round((end - start) / 86_400_000));
  const tradingApprox = Math.ceil((calendarDays * 5) / 7);
  const limit = Math.min(5000, tradingApprox + TECHNICAL_WARMUP_BARS + FEATURE_MODEL_LOOKBACK_BARS);
  return {
    limit,
    lookback: period === 'CUSTOM' ? `${win.startDate}:${win.endDate}` : period,
    startDate: win.startDate,
    endDate: win.endDate,
  };
}

/** Local slice of a sufficient series for a shorter analysis window. */
export function sliceCandlesByLookback<T extends { time: number }>(
  candles: T[],
  lookbackBars: number,
): T[] {
  if (!candles.length || lookbackBars <= 0) return candles.slice();
  return candles.slice(-lookbackBars);
}
