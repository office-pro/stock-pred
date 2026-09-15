/**
 * B7 Continuous intelligence + PositionManagementPlan.
 * Reassessment / advisory only — never amends orders or calls evaluateTrade.
 */

import type {
  ContinuousDataStatus,
  ContinuousIntelligenceEvent,
  ContinuousPriority,
  ContinuousReassessmentResult,
  ContinuousTrigger,
  PositionManagementAction,
  PositionManagementPlan,
} from '@stockpred/shared-types';
import { INTELLIGENCE_BATCH_FEATURE_VERSION } from '@stockpred/shared-types';

export const CONTINUOUS_INTELLIGENCE_ENGINE_VERSION = 'continuous-intelligence.v1';

/** In-memory dedupe store for event idempotency (process-local). */
export class ContinuousEventDedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {}

  /** Returns true if this is the first observation of dedupeKey within TTL. */
  claim(dedupeKey: string, now = Date.now()): boolean {
    this.gc(now);
    if (this.seen.has(dedupeKey)) return false;
    this.seen.set(dedupeKey, now);
    return true;
  }

  has(dedupeKey: string, now = Date.now()): boolean {
    this.gc(now);
    return this.seen.has(dedupeKey);
  }

  private gc(now: number): void {
    for (const [k, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(k);
    }
  }
}

export function buildContinuousEvent(input: {
  eventId: string;
  symbol: string;
  priority: ContinuousPriority;
  trigger: ContinuousTrigger;
  dataStatus: ContinuousDataStatus;
  message: string;
  now?: number;
  positionId?: string;
  decisionId?: string;
  tradeId?: string;
  dedupeKey?: string;
}): ContinuousIntelligenceEvent {
  const occurredAt = input.now ?? Date.now();
  return {
    schemaVersion: 'continuous-intelligence-event.v1',
    eventId: input.eventId,
    symbol: input.symbol.toUpperCase(),
    priority: input.priority,
    trigger: input.trigger,
    dataStatus: input.dataStatus,
    message: input.message,
    dedupeKey:
      input.dedupeKey ??
      `${input.symbol.toUpperCase()}:${input.trigger}:${input.positionId ?? 'none'}:${input.eventId}`,
    occurredAt,
    positionId: input.positionId,
    decisionId: input.decisionId,
    tradeId: input.tradeId,
  };
}

export interface BuildPositionManagementPlanInput {
  event: ContinuousIntelligenceEvent;
  positionId: string;
  originalEntry: number;
  currentPrice: number;
  originalTarget?: number;
  originalStop?: number;
  thesisState?: string;
  cutoffReached?: boolean;
  planVersion?: number;
  tradeId?: string;
  decisionId?: string;
}

function actionFromContext(input: BuildPositionManagementPlanInput): PositionManagementAction {
  const { currentPrice, originalStop, originalTarget, cutoffReached, thesisState } = input;
  if (originalStop != null && currentPrice <= originalStop) return 'EXIT';
  if (thesisState === 'INVALIDATED') return 'EXIT';
  if (thesisState === 'WEAKENING') return 'TRIM';
  if (cutoffReached && thesisState === 'VALID') return 'EXTEND';
  if (cutoffReached) return 'TRIM';
  if (originalTarget != null && currentPrice >= originalTarget) return 'TRIM';
  return 'HOLD';
}

/**
 * Build PositionManagementPlan for a **real** open position only.
 * Never invents a position from research symbols.
 * Never amends broker orders.
 */
export function buildPositionManagementPlan(
  input: BuildPositionManagementPlanInput,
): PositionManagementPlan {
  const action = actionFromContext(input);
  const remainingUpsidePct =
    input.originalTarget != null && input.currentPrice > 0
      ? ((input.originalTarget - input.currentPrice) / input.currentPrice) * 100
      : undefined;

  const recommendation =
    action === 'EXIT' || action === 'TRIM' ? 'APPROVE' : action === 'EXTEND' ? 'WAIT' : 'WAIT';

  return {
    schemaVersion: 'position-management-plan.v1',
    planVersion: input.planVersion ?? 1,
    positionId: input.positionId,
    tradeId: input.tradeId ?? input.event.tradeId,
    decisionId: input.decisionId ?? input.event.decisionId,
    symbol: input.event.symbol,
    generatedAt: input.event.occurredAt,
    originalEntry: input.originalEntry,
    originalTarget: input.originalTarget,
    originalStop: input.originalStop,
    currentPrice: input.currentPrice,
    remainingUpsidePct,
    thesisState: input.thesisState,
    momentumState: input.thesisState === 'WEAKENING' ? 'WEAKENING' : 'STABLE',
    recommendedAction: action,
    exitRange:
      action === 'EXIT' || action === 'TRIM'
        ? {
            low: input.currentPrice * 0.99,
            high: input.currentPrice * 1.01,
          }
        : undefined,
    protectionPrice: input.originalStop,
    newTargetRange:
      action === 'EXTEND' && input.originalTarget != null
        ? {
            low: input.originalTarget,
            high: input.originalTarget * 1.05,
          }
        : undefined,
    cutoffStatus: input.cutoffReached ? (action === 'EXTEND' ? 'EXTENDED' : 'REACHED') : 'OPEN',
    reassessmentReason: `${input.event.trigger}: ${input.event.message}`,
    recommendation,
    provenance: {
      eventId: input.event.eventId,
      dataAsOf: input.event.occurredAt,
      intelligenceVersion: INTELLIGENCE_BATCH_FEATURE_VERSION,
    },
  };
}

/**
 * Process a continuous event with idempotent dedupe.
 * Duplicate dedupeKey → deduplicated=true, no new plan.
 * DELAYED data may produce intelligence but callers must not treat as execution-eligible.
 */
export function reassessContinuousEvent(input: {
  event: ContinuousIntelligenceEvent;
  dedupe: ContinuousEventDedupeStore;
  /** Required for PositionManagementPlan — omit for research-only events. */
  position?: {
    positionId: string;
    originalEntry: number;
    currentPrice: number;
    originalTarget?: number;
    originalStop?: number;
    thesisState?: string;
    cutoffReached?: boolean;
    planVersion?: number;
    tradeId?: string;
    decisionId?: string;
  };
}): ContinuousReassessmentResult {
  const first = input.dedupe.claim(input.event.dedupeKey, input.event.occurredAt);
  if (!first) {
    return { event: input.event, deduplicated: true };
  }

  if (!input.position) {
    return { event: input.event, deduplicated: false };
  }

  const positionPlan = buildPositionManagementPlan({
    event: input.event,
    ...input.position,
  });

  return { event: input.event, deduplicated: false, positionPlan };
}

/** DELAYED may continue intelligence; execution eligibility is Risk's concern. */
export function continuousIntelligenceAllowed(dataStatus: ContinuousDataStatus): boolean {
  return dataStatus === 'LIVE' || dataStatus === 'DELAYED' || dataStatus === 'CLOSED_MARKET';
}

export function continuousExecutionEligibleHint(dataStatus: ContinuousDataStatus): boolean {
  // Hint only — real eligibility remains with evaluateRisk / Gate.
  return dataStatus === 'LIVE';
}
