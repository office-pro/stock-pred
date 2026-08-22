import type { PaperHolding, PortfolioSnapshot } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import { emptyPortfolioSnapshot } from './portfolio';

export interface SimulatedPosition extends PaperHolding {
  decisionId?: string;
  opportunityId?: string;
  openedAt: number;
}

export interface RecentSubmit {
  symbol: string;
  timestamp: number;
}

/**
 * In-memory book for walk-forward. Mutate on accept BEFORE the next opportunity.
 */
export class SimulatedBook {
  cash: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dayStartEquity: number;
  weekStartEquity: number;
  positions: SimulatedPosition[] = [];
  recentSubmits: RecentSubmit[] = [];
  readonly initialCash: number;

  constructor(initialCash: number, opts?: { dayStartEquity?: number; weekStartEquity?: number }) {
    this.initialCash = initialCash;
    this.cash = initialCash;
    this.equity = initialCash;
    this.realizedPnl = 0;
    this.unrealizedPnl = 0;
    this.dayStartEquity = opts?.dayStartEquity ?? initialCash;
    this.weekStartEquity = opts?.weekStartEquity ?? initialCash;
  }

  get sectorExposure(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.positions) {
      const sector = p.sector ?? 'UNKNOWN';
      out[sector] = (out[sector] ?? 0) + p.quantity * p.currentPrice;
    }
    return out;
  }

  lastSubmit(symbol: string): number | null {
    const key = symbol.toUpperCase();
    let latest: number | null = null;
    for (const row of this.recentSubmits) {
      if (row.symbol === key && (latest == null || row.timestamp > latest)) {
        latest = row.timestamp;
      }
    }
    return latest;
  }

  recordSubmit(symbol: string, timestamp: number): void {
    this.recentSubmits.push({ symbol: symbol.toUpperCase(), timestamp });
  }

  toPortfolioSnapshot(): PortfolioSnapshot {
    const holdings = this.positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      target: p.target,
      stopLoss: p.stopLoss,
      unrealizedPnl: p.unrealizedPnl,
      sector: p.sector,
      openedAt: p.openedAt,
    }));
    return {
      ...emptyPortfolioSnapshot(TradingMode.PAPER, this.initialCash),
      equity: this.equity,
      cash: this.cash,
      openPositions: holdings.length,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      holdings,
      dayStartEquity: this.dayStartEquity,
      weekStartEquity: this.weekStartEquity,
    };
  }

  openPosition(input: {
    symbol: string;
    quantity: number;
    entryPrice: number;
    fillCost: number;
    target: number;
    stopLoss: number;
    sector?: string | null;
    openedAt: number;
    decisionId?: string;
    opportunityId?: string;
  }): void {
    this.cash -= input.fillCost;
    this.positions.push({
      symbol: input.symbol.toUpperCase(),
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      currentPrice: input.entryPrice,
      target: input.target,
      stopLoss: input.stopLoss,
      unrealizedPnl: 0,
      sector: input.sector ?? null,
      openedAt: input.openedAt,
      decisionId: input.decisionId,
      opportunityId: input.opportunityId,
    });
    this.revalue();
  }

  closePosition(symbol: string, exitProceeds: number, realizedPnl: number): void {
    const key = symbol.toUpperCase();
    const idx = this.positions.findIndex((p) => p.symbol === key);
    if (idx < 0) return;
    this.positions.splice(idx, 1);
    this.cash += exitProceeds;
    this.realizedPnl += realizedPnl;
    this.revalue();
  }

  markPrice(symbol: string, price: number): void {
    const key = symbol.toUpperCase();
    for (const p of this.positions) {
      if (p.symbol === key) {
        p.currentPrice = price;
        p.unrealizedPnl = (price - p.entryPrice) * p.quantity;
      }
    }
    this.revalue();
  }

  private revalue(): void {
    let unrealized = 0;
    let market = 0;
    for (const p of this.positions) {
      unrealized += p.unrealizedPnl;
      market += p.quantity * p.currentPrice;
    }
    this.unrealizedPnl = unrealized;
    this.equity = this.cash + market;
  }
}
