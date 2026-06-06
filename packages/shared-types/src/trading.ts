export enum TradingMode {
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum TradeExitReason {
  TARGET_HIT = 'TARGET_HIT',
  STOP_LOSS_HIT = 'STOP_LOSS_HIT',
  REVERSAL_SIGNAL = 'REVERSAL_SIGNAL',
  BEARISH_ML_PREDICTION = 'BEARISH_ML_PREDICTION',
  MANUAL = 'MANUAL',
}

export interface TradeOrder {
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  mode: TradingMode;
  target?: number;
  stopLoss?: number;
}

export interface ExecutedTrade extends TradeOrder {
  id: string;
  status: TradeStatus;
  exitPrice?: number;
  exitReason?: TradeExitReason;
  pnl?: number;
  executedAt: number;
  closedAt?: number;
}

/** Portfolio snapshot for the paper trading account. */
export interface PortfolioSnapshot {
  mode: TradingMode;
  capital: number;
  equity: number;
  cash: number;
  openPositions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  circuitBreakerTripped: boolean;
}

/** Risk limits enforced by the auto trader (spec: 1% / 3% / 8%). */
export interface RiskLimits {
  perTradeRiskPercent: number;
  dailyDrawdownPercent: number;
  weeklyDrawdownPercent: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  perTradeRiskPercent: 1,
  dailyDrawdownPercent: 3,
  weeklyDrawdownPercent: 8,
};
