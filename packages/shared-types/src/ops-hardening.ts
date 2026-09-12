/**
 * P5 Operational Hardening types (OH-1 / OH-3).
 * Observe / reconcile / report only — never authorize or modify trade decisions.
 */

export type OhPipelineStage =
  | 'evaluateTrade'
  | 'tiFetch'
  | 'intelligenceSnapshot'
  | 'evaluateRisk'
  | 'evaluatePortfolio'
  | 'applyDecisionPolicy'
  | 'pipelineTotal'
  | 'earlyLiveCaps'
  | 'priceDeviation'
  | 'duplicateCheck'
  | 'gateRevalidate'
  | 'brokerExecute'
  | 'approveTotal';

export interface OhStageTimingMs {
  stage: OhPipelineStage;
  ms: number;
}

export interface OhPipelineSample {
  sampleId: string;
  recordedAt: number;
  kind: 'PIPELINE' | 'APPROVE';
  symbol?: string;
  decisionId?: string;
  opportunityId?: string;
  stages: OhStageTimingMs[];
  totalMs: number;
  quoteAgeMs?: number | null;
  ok: boolean;
  errorCode?: string;
}

export interface OhStageStats {
  stage: OhPipelineStage;
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  meanMs: number | null;
}

export interface OhPipelineMetricsSnapshot {
  schemaVersion: 'oh-pipeline-metrics.v1';
  generatedAt: number;
  sampleCount: number;
  capacity: number;
  stages: OhStageStats[];
  recent: OhPipelineSample[];
  lastQuoteAgeMs: number | null;
}

export type OhReconcileSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export type OhReconcileIssueCode =
  | 'LEDGER_EXECUTED_NO_HOLDING'
  | 'HOLDING_NO_LEDGER'
  | 'POSITION_NO_LEDGER'
  | 'QTY_MISMATCH'
  | 'DUPLICATE_DECISION_ID'
  | 'EXECUTED_MISSING_ORDER_ID'
  | 'OUTCOME_WITHOUT_DECISION';

