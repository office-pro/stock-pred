'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.periodicReturns = periodicReturns;
exports.sharpeRatio = sharpeRatio;
exports.sortinoRatio = sortinoRatio;
exports.cagr = cagr;
exports.maxDrawdown = maxDrawdown;
exports.profitFactor = profitFactor;
exports.winRate = winRate;
const math_1 = require('./math');
const TRADING_DAYS_PER_YEAR = 252;
/** Approximate Indian risk-free rate (10y G-Sec). */
const RISK_FREE_ANNUAL = 0.065;
/** Cap used instead of Infinity so results stay JSON-serializable. */
const PROFIT_FACTOR_CAP = 999;
function periodicReturns(equity) {
  const returns = [];
  for (let i = 1; i < equity.length; i += 1) {
    if (equity[i - 1] !== 0) returns.push(equity[i] / equity[i - 1] - 1);
  }
  return returns;
}
function sharpeRatio(returns, periodsPerYear = TRADING_DAYS_PER_YEAR) {
  if (returns.length < 2) return 0;
  const rfPerPeriod = RISK_FREE_ANNUAL / periodsPerYear;
  const excess = returns.map((r) => r - rfPerPeriod);
  const deviation = (0, math_1.std)(excess);
  if (deviation === 0) return 0;
  return ((0, math_1.mean)(excess) / deviation) * Math.sqrt(periodsPerYear);
}
function sortinoRatio(returns, periodsPerYear = TRADING_DAYS_PER_YEAR) {
  if (returns.length < 2) return 0;
  const rfPerPeriod = RISK_FREE_ANNUAL / periodsPerYear;
  const excess = returns.map((r) => r - rfPerPeriod);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return PROFIT_FACTOR_CAP;
  const downsideDeviation = Math.sqrt((0, math_1.mean)(downside.map((r) => r ** 2)));
  if (downsideDeviation === 0) return 0;
  return ((0, math_1.mean)(excess) / downsideDeviation) * Math.sqrt(periodsPerYear);
}
function cagr(initial, final, years) {
  if (initial <= 0 || years <= 0) return 0;
  if (final <= 0) return -100;
  return ((final / initial) ** (1 / years) - 1) * 100;
}
/** Maximum peak-to-trough drawdown, returned as a positive percentage. */
function maxDrawdown(equity) {
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
function profitFactor(pnls) {
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  if (grossLoss === 0) return grossProfit > 0 ? PROFIT_FACTOR_CAP : 0;
  return grossProfit / grossLoss;
}
function winRate(pnls) {
  if (pnls.length === 0) return 0;
  return (pnls.filter((p) => p > 0).length / pnls.length) * 100;
}
//# sourceMappingURL=metrics.js.map
