import type { BacktestMetrics, Candle, MarketBreadth } from '@stockpred/shared-types';
import { computeIndicatorSnapshot } from './indicators';
import { computeMarketBreadth, sampleFromCandles } from './breadth';
import { classifyMarketRegime } from './regime';
import { profitFactor, winRate } from './metrics';
import { round2 } from './math';
import { buildBullRunSnapshot } from './scanner';

export interface ScannerBacktestTrade {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  bullScore: number;
  expectedReturn20d: number | null;
  realizedReturn20d: number;
  correctDirection: boolean;
}

export interface ScannerBacktestResult {
  signals: number;
  winRate: number;
  averageReturn: number;
  medianReturn: number;
  maxReturn: number;
  maxLoss: number;
  profitFactor: number;
  calibrationError: number | null;
  byRegime: Record<string, { signals: number; hitRate: number }>;
  trades: ScannerBacktestTrade[];
  metrics: Pick<BacktestMetrics, 'totalTrades' | 'winRate' | 'profitFactor' | 'totalReturnPercent'>;
}

const WARMUP = 220;
const HOLD_BARS = 20;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Replay bull-run candidate entries on closed bars only. Exit after 20 sessions.
 * Uses the same snapshot builder as the live scanner.
 */
export function runScannerBacktest(
  candles: Candle[],
  niftyCandles: Candle[],
  minBullScore = 70,
): ScannerBacktestResult {
  const trades: ScannerBacktestTrade[] = [];
  const byRegime: Record<string, { hits: number; n: number }> = {};
  let inPositionUntil = -1;

  for (let i = WARMUP; i < candles.length - HOLD_BARS; i += 1) {
    if (i < inPositionUntil) continue;
    const window = candles.slice(0, i + 1);
    const niftyWindow = niftyCandles.filter((c) => c.time <= window[window.length - 1].time);
    const indicators = computeIndicatorSnapshot(window[0].symbol, window);
    const breadth: MarketBreadth = computeMarketBreadth(
      [sampleFromCandles(window, indicators)].filter(Boolean) as NonNullable<
        ReturnType<typeof sampleFromCandles>
      >[],
      window[window.length - 1].time,
    );
    // Single-name breadth is a placeholder when the caller does not pass a universe.
    const regime = classifyMarketRegime(niftyWindow, breadth, null);
    const snapshot = buildBullRunSnapshot({
      symbol: window[0].symbol,
      candles: window,
      indicators,
      niftyCandles: niftyWindow,
      breadth,
      regime,
    });
    if (!snapshot || snapshot.bullScore < minBullScore) continue;
    const entry = window[window.length - 1];
    const exit = candles[i + HOLD_BARS];
    const realized = entry.close > 0 ? ((exit.close - entry.close) / entry.close) * 100 : 0;
    const expected = snapshot.forecast?.expectedReturn20d ?? null;
    const trade: ScannerBacktestTrade = {
      entryTime: entry.time,
      entryPrice: round2(entry.close),
      exitTime: exit.time,
      exitPrice: round2(exit.close),
      bullScore: snapshot.bullScore,
      expectedReturn20d: expected,
      realizedReturn20d: round2(realized),
      correctDirection:
        (expected ?? 0) === 0 ? realized === 0 : expected! > 0 ? realized > 0 : realized < 0,
    };
    trades.push(trade);
    inPositionUntil = i + HOLD_BARS;
    const bucket = byRegime[regime] ?? { hits: 0, n: 0 };
    bucket.n += 1;
    if (trade.correctDirection) bucket.hits += 1;
    byRegime[regime] = bucket;
  }

  const returns = trades.map((t) => t.realizedReturn20d);
  const withExpected = trades.filter((t) => t.expectedReturn20d !== null);
  const calibrationError =
    withExpected.length === 0
      ? null
      : round2(
          withExpected.reduce(
            (s, t) => s + Math.abs((t.expectedReturn20d ?? 0) - t.realizedReturn20d),
            0,
          ) / withExpected.length,
        );

  return {
    signals: trades.length,
    winRate: round2(winRate(returns)),
    averageReturn: round2(returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0),
    medianReturn: round2(median(returns)),
    maxReturn: round2(returns.length ? Math.max(...returns) : 0),
    maxLoss: round2(returns.length ? Math.min(...returns) : 0),
    profitFactor: round2(profitFactor(returns)),
    calibrationError,
    byRegime: Object.fromEntries(
      Object.entries(byRegime).map(([k, v]) => [
        k,
        { signals: v.n, hitRate: round2(v.n ? v.hits / v.n : 0) },
      ]),
    ),
    trades: trades.slice(-50),
    metrics: {
      totalTrades: trades.length,
      winRate: round2(winRate(returns)),
      profitFactor: round2(profitFactor(returns)),
      totalReturnPercent: round2(returns.reduce((s, r) => s + r, 0)),
    },
  };
}
