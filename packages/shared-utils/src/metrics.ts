import { mean, std } from './math';

const TRADING_DAYS_PER_YEAR = 252;
/** Approximate Indian risk-free rate (10y G-Sec). */
const RISK_FREE_ANNUAL = 0.065;
/** Cap used instead of Infinity so results stay JSON-serializable. */
const PROFIT_FACTOR_CAP = 999;

export function periodicReturns(equity: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    if (equity[i - 1] !== 0) returns.push(equity[i] / equity[i - 1] - 1);
  }
  return returns;
}

export function sharpeRatio(returns: number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number {
  if (returns.length < 2) return 0;
  const rfPerPeriod = RISK_FREE_ANNUAL / periodsPerYear;
  const excess = returns.map((r) => r - rfPerPeriod);
  const deviation = std(excess);
  if (deviation === 0) return 0;
  return (mean(excess) / deviation) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(returns: number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number {
  if (returns.length < 2) return 0;
  const rfPerPeriod = RISK_FREE_ANNUAL / periodsPerYear;
  const excess = returns.map((r) => r - rfPerPeriod);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return PROFIT_FACTOR_CAP;
  const downsideDeviation = Math.sqrt(mean(downside.map((r) => r ** 2)));
  if (downsideDeviation === 0) return 0;
  return (mean(excess) / downsideDeviation) * Math.sqrt(periodsPerYear);
}

export function cagr(initial: number, final: number, years: number): number {
  if (initial <= 0 || years <= 0) return 0;
  if (final <= 0) return -100;
  return ((final / initial) ** (1 / years) - 1) * 100;
}

/** Maximum peak-to-trough drawdown, returned as a positive percentage. */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const dd = ((peak - value) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function profitFactor(pnls: number[]): number {
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  if (grossLoss === 0) return grossProfit > 0 ? PROFIT_FACTOR_CAP : 0;
  return grossProfit / grossLoss;
}

export function winRate(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return (pnls.filter((p) => p > 0).length / pnls.length) * 100;
}
