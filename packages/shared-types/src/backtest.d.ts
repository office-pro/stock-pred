export type BacktestYears = 1 | 3 | 5 | 10;
export interface BacktestRequest {
    symbol: string;
    years: BacktestYears;
    initialCapital?: number;
    riskPerTradePercent?: number;
}
export interface BacktestTrade {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    exitReason: string;
}
export interface EquityPoint {
    time: number;
    equity: number;
}
/** Spec metrics: win rate, Sharpe, Sortino, CAGR, max drawdown, profit factor. */
export interface BacktestMetrics {
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    sortinoRatio: number;
    cagr: number;
    maxDrawdown: number;
    profitFactor: number;
    totalReturnPercent: number;
}
export interface BacktestResult {
    request: Required<BacktestRequest>;
    metrics: BacktestMetrics;
    trades: BacktestTrade[];
    equityCurve: EquityPoint[];
    startedAt: number;
    finishedAt: number;
}
//# sourceMappingURL=backtest.d.ts.map