export interface OhReconcileIssue {
  code: OhReconcileIssueCode;
  severity: OhReconcileSeverity;
  symbol?: string;
  decisionId?: string;
  orderId?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OhReconcileHoldingInput {
  symbol: string;
  quantity: number;
  entryPrice?: number;
  orderId?: string;
  decisionId?: string;
}

export interface OhReconcilePositionInput {
  symbol: string;
  quantity: number;
  entryPrice?: number;
  decisionId?: string;
  orderId?: string;
}

export interface OhReconcileLedgerInput {
  decisionId: string;
  symbol: string;
  decision: string;
  timestamp: number;
  orderId?: string;
  executionOrderId?: string;
  executionQty?: number;
  executionStatus?: string;
  hasOutcome?: boolean;
}

export interface OhReconciliationReport {
  schemaVersion: 'oh-reconciliation.v1';
  generatedAt: number;
  observeOnly: true;
  summary: {
    ledgerExecutedOpen: number;
    holdings: number;
    positions: number;
    issueCount: number;
    criticalCount: number;
    warnCount: number;
  };
  issues: OhReconcileIssue[];
}

// ─── OH-2 Execution Health (observe → classify → report → alert) ─────────────

export type OhExecutionHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type OhExecutionDiagnosticCode =
  | 'BROKER_DISCONNECTED'
  | 'BROKER_TIMEOUT'
  | 'ORDER_STUCK'
  | 'FILL_DELAYED'
  | 'PRICE_DEVIATION'
  | 'DUPLICATE_ATTEMPT'
  | 'EXECUTION_FAILURE'
  | 'QTY_MISMATCH'
  | 'STATUS_POLL_FAILURE'
  | 'REJECTED_ORDER'
  | 'CANCELLED_ORDER';

export type OhExecutionLifecyclePhase =
  | 'GATE_PASSED'
  | 'SUBMIT'
  | 'BROKER_ACK'
  | 'FILL'
  | 'REJECT'
  | 'CANCEL'
  | 'ERROR';

export interface OhExecutionLifecycleSample {
  sampleId: string;
  recordedAt: number;
  phase: OhExecutionLifecyclePhase;
  decisionId?: string;
  orderId?: string;
  positionId?: string;
  symbol?: string;
  /** Submit → broker ACK latency (ms). */
  submitAckMs?: number | null;
  /** ACK → fill latency (ms), when fill is observed separately. */
  fillMs?: number | null;
  /** End-to-end submit → fill/ack latency (ms). */
  e2eMs?: number | null;
  expectedQty?: number | null;
  actualQty?: number | null;
  expectedPrice?: number | null;
  fillPrice?: number | null;
  priceDeviationPct?: number | null;
  ok: boolean;
  diagnostic?: OhExecutionDiagnosticCode;
  message?: string;
}

export interface OhExecutionHealthSnapshot {
  schemaVersion: 'oh-execution-health.v1';
  generatedAt: number;
  observeOnly: true;
  status: OhExecutionHealthStatus;
  diagnostics: OhExecutionDiagnosticCode[];
  brokerConnected: boolean | null;
  failureStreak: number;
  openPendingOrders: number;
  sampleCount: number;
  recent: OhExecutionLifecycleSample[];
  latency: {
    submitAckP50Ms: number | null;
    submitAckP95Ms: number | null;
    fillP50Ms: number | null;
    fillP95Ms: number | null;
    e2eP50Ms: number | null;
    e2eP95Ms: number | null;
  };
  counts: {
    submits: number;
    acks: number;
    fills: number;
    rejects: number;
    cancels: number;
    errors: number;
    duplicates: number;
    stuck: number;
  };
}

// ─── OH-4 Kill / Disarm Verification (audit only — never authorizes) ─────────

export type OhSafetyEventCode =
  | 'DISARM_REQUESTED'
  | 'DISARM_CONFIRMED'
  | 'KILL_SWITCH_TRIGGERED'
  | 'TRADING_DISABLED'
  | 'AUTONOMOUS_AUTHORIZATION_BLOCKED'
  | 'PENDING_ORDER_BLOCKED';

export interface OhSafetyEvent {
  eventId: string;
  recordedAt: number;
  code: OhSafetyEventCode;
  /** Optional correlation to a decision/opportunity. */
  decisionId?: string;
  symbol?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface OhSafetyEventsSnapshot {
  schemaVersion: 'oh-safety-events.v1';
  generatedAt: number;
  observeOnly: true;
  eventCount: number;
  recent: OhSafetyEvent[];
  counts: Record<OhSafetyEventCode, number>;
}

// ─── OH-5 Data Quality (observe → classify → report — never authorizes) ──────

export type OhDataQualityStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type OhDataQualityDiagnosticCode =
  | 'DATA_STALE'
  | 'MISSING_CANDLE'
  | 'TIMESTAMP_ANOMALY'
  | 'DUPLICATE_DATA'
  | 'OHLC_INVALID'
  | 'PRICE_ANOMALY'
  | 'FUNDAMENTAL_DATA_STALE'
  | 'CONTEXT_MISSING'
  | 'SOURCE_UNAVAILABLE'
  | 'SYMBOL_MAPPING_FAILED'
  | 'CONFLICTING_FEEDS'
  | 'INSUFFICIENT_VALIDATION_CONTEXT';

export type OhDataQualitySampleKind =
  | 'QUOTE'
  | 'CANDLE'
  | 'FUNDAMENTAL'
  | 'ALT'
  | 'CONTEXT'
  | 'SOURCE';

export interface OhDataQualitySample {
  sampleId: string;
  recordedAt: number;
  kind: OhDataQualitySampleKind;
  symbol?: string;
  timeframe?: string;
  decisionId?: string;
  ok: boolean;
  diagnostic?: OhDataQualityDiagnosticCode;
  message?: string;
  details?: Record<string, unknown>;
}

export interface OhDataQualitySnapshot {
  schemaVersion: 'oh-data-quality.v1';
  generatedAt: number;
  observeOnly: true;
  status: OhDataQualityStatus;
  diagnostics: OhDataQualityDiagnosticCode[];
  /** Collector-owned age only — never writes agent.lastQuoteAgeMs / breakers. */
  lastQuoteAgeMs: number | null;
  sourceReachable: boolean | null;
  sampleCount: number;
  recent: OhDataQualitySample[];
  counts: Record<OhDataQualityDiagnosticCode, number> & {
    ok: number;
    error: number;
  };
}

// ─── OH-6 Unified Operations Report (observe only — never authorizes) ─────────

export type OhOpsReportStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type OhOpsSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export type OhOpsComponentId =
  | 'OH1_PIPELINE'
  | 'OH2_EXECUTION'
  | 'OH3_RECONCILIATION'
  | 'OH4_SAFETY'
  | 'OH5_DATA_QUALITY';

export interface OhOpsComponentStatus {
  id: OhOpsComponentId;
  status: OhOpsReportStatus;
  severity: OhOpsSeverity;
  summary: string;
  diagnostics: string[];
}

export interface OhOpsRecommendedAction {
  /** Human-readable operational guidance only — never an automated trading action. */
  action: string;
  componentId?: OhOpsComponentId;
  severity: OhOpsSeverity;
}

export interface OhOpsReportSnapshot {
  schemaVersion: 'oh-ops-report.v1';
  generatedAt: number;
  observeOnly: true;
  overallStatus: OhOpsReportStatus;
  severity: OhOpsSeverity;
  componentStatuses: OhOpsComponentStatus[];
  recommendedActions: OhOpsRecommendedAction[];
  diagnostics: string[];
}
