/**
 * Position sizing: risk a fixed percentage of capital per trade
 * (spec default: 1%). Quantity is derived from the entry-stop distance.
 */
export function positionSize(
  capital: number,
  riskPercent: number,
  entryPrice: number,
  stopLoss: number,
): number {
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare <= 0 || capital <= 0 || riskPercent <= 0) return 0;
  const riskBudget = (capital * riskPercent) / 100;
  const byRisk = Math.floor(riskBudget / riskPerShare);
  // Never size beyond what the capital can actually buy.
  const byCapital = entryPrice > 0 ? Math.floor(capital / entryPrice) : 0;
  return Math.max(0, Math.min(byRisk, byCapital));
}

/** Risk-reward ratio of a long setup. */
export function riskRewardRatio(entry: number, target: number, stopLoss: number): number {
  const risk = entry - stopLoss;
  if (risk <= 0) return 0;
  return (target - entry) / risk;
}
