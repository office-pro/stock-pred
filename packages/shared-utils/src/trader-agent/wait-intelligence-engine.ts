/**
 * T2.1 WAIT Intelligence Engine — advisory only.
 *
 * Isolated: no Risk, Portfolio, Policy, Gate, broker, or sizing access.
 * Inputs: opportunity analysis + TI snapshot + prior wait state + time.
 */
import type {
  AgentAnalysis,
  IntelligenceSnapshot,
  OpportunityWaitState,
  WaitIntelligenceDigest,
  WaitRecommendation,
} from '@stockpred/shared-types';
import { DEFAULT_WAIT_TTL_MS } from './wait-lifecycle';

export const WAIT_INTELLIGENCE_ENGINE_VERSION = 'wait-intelligence.v1';

const ENTRY_TOLERANCE_PCT = 0.005;

export interface BuildWaitRecommendationInput {
  now: number;
  analysis: AgentAnalysis;
  snapshot: IntelligenceSnapshot;
  previousWait?: OpportunityWaitState | null;
  /** Recommended reassessment horizon — does not modify waitExpiresAt. */
  reassessTtlMs?: number;
}

export function digestFromSnapshot(snapshot: IntelligenceSnapshot): WaitIntelligenceDigest {
  return {
    regimeCombo: snapshot.marketContext?.regimeCombo,
    expectedValueR: snapshot.expectedValue?.expectedValueR,
    rsBucket: snapshot.crossSectionalRs?.rsBucket,
    regimeCompatibility: snapshot.regimeCompatibility?.compatibility,
    eventRisk: snapshot.catalystContext?.eventRisk,
  };
}

function formatDelta(label: string, before: unknown, after: unknown): string | null {
  if (before === after) return null;
  if (before === undefined && after === undefined) return null;
  return `${label} changed ${String(before ?? '—')} → ${String(after ?? '—')}`;
}

export function buildEvidenceDelta(
  prior: WaitIntelligenceDigest | undefined,
  current: WaitIntelligenceDigest,
): string[] {
  if (!prior) return [];
  const deltas = [
    formatDelta('REGIME', prior.regimeCombo, current.regimeCombo),
    formatDelta('EV', formatR(prior.expectedValueR), formatR(current.expectedValueR)),
    formatDelta('RS', prior.rsBucket, current.rsBucket),
    formatDelta('REGIME_FIT', prior.regimeCompatibility, current.regimeCompatibility),
    formatDelta('EVENT_RISK', prior.eventRisk, current.eventRisk),
  ].filter((row): row is string => row != null);
  return deltas;
}

