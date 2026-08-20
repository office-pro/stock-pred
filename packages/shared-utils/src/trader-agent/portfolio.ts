import type { PaperHolding, PortfolioSnapshot } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPaperHolding(value: unknown): value is PaperHolding {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.symbol === 'string' &&
    row.symbol.length > 0 &&
    isFiniteNumber(row.quantity) &&
    row.quantity > 0 &&
    isFiniteNumber(row.entryPrice) &&
    isFiniteNumber(row.currentPrice) &&
    isFiniteNumber(row.target) &&
    isFiniteNumber(row.stopLoss) &&
    isFiniteNumber(row.unrealizedPnl)
  );
}

/** Runtime guard for auto-trader GET /portfolio responses. */
export function isPortfolioSnapshot(value: unknown): value is PortfolioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const mode = row.mode;
  if (
    mode !== TradingMode.PAPER &&
    mode !== TradingMode.LIVE &&
    mode !== 'PAPER' &&
    mode !== 'LIVE'
  ) {
    return false;
  }
  if (!isFiniteNumber(row.capital) || row.capital < 0) return false;
  if (!isFiniteNumber(row.equity) || row.equity < 0) return false;
  if (!isFiniteNumber(row.cash) || row.cash < 0) return false;
  if (!isFiniteNumber(row.openPositions) || row.openPositions < 0) return false;
  if (!isFiniteNumber(row.realizedPnl)) return false;
  if (!isFiniteNumber(row.unrealizedPnl)) return false;
  if (typeof row.circuitBreakerTripped !== 'boolean') return false;
  if (!Array.isArray(row.holdings)) return false;
  if (!row.holdings.every(isPaperHolding)) return false;
  if (row.openPositions !== row.holdings.length) return false;
  return true;
}

export function emptyPortfolioSnapshot(
  mode: TradingMode = TradingMode.PAPER,
  capital = 0,
): PortfolioSnapshot {
  return {
    mode,
    capital,
    equity: capital,
    cash: capital,
    openPositions: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    circuitBreakerTripped: false,
    holdings: [],
  };
}
