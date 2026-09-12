import type {
  HistoricalDecisionContext,
  PaperHolding,
  WalkForwardOpportunity,
  WalkForwardRegimeSnapshot,
} from '@stockpred/shared-types';

export interface FutureDataViolation {
  path: string;
  timestamp: number;
  decisionTime: number;
}

function collectTimestamps(
  value: unknown,
  path: string,
  out: Array<{ path: string; timestamp: number }>,
): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectTimestamps(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        (key === 'timestamp' ||
          key === 'generatedAt' ||
          key === 'updatedAt' ||
          key === 'quoteTimestamp' ||
          key === 'asOf' ||
          key === 'openedAt' ||
          key.endsWith('Timestamp') ||
          key.endsWith('At')) &&
        typeof child === 'number' &&
        Number.isFinite(child) &&
        child > 1_000_000_000_000
      ) {
        out.push({ path: `${path}.${key}`, timestamp: child });
      }
      collectTimestamps(child, path ? `${path}.${key}` : key, out);
    }
  }
}

/** Throws (or returns) if any nested decision-time timestamp is after T. */
export function assertNoFutureData(
  context: HistoricalDecisionContext | Record<string, unknown>,
  decisionTime: number,
  opts?: { throwOnViolation?: boolean },
): FutureDataViolation[] {
  const found: Array<{ path: string; timestamp: number }> = [];
  collectTimestamps(context, 'context', found);
  const violations = found
    .filter((row) => row.timestamp > decisionTime)
    .map((row) => ({
      path: row.path,
      timestamp: row.timestamp,
      decisionTime,
    }));
  if (violations.length > 0 && opts?.throwOnViolation !== false) {
    const first = violations[0];
    throw new Error(
      `Future data at ${first.path}: ${first.timestamp} > decisionTime ${decisionTime}`,
    );
  }
  return violations;
}

export function buildHistoricalDecisionContext(input: {
  opportunity: WalkForwardOpportunity;
  cash: number;
  equity: number;
  dayStartEquity: number;
  weekStartEquity: number;
  positions: PaperHolding[];
}): HistoricalDecisionContext {
  const { opportunity } = input;
  const regimeSnapshot: WalkForwardRegimeSnapshot = opportunity.regimeSnapshot;
  return {
    timestamp: opportunity.timestamp,
    symbol: opportunity.symbol.toUpperCase(),
    quote: { ...opportunity.quote },
    analysis: opportunity.analysis,
    scores: { ...opportunity.analysis.scores },
    marketRegime: opportunity.analysis.marketRegime,
    regimeSnapshot,
    sector: opportunity.sector ?? null,
    cash: input.cash,
    equity: input.equity,
    dayStartEquity: input.dayStartEquity,
    weekStartEquity: input.weekStartEquity,
    positions: input.positions.map((p) => ({ ...p })),
  };
}
