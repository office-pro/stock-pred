/**
 * B7 — Continuous intelligence events + PositionManagementPlan.
 * Reassessment only — never amends orders or bypasses evaluateTrade().
 */

export type ContinuousPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type ContinuousTrigger =
  | 'PRICE'
  | 'NEWS'
  | 'REGIME'
  | 'THESIS'
  | 'ML'
  | 'CATALYST'
  | 'CUTOFF'
  | 'OTHER';

export type ContinuousDataStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNKNOWN' | 'CLOSED_MARKET';

export type PositionManagementAction = 'HOLD' | 'TRIM' | 'EXIT' | 'EXTEND';

export interface ContinuousIntelligenceEvent {
  schemaVersion: 'continuous-intelligence-event.v1';
  eventId: string;
  symbol: string;
  priority: ContinuousPriority;
  trigger: ContinuousTrigger;
  dataStatus: ContinuousDataStatus;
  message: string;
  /** Idempotency key — duplicate delivery must not create duplicate reassessments. */
  dedupeKey: string;
  occurredAt: number;
  positionId?: string;
  decisionId?: string;
  tradeId?: string;
}

export interface PositionManagementPlan {
  schemaVersion: 'position-management-plan.v1';
  planVersion: number;
  positionId: string;
  tradeId?: string;
  decisionId?: string;
  symbol: string;
  generatedAt: number;
  originalEntry: number;
  originalTarget?: number;
  originalStop?: number;
  currentPrice: number;
  remainingUpsidePct?: number;
  thesisState?: string;
  momentumState?: string;
  recommendedAction: PositionManagementAction;
  exitRange?: { low: number; high: number };
  protectionPrice?: number;
  newTargetRange?: { low: number; high: number };
  cutoffStatus?: 'OPEN' | 'REACHED' | 'EXTENDED';
  reassessmentReason: string;
  /** Advisory recommendation only — still requires evaluateTrade() chain. */
  recommendation: 'APPROVE' | 'WAIT' | 'REJECT';
  provenance: {
    eventId: string;
    dataAsOf?: number;
    intelligenceVersion?: string;
  };
}

export interface ContinuousReassessmentResult {
  event: ContinuousIntelligenceEvent;
  /** True when this event was a duplicate and no new plan was created. */
  deduplicated: boolean;
  positionPlan?: PositionManagementPlan;
}