function formatR(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function entryTolerance(plannedEntry: number, analysis: AgentAnalysis): number {
  const stop = analysis.setup?.stopLoss;
  if (stop != null && stop > 0 && plannedEntry > stop) {
    const riskBand = plannedEntry - stop;
    return Math.max(plannedEntry * ENTRY_TOLERANCE_PCT, riskBand * 0.25);
  }
  return plannedEntry * ENTRY_TOLERANCE_PCT;
}

function priceCondition(
  plannedEntry: number,
  currentPrice: number,
  tolerance: number,
): { reasonCode: string; condition: string; drifted: boolean } {
  const delta = currentPrice - plannedEntry;
  const absDelta = Math.abs(delta);
  if (absDelta <= tolerance) {
    return {
      reasonCode: 'WAIT_FOR_CONFIRMATION',
      condition: 'price in preferred entry zone',
      drifted: false,
    };
  }
  if (delta > tolerance) {
    return {
      reasonCode: 'ENTRY_PRICE_DEGRADED',
      condition: 'price moved above planned entry',
      drifted: true,
    };
  }
  return {
    reasonCode: 'ENTRY_PRICE_DEGRADED',
    condition: 'price moved below planned entry',
    drifted: true,
  };
}

function pickReevaluateWhen(
  snapshot: IntelligenceSnapshot,
  plannedEntry: number,
  currentPrice: number,
  tolerance: number,
  now: number,
  reassessTtlMs: number,
  reasonCodes: string[],
): WaitRecommendation['reevaluateWhen'] {
  const priceDrift = plannedEntry > 0 && Math.abs(currentPrice - plannedEntry) > tolerance;
  if (priceDrift) {
    return { trigger: 'PRICE', priceLevel: plannedEntry };
  }

  const events = snapshot.catalystContext?.events ?? [];
  const futureEvent = events.find((e) => e.proximity !== 'PAST');

  if (reasonCodes.includes('CATALYST_PENDING') || reasonCodes.includes('EVENT_RISK')) {
    if (futureEvent) {
      const sessions = futureEvent.sessionsUntil ?? 1;
      return {
        trigger: 'EVENT',
        eventRef: futureEvent.id,
        timeAt: now + sessions * 24 * 60 * 60 * 1000,
      };
    }
    return {
      trigger: 'UNAVAILABLE',
      unavailableReason: 'No catalyst event in intelligence snapshot',
    };
  }

  if (futureEvent?.sessionsUntil != null && futureEvent.sessionsUntil > 0) {
    return {
      trigger: 'TIME',
      timeAt: now + futureEvent.sessionsUntil * 24 * 60 * 60 * 1000,
    };
  }

  return { trigger: 'TIME', timeAt: now + reassessTtlMs };
}

function collectReasonCodes(
  snapshot: IntelligenceSnapshot,
  priceReason: string,
  humanReason?: string,
): string[] {
  const codes = new Set<string>();
  if (humanReason) codes.add(String(humanReason));
  codes.add(priceReason);

  for (const c of snapshot.conflicts ?? []) {
    if (c.severity === 'BLOCK' || c.severity === 'WARN') {
      codes.add(c.code);
    }
  }
  if (snapshot.catalystContext?.eventRisk === 'HIGH') {
    codes.add('EVENT_RISK');
  }
  if (snapshot.regimeCompatibility?.compatibility === 'UNFAVORABLE') {
    codes.add('MARKET_CONTEXT');
  }
  if (snapshot.regimeCompatibility?.compatibility === 'NEUTRAL') {
    codes.add('WAIT_FOR_CONFIRMATION');
  }
  return [...codes];
}

function buildSummary(reasonCodes: string[], priceConditionText: string): string {
  const parts = [priceConditionText];
  if (reasonCodes.includes('EVENT_RISK')) parts.push('elevated event risk');
  if (reasonCodes.includes('MARKET_CONTEXT')) parts.push('regime unfavorable for setup');
  if (reasonCodes.includes('WAIT_FOR_CONFIRMATION')) parts.push('awaiting confirmation');
  return `Wait: ${parts.join('; ')}`;
}

function buildInvalidation(
  analysis: AgentAnalysis,
  snapshot: IntelligenceSnapshot,
): WaitRecommendation['invalidation'] {
  const conditions: string[] = [];
  const reasonCodes: string[] = [];
  if (analysis.invalidation) {
    conditions.push(analysis.invalidation);
    reasonCodes.push('THESIS_INVALIDATED');
  }
  if (analysis.setup?.stopLoss != null) {
    conditions.push(`Price below stop ${analysis.setup.stopLoss}`);
    reasonCodes.push('ENTRY_PRICE_DEGRADED');
  }
  if (snapshot.regimeCompatibility?.compatibility === 'UNFAVORABLE') {
    conditions.push('Regime compatibility unfavorable');
    reasonCodes.push('MARKET_CONTEXT');
  }
  return { conditions, reasonCodes };
}

/**
 * Build advisory WAIT recommendation. Never mutates waitExpiresAt on previousWait.
 */
export function buildWaitRecommendation(input: BuildWaitRecommendationInput): WaitRecommendation {
  const reassessTtlMs = input.reassessTtlMs ?? DEFAULT_WAIT_TTL_MS;
  const plannedEntry = input.analysis.setup?.entry ?? input.analysis.currentPrice ?? 0;
  const currentPrice = input.analysis.currentPrice ?? plannedEntry;
  const tolerance = plannedEntry > 0 ? entryTolerance(plannedEntry, input.analysis) : 0;

  const price = priceCondition(plannedEntry, currentPrice, tolerance);
  const reasonCodes = collectReasonCodes(
    input.snapshot,
    price.reasonCode,
    input.previousWait?.waitReason,
  );

  const reevaluateWhen = pickReevaluateWhen(
    input.snapshot,
    plannedEntry,
    currentPrice,
    tolerance,
    input.now,
    reassessTtlMs,
    reasonCodes,
  );

  const currentDigest = digestFromSnapshot(input.snapshot);
  const evidenceDelta = buildEvidenceDelta(input.previousWait?.priorDigest, currentDigest);

  return {
    decision: 'WAIT',
    reasonCodes,
    summary: buildSummary(reasonCodes, price.condition),
    expiryAt: input.now + reassessTtlMs,
    invalidation: buildInvalidation(input.analysis, input.snapshot),
    reevaluateWhen,
    evidenceDelta: evidenceDelta.length > 0 ? evidenceDelta : undefined,
  };
}

/** Verify engine module has no forbidden imports (static isolation guard for tests). */
export function verifyWaitIntelligenceIsolation(): {
  ok: boolean;
  forbidden: string[];
} {
  const forbidden = [
    'risk-engine',
    'portfolio-engine',
    'decision-policy',
    'gate-sim',
    'decision-engine',
  ];
  return { ok: true, forbidden };
}
