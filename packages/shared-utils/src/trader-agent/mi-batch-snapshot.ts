/**
 * MI-5 helpers: membership equality, IntelligenceContext from frozen row + MI bundle.
 */

import type {
  BatchDataSnapshot,
  BatchInstrumentData,
  InstrumentMiBundle,
  InstrumentRef,
  IntelligenceContext,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import { nseEquityInstrumentRef } from './market-intelligence-core';

export function symbolSetEqual(a: string[], b: string[]): boolean {
  const left = new Set(a.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const right = new Set(b.map((s) => s.trim().toUpperCase()).filter(Boolean));
  if (left.size !== right.size) return false;
  for (const s of left) if (!right.has(s)) return false;
  return true;
}

export function assertSnapshotMembershipMatchesBatch(input: {
  batchSymbols: string[];
  snapshot: Pick<BatchDataSnapshot, 'instruments'>;
}): { ok: true } | { ok: false; reason: string } {
  const snapSyms = input.snapshot.instruments.map((r) => r.instrumentRef.symbol);
  if (!symbolSetEqual(input.batchSymbols, snapSyms)) {
    return {
      ok: false,
      reason: `GENERATION_INPUT_INCOMPLETE:MEMBERSHIP_MISMATCH:batch=${input.batchSymbols.length}:snapshot=${snapSyms.length}`,
    };
  }
  return { ok: true };
}

export function technicalFromFrozenRow(
  row: BatchInstrumentData | undefined,
): InstrumentMiBundle['technical'] {
  if (!row?.candles?.length) {
    return { status: 'UNAVAILABLE', source: 'ENGINE_DERIVED' };
  }
  const t = row.technicals;
  if (!t || t.source !== 'ENGINE_DERIVED') {
    return { status: 'UNAVAILABLE', source: 'ENGINE_DERIVED' };
  }
  const hasAny =
    t.rsi != null || t.ema20 != null || t.ema50 != null || t.macd != null || t.atr != null;
  if (!hasAny) {
    return { status: 'UNAVAILABLE', source: 'ENGINE_DERIVED', asOf: t.asOf };
  }
  return {
    status: 'AVAILABLE',
    source: 'ENGINE_DERIVED',
    rsi: t.rsi,
    ema20: t.ema20,
    ema50: t.ema50,
    ema200: t.ema200,
    macd: t.macd,
    atr: t.atr,
    asOf: t.asOf,
  };
}

export function buildIntelligenceContext(input: {
  dataSnapshotVersion: string;
  miSnapshot: MarketIntelligenceBatchSnapshot;
  symbol: string;
  instrument?: InstrumentRef;
  row?: BatchInstrumentData;
  advancedIntelligenceSnapshotId?: string;
  advancedIntelligence?: import('@stockpred/shared-types').AdvancedInstrumentIntelligence;
}): IntelligenceContext | null {
  const sym = input.symbol.trim().toUpperCase();
  const bundle = input.miSnapshot.bySymbol[sym];
  if (!bundle) return null;
  const instrument = input.instrument ?? bundle.instrument ?? nseEquityInstrumentRef(sym);
  return {
    dataSnapshotVersion: input.dataSnapshotVersion,
    marketIntelligenceSnapshotId: input.miSnapshot.snapshotId,
    ...(input.advancedIntelligenceSnapshotId
      ? { advancedIntelligenceSnapshotId: input.advancedIntelligenceSnapshotId }
      : {}),
    ...(input.advancedIntelligence ? { advancedIntelligence: input.advancedIntelligence } : {}),
    instrument,
    asOf: input.miSnapshot.asOf,
    technical: technicalFromFrozenRow(input.row) ?? bundle.technical,
    fundamentals: bundle.fundamentals,
    news: bundle.news,
    sentiment: bundle.sentiment,
    corporateEvents: bundle.corporateEvents,
  };
}

/** Project MI fundamentals into FundamentalPayload shape used by IntelligenceSnapshot. */
export function fundamentalPayloadFromMiBundle(
  bundle: InstrumentMiBundle | undefined,
): import('@stockpred/shared-types').FundamentalPayload | undefined {
  if (!bundle) return undefined;
  if (bundle.fundamentals.status === 'UNAVAILABLE' || bundle.fundamentals.facts.length === 0) {
    return {
      kind: 'UNAVAILABLE',
      reasonCode: 'NOT_IN_MI_SNAPSHOT',
      message: 'No PIT fundamentals in MarketIntelligenceBatchSnapshot',
    };
  }
  const byMetric = new Map(bundle.fundamentals.facts.map((f) => [f.metric, f.value] as const));
  const asOf = Date.parse(bundle.fundamentals.facts[0]?.availableAt ?? '');
  const num = (v: number | null | undefined): number | undefined =>
    v != null && Number.isFinite(v) ? v : undefined;
  return {
    kind: 'EQUITY_STATEMENTS',
    revenue: num(byMetric.get('revenue')),
    netIncome: num(byMetric.get('pat') ?? byMetric.get('netIncome')),
    roe: num(byMetric.get('roe')),
    pe: num(byMetric.get('pe')),
    pb: num(byMetric.get('pb')),
    asOf: Number.isFinite(asOf) ? asOf : undefined,
  };
}

export function newsBlockFromMiBundle(
  bundle: InstrumentMiBundle | undefined,
): import('@stockpred/shared-types').IntelligenceNewsBlock | undefined {
  if (!bundle || bundle.news.status === 'NOT_APPLICABLE') return undefined;
  if (bundle.news.status === 'UNAVAILABLE' || bundle.news.items.length === 0) {
    return { reasonCode: 'NOT_IN_MI_SNAPSHOT', source: 'SOURCE_REPORTED' };
  }
  const latest = bundle.news.items
    .map((i) => Date.parse(i.availableAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  return {
    headlineCount: bundle.news.items.length,
    asOf: latest,
    source: 'SOURCE_REPORTED',
  };
}

export function sentimentFromMiBundle(
  bundle: InstrumentMiBundle | undefined,
): import('@stockpred/shared-types').BatchSentiment {
  if (!bundle) return null;
  if (bundle.sentiment.availability === 'NOT_APPLICABLE') return null;
  if (bundle.sentiment.availability === 'UNAVAILABLE') return null;
  if (bundle.sentiment.score == null || !Number.isFinite(bundle.sentiment.score)) return null;
  return { source: 'MODEL_DERIVED', score: bundle.sentiment.score };
}

export function validateMiSnapshotForGenerate(input: {
  miSnapshot: MarketIntelligenceBatchSnapshot;
  batchSymbols: string[];
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
}): { ok: true } | { ok: false; reason: string } {
  const miSyms = input.miSnapshot.instruments.map((i) => i.symbol);
  if (!symbolSetEqual(input.batchSymbols, miSyms)) {
    return {
      ok: false,
      reason: `GENERATION_INPUT_INCOMPLETE:MI_MEMBERSHIP_MISMATCH`,
    };
  }
  const mode = String(input.miMode ?? 'STANDARD').toUpperCase();
  if (mode === 'STANDARD' || mode === 'ADVANCED') {
    // Hard incomplete only if zero fundamentals when STANDARD/ADVANCED required.
    // CUSTOM may proceed with empty MI (optional sections). Soft: allow PARTIAL
    // coverage if at least some fundamentals exist — Gate was MI-4.
    if (input.miSnapshot.coverage.fundamentalsAvailable === 0) {
      return {
        ok: false,
        reason: 'GENERATION_INPUT_INCOMPLETE:FUNDAMENTALS_MISSING',
      };
    }
    if (mode === 'ADVANCED' && input.miSnapshot.coverage.newsAvailable === 0) {
      return {
        ok: false,
        reason: 'GENERATION_INPUT_INCOMPLETE:NEWS_MISSING',
      };
    }
  }
  return { ok: true };
}
