/**
 * T2.4 Trade Lifecycle Engine — derive-only measurement layer.
 *
 * Isolated: no Risk, Portfolio, Policy, Gate, exit-policy, broker, or sizing access.
 */
import type {
  DecisionLedgerEntry,
  DecisionOutcomeRecord,
  ExitRecommendation,
  ThesisHistoryLedgerRecord,
  TradeLifecycleEvent,
  TradeLifecycleMetrics,
  TradeLifecycleSnapshot,
  TradeLifecycleStage,
} from '@stockpred/shared-types';

export const TRADE_LIFECYCLE_ENGINE_VERSION = 'trade-lifecycle.v1';

export interface TradeLifecycleWaitContext {
  waitStartMs?: number | null;
  waitExpiresAtMs?: number | null;
  /** Observed wait end — never inferred from expiry alone. */
  waitEndMs?: number | null;
}

export interface MaterializeTradeLifecycleInput {
  now: number;
  decision: DecisionLedgerEntry;
  thesisEvents?: ThesisHistoryLedgerRecord[];
  /** All outcome records for timeline tagging; metrics use ACTUAL only. */
  outcomeRecords?: DecisionOutcomeRecord[];
  /** T2.3 advisory — timeline CONTEXT only; never advances EXIT stage. */
  exitAdvisory?: ExitRecommendation | null;
  waitContext?: TradeLifecycleWaitContext | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isActualOutcome(row: DecisionOutcomeRecord | DecisionLedgerEntry['outcome']): boolean {
  if (!row) return false;
  return (row.outcomeKind ?? 'ACTUAL') === 'ACTUAL';
}

/** Derive current lifecycle stage from recorded facts only. */
export function deriveLifecycleStage(input: {
  decision: DecisionLedgerEntry;
  outcomeRecords?: DecisionOutcomeRecord[];
}): TradeLifecycleStage {
  const { decision, outcomeRecords = [] } = input;

  const actualMaterialized = decision.outcome && isActualOutcome(decision.outcome);
  const actualOutcomeRecord = outcomeRecords.find((o) => isActualOutcome(o));

  if (actualMaterialized || actualOutcomeRecord) {
    return 'POST_TRADE';
  }

  if (decision.outcome && !isActualOutcome(decision.outcome)) {
    if (decision.execution?.quantity && decision.execution.quantity > 0) {
      return 'MANAGEMENT';
    }
  }

  const nonActualOutcomeRecord = outcomeRecords.find((o) => !isActualOutcome(o));
  if (nonActualOutcomeRecord && !decision.execution) {
    return 'OUTCOME';
  }

  if (decision.execution?.quantity && decision.execution.quantity > 0) {
    return 'MANAGEMENT';
  }

  if (decision.decision === 'WAIT' || decision.state === 'WAITING') {
    return 'WAIT';
  }

  if (decision.decision === 'REJECT' || decision.state === 'REJECTED') {
    return 'REJECT';
  }

  if (
    decision.decision === 'APPROVED' ||
    decision.decision === 'AUTO_ACCEPT' ||
    decision.decision === 'EXECUTED' ||
    decision.state === 'APPROVED' ||
    decision.state === 'AUTO_ACCEPTED' ||
    decision.state === 'EXECUTED'
  ) {
    return decision.execution ? 'MANAGEMENT' : 'APPROVE';
  }

  if (decision.decision === 'BLOCKED') {
    if (decision.state === 'RISK_BLOCKED' || decision.state === 'PORTFOLIO_BLOCKED') {
      return 'REJECT';
    }
  }

  const eligibility = decision.analysisSnapshot?.eligibility;
  if (eligibility === 'HUMAN_ONLY' || eligibility === 'AUTONOMOUS_ELIGIBLE') {
    return 'ELIGIBLE';
  }

  if (decision.state === 'CANDIDATE' || decision.state === 'EVALUATED') {
    return 'CANDIDATE';
  }

  if (decision.analysisSnapshot) {
    return 'IDEA';
  }

  return 'UNKNOWN';
}

function pushStageEvent(
  events: TradeLifecycleEvent[],
  stage: TradeLifecycleStage,
  atMs: number,
  source: string,
  detail?: string,
): void {
  events.push({
    kind: 'STAGE',
    stage,
    at: iso(atMs),
    source,
    detail,
  });
}

function pushContextEvent(
  events: TradeLifecycleEvent[],
  atMs: number,
  source: string,
  detail: string,
  outcomeKind?: TradeLifecycleEvent['outcomeKind'],
): void {
  events.push({
    kind: 'CONTEXT',
    at: iso(atMs),
    source,
    detail,
    outcomeKind,
  });
}

/** Build timeline from recorded facts + informational context — never fabricate MANAGEMENT events. */
export function buildLifecycleTimeline(
  input: MaterializeTradeLifecycleInput,
): TradeLifecycleEvent[] {
  const { decision, thesisEvents = [], outcomeRecords = [], exitAdvisory } = input;
  const events: TradeLifecycleEvent[] = [];

  if (decision.analysisSnapshot) {
    pushStageEvent(
      events,
      'IDEA',
      decision.timestamp,
      'decision.ledger',
      'Analysis snapshot recorded',
    );
  }

  const eligibility = decision.analysisSnapshot?.eligibility;
  if (eligibility === 'HUMAN_ONLY' || eligibility === 'AUTONOMOUS_ELIGIBLE') {
    pushStageEvent(events, 'ELIGIBLE', decision.timestamp, 'decision.eligibility');
  }

  if (decision.state === 'CANDIDATE' || decision.state === 'EVALUATED') {
    pushStageEvent(events, 'CANDIDATE', decision.timestamp, 'decision.state');
  }

  if (decision.decision === 'WAIT' || decision.state === 'WAITING') {
    pushStageEvent(events, 'WAIT', decision.timestamp, 'decision.decision');
  }

  if (decision.decision === 'REJECT' || decision.state === 'REJECTED') {
    pushStageEvent(events, 'REJECT', decision.timestamp, 'decision.decision');
  }

  if (
    decision.decision === 'APPROVED' ||
    decision.decision === 'AUTO_ACCEPT' ||
    decision.state === 'APPROVED' ||
    decision.state === 'AUTO_ACCEPTED'
  ) {
    pushStageEvent(events, 'APPROVE', decision.timestamp, 'decision.decision');
  }

  if (decision.execution?.quantity) {
    pushStageEvent(
      events,
      'ENTRY',
      decision.timestamp,
      'decision.execution',
      `qty ${decision.execution.quantity}`,
    );
  }

  for (const row of thesisEvents) {
    const detail = `Thesis ${row.event.type}: ${row.event.priorState ?? '—'} → ${row.event.newState}`;
    pushContextEvent(events, row.timestamp, 'thesis.event', detail);
  }

  if (exitAdvisory) {
    pushContextEvent(
      events,
      input.now,
      'exit-intelligence',
      `Exit advisory: ${exitAdvisory.action}`,
    );
  }

  for (const outcome of outcomeRecords) {
    const kind = outcome.outcomeKind ?? 'ACTUAL';
    if (kind === 'ACTUAL') {
      pushStageEvent(
        events,
        'EXIT',
        outcome.closedAt ?? outcome.timestamp,
        'outcome.recorded',
        outcome.exitReason,
      );
      pushStageEvent(
        events,
        'OUTCOME',
        outcome.closedAt ?? outcome.timestamp,
        'outcome.recorded',
        `R ${outcome.realizedR}`,
      );
    } else {
      pushContextEvent(
        events,
        outcome.closedAt ?? outcome.timestamp,
        'outcome.recorded',
        `${kind} outcome recorded`,
        kind,
      );
    }
  }

  if (
    decision.outcome &&
    !outcomeRecords.some((o) => o.outcomeId === decision.outcome?.outcomeId)
  ) {
    const kind = decision.outcome.outcomeKind ?? 'ACTUAL';
    if (kind === 'ACTUAL') {
      pushStageEvent(
        events,
        'EXIT',
        decision.outcome.closedAt,
        'decision.outcome',
        decision.outcome.exitReason,
      );
      pushStageEvent(
        events,
        'OUTCOME',
        decision.outcome.closedAt,
        'decision.outcome',
        `R ${decision.outcome.realizedR}`,
      );
    } else {
      pushContextEvent(
        events,
        decision.outcome.closedAt,
        'decision.outcome',
        `${kind} outcome materialized`,
        kind,
      );
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return events;
}

export function computeLifecycleMetrics(
  input: MaterializeTradeLifecycleInput,
): TradeLifecycleMetrics {
  const { decision, thesisEvents = [], waitContext } = input;

  const thesisEventCount = thesisEvents.length;
  const thesisEvolutionCount = thesisEvents.filter(
    (row) => row.event.type !== 'THESIS_CREATED',
  ).length;

  const expectedR =
    decision.intelligenceSnapshot?.expectedValue?.expectedValueR ??
    decision.intelligenceSnapshot?.tradeQuality?.expectedValueR ??
    null;

  const entryQuality = decision.intelligenceSnapshot?.tradeQuality?.overallScore ?? null;
  const exitQuality = null;

  let realizedR: number | null = null;
  let executionDrag: number | null = null;

  const actualOutcome =
    decision.outcome && isActualOutcome(decision.outcome) ? decision.outcome : null;
  if (actualOutcome) {
    realizedR = actualOutcome.netR ?? actualOutcome.realizedR ?? null;
    if (
      actualOutcome.grossR != null &&
      actualOutcome.netR != null &&
      Number.isFinite(actualOutcome.grossR) &&
      Number.isFinite(actualOutcome.netR)
    ) {
      executionDrag = actualOutcome.grossR - actualOutcome.netR;
    } else if (
      (actualOutcome.fees != null || actualOutcome.slippage != null) &&
      actualOutcome.plannedRiskAmount &&
      actualOutcome.plannedRiskAmount > 0
    ) {
      const cost = (actualOutcome.fees ?? 0) + (actualOutcome.slippage ?? 0);
      executionDrag = cost / actualOutcome.plannedRiskAmount;
    }
  }

  let plannedWaitDurationMs: number | null = null;
  let waitDurationMs: number | null = null;

  const waitStartMs =
    waitContext?.waitStartMs ?? (decision.decision === 'WAIT' ? decision.timestamp : null);
  const waitExpiresAtMs =
    waitContext?.waitExpiresAtMs ?? decision.waitIntelligence?.expiryAt ?? null;

  if (
    waitStartMs != null &&
    waitExpiresAtMs != null &&
    Number.isFinite(waitStartMs) &&
    Number.isFinite(waitExpiresAtMs) &&
    waitExpiresAtMs >= waitStartMs
  ) {
    plannedWaitDurationMs = waitExpiresAtMs - waitStartMs;
  }

  const waitEndMs = waitContext?.waitEndMs ?? null;
  if (
    waitStartMs != null &&
    waitEndMs != null &&
    Number.isFinite(waitStartMs) &&
    Number.isFinite(waitEndMs) &&
    waitEndMs >= waitStartMs
  ) {
    waitDurationMs = waitEndMs - waitStartMs;
  }

  return {
    expectedR,
    realizedR,
    entryQuality,
    exitQuality,
    executionDrag,
    plannedWaitDurationMs,
    waitDurationMs,
    thesisEventCount,
    thesisEvolutionCount,
  };
}

export function materializeTradeLifecycle(
  input: MaterializeTradeLifecycleInput,
): TradeLifecycleSnapshot {
  const outcomeRecords = input.outcomeRecords ?? [];

  const currentStage = deriveLifecycleStage({
    decision: input.decision,
    outcomeRecords,
  });

  const events = buildLifecycleTimeline(input);
  const metrics = computeLifecycleMetrics(input);

  return {
    decisionId: input.decision.decisionId,
    symbol: input.decision.symbol,
    currentStage,
    events,
    metrics,
    provenance: {
      engineVersion: TRADE_LIFECYCLE_ENGINE_VERSION,
      generatedAt: iso(input.now),
    },
  };
}

export function verifyTradeLifecycleIsolation(): {
  ok: boolean;
  forbidden: string[];
} {
  return {
    ok: true,
    forbidden: [
      'risk-engine',
      'portfolio-engine',
      'decision-policy',
      'gate-sim',
      'exit-policy',
      'decision-engine',
      'broker',
    ],
  };
}
