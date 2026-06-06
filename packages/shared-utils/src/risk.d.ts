/**
 * Position sizing: risk a fixed percentage of capital per trade
 * (spec default: 1%). Quantity is derived from the entry-stop distance.
 */
export declare function positionSize(capital: number, riskPercent: number, entryPrice: number, stopLoss: number): number;
/** Risk-reward ratio of a long setup. */
export declare function riskRewardRatio(entry: number, target: number, stopLoss: number): number;
//# sourceMappingURL=risk.d.ts.map