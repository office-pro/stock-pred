import type { StockQuote } from '@stockpred/shared-types';
import { type IndexUniverseId, inIndexUniverse } from './index-universes';

export type RankFilter = 'PROFIT' | 'CONFIDENCE' | 'BULL';

export const BEST_PICK_MIN_CONFIDENCE = 75;
export const BEST_PICK_MIN_PROFIT_PCT = 2;

export function profitPct(stock: StockQuote): number {
  if (stock.entry != null && stock.target != null && stock.entry > 0) {
    return (Math.abs(stock.target - stock.entry) / stock.entry) * 100;
  }
  return Math.abs(stock.expectedMove ?? 0);
}

export function isBullRunStock(stock: StockQuote): boolean {
  const snapshot = stock.scanner;
  if (!snapshot) return false;
  return (
    snapshot.band === 'BULL_RUN_CANDIDATE' ||
    snapshot.band === 'STRONG_BULLISH' ||
    snapshot.bullScore >= 70
  );
}

export function isBestPickQuality(stock: StockQuote): boolean {
  return (
    (stock.suggestion === 'BUY' || stock.suggestion === 'SELL') &&
    (stock.confidence ?? 0) >= BEST_PICK_MIN_CONFIDENCE &&
    profitPct(stock) >= BEST_PICK_MIN_PROFIT_PCT
  );
}

export function maxProfitAmong(rows: StockQuote[]): { pct: number; symbol: string | null } {
  let pct = 0;
  let symbol: string | null = null;
  for (const row of rows) {
    const next = profitPct(row);
    if (next > pct) {
      pct = next;
      symbol = row.symbol;
    }
  }
  return { pct, symbol };
}

/**
 * Filter then rank. Max profit is always the primary key when it is selected,
 * so the highest Profit % is row 1 even if Max confidence is also on.
 */
export function rankQuotes(
  rows: StockQuote[],
  options: {
    bestPick: boolean;
    suggestion: 'ALL' | 'BUY' | 'SELL';
    filters: RankFilter[];
    search?: string;
    universe?: IndexUniverseId;
  },
): StockQuote[] {
  let out = rows;
  const query = options.search?.trim().toUpperCase();
  if (query) {
    out = out.filter((row) => row.symbol.includes(query) || row.name.toUpperCase().includes(query));
  }
  if (options.universe && options.universe !== 'all') {
    out = out.filter((row) => inIndexUniverse(row.symbol, options.universe as IndexUniverseId));
  }
  if (options.bestPick) {
    out = out.filter(isBestPickQuality);
  } else if (options.suggestion === 'ALL') {
    // keep Holds on NSE/BSE unless a rank filter needs an action
  }
  if (options.suggestion === 'BUY' || options.suggestion === 'SELL') {
    out = out.filter((row) => row.suggestion === options.suggestion);
  }
  if (options.filters.includes('BULL')) {
    out = out.filter(isBullRunStock);
  }

  const wantProfit = options.filters.includes('PROFIT');
  const wantConf = options.filters.includes('CONFIDENCE');
  const wantBull = options.filters.includes('BULL');

  return [...out].sort((a, b) => {
    if (wantProfit) {
      return (
        profitPct(b) - profitPct(a) ||
        (wantConf ? b.confidence - a.confidence : 0) ||
        (wantBull ? (b.scanner?.bullScore ?? 0) - (a.scanner?.bullScore ?? 0) : 0) ||
        a.symbol.localeCompare(b.symbol)
      );
    }
    if (wantConf) {
      return (
        b.confidence - a.confidence ||
        profitPct(b) - profitPct(a) ||
        (wantBull ? (b.scanner?.bullScore ?? 0) - (a.scanner?.bullScore ?? 0) : 0) ||
        a.symbol.localeCompare(b.symbol)
      );
    }
    if (wantBull) {
      return (
        (b.scanner?.bullScore ?? 0) - (a.scanner?.bullScore ?? 0) ||
        profitPct(b) - profitPct(a) ||
        a.symbol.localeCompare(b.symbol)
      );
    }
    if (options.bestPick) {
      return (
        b.confidence * profitPct(b) - a.confidence * profitPct(a) ||
        profitPct(b) - profitPct(a) ||
        a.symbol.localeCompare(b.symbol)
      );
    }
    return a.symbol.localeCompare(b.symbol);
  });
}
