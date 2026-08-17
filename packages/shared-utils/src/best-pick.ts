import { TradeSuggestion } from '@stockpred/shared-types';

/** High-confidence floor for the Best Pick tape. */
export const BEST_PICK_MIN_CONFIDENCE = 75;
/** Minimum |target − entry| (or |expectedMove|) in percent. */
export const BEST_PICK_MIN_PROFIT_PCT = 2;
/** Cap so each side stays a short, ranked list. */
export const BEST_PICK_MAX_PER_SIDE = 12;

export type QuoteSortKey = 'all' | 'profit' | 'confidence' | 'bull' | 'best';

export type BestPickRow = {
  symbol: string;
  suggestion: TradeSuggestion;
  confidence: number;
  entry: number | null;
  target: number | null;
  expectedMove: number;
};

/** Expected paper profit in percent from target vs entry, else |expectedMove|. */
export function expectedProfitPct(row: {
  entry: number | null;
  target: number | null;
  expectedMove: number;
}): number {
  if (row.entry != null && row.target != null && row.entry > 0) {
    return (Math.abs(row.target - row.entry) / row.entry) * 100;
  }
  return Math.abs(row.expectedMove ?? 0);
}

/** Rank key: high confidence and high profit both lift the name. */
export function bestPickScore(row: {
  confidence: number;
  entry: number | null;
  target: number | null;
  expectedMove: number;
}): number {
  return row.confidence * expectedProfitPct(row);
}

function compareBestPicks(a: BestPickRow, b: BestPickRow): number {
  const score = bestPickScore(b) - bestPickScore(a);
  if (score !== 0) return score;
  const profit = expectedProfitPct(b) - expectedProfitPct(a);
  if (profit !== 0) return profit;
  const conf = b.confidence - a.confidence;
  if (conf !== 0) return conf;
  return a.symbol.localeCompare(b.symbol);
}

function isQualityPick(row: BestPickRow): boolean {
  return (
    (row.suggestion === 'BUY' || row.suggestion === 'SELL') &&
    row.confidence >= BEST_PICK_MIN_CONFIDENCE &&
    expectedProfitPct(row) >= BEST_PICK_MIN_PROFIT_PCT
  );
}

function takeSide<T extends BestPickRow>(rows: T[]): T[] {
  return rows.filter(isQualityPick).sort(compareBestPicks).slice(0, BEST_PICK_MAX_PER_SIDE);
}

/**
 * Curate Buy and Sell names that clear both a high-confidence and high-profit
 * bar, then rank by confidence × expected profit. ALL keeps both sides.
 */
export function selectBestPicks<T extends BestPickRow>(quotes: T[], side?: 'BUY' | 'SELL'): T[] {
  const actionable = quotes.filter((row) => row.suggestion === 'BUY' || row.suggestion === 'SELL');
  const pool = side ? actionable.filter((row) => row.suggestion === side) : actionable;
  if (side) return takeSide(pool);
  const buys = takeSide(pool.filter((row) => row.suggestion === 'BUY'));
  const sells = takeSide(pool.filter((row) => row.suggestion === 'SELL'));
  return [...buys, ...sells].sort(compareBestPicks);
}

export function maxProfitAmong<T extends BestPickRow>(
  rows: T[],
): { pct: number; symbol: string | null } {
  let pct = 0;
  let symbol: string | null = null;
  for (const row of rows) {
    const next = expectedProfitPct(row);
    if (next > pct) {
      pct = next;
      symbol = row.symbol;
    }
  }
  return { pct, symbol };
}

export function sortQuotesBy<T extends BestPickRow>(rows: T[], sort: QuoteSortKey): T[] {
  const copy = [...rows];
  if (sort === 'profit') {
    copy.sort(
      (a, b) =>
        expectedProfitPct(b) - expectedProfitPct(a) ||
        b.confidence - a.confidence ||
        a.symbol.localeCompare(b.symbol),
    );
    return copy;
  }
  if (sort === 'confidence') {
    copy.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        expectedProfitPct(b) - expectedProfitPct(a) ||
        a.symbol.localeCompare(b.symbol),
    );
    return copy;
  }
  if (sort === 'best') {
    copy.sort(compareBestPicks);
    return copy;
  }
  copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return copy;
}
