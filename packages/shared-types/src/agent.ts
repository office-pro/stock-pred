/** Professional trader agent contracts (live-ready, paper-first). */

import type { DecisionBudgetSnapshot } from './trading';

export type AgentMode = 'RESEARCH' | 'PAPER' | 'LIVE';

export type AgentDecision =
  | 'STRONG_BUY'
  | 'BUY'
  | 'BUY_ON_BREAKOUT'
  | 'BUY_ON_PULLBACK'
  | 'HOLD'
  | 'WAIT'
  | 'SELL'
  | 'SELL_ON_BREAKDOWN'
  | 'STRONG_SELL'
  | 'NO_TRADE';

export type AgentCapabilityOwner =
  | 'market-data'
  | 'signal-engine'
  | 'pattern-engine'
  | 'ml-engine'
  | 'auto-trader'
  | 'frontend'
  | 'broker-sdk';

export type AgentCapabilityPriority = 'low' | 'medium' | 'high' | 'blocker';

/** Declared dependency the agent can consume from the app. */
export interface AgentCapabilityDef {
  id: string;
  title: string;
  required: boolean;
  owner: AgentCapabilityOwner;
  description: string;
}

export interface AgentCapabilityStatus extends AgentCapabilityDef {
  available: boolean;
  stale: boolean;
  detail?: string;
}

/** Ask the app to build/expose a missing input — never invent data. */
export interface AgentCapabilityRequest {
  id: string;
  title: string;
  whyNeeded: string;
  blockedDecisions: AgentDecision[];
  suggestedOwner: AgentCapabilityOwner;
  priority: AgentCapabilityPriority;
  createdAt: number;
  acknowledged?: boolean;
}

export interface AgentScoreBreakdown {
  fundamental: number | null;
  technical: number | null;
  sentiment: number | null;
  quant: number | null;
  macro: number | null;
  sector: number | null;
  risk: number | null;
  overall: number;
}

export interface AgentTradeSetup {
  instrument: string;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  entry: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  riskReward: number | null;
  positionSize: number;
  expectedHoldingPeriod: string;
  confidence: number;
  invalidation: string;
}

export interface AgentAnalysis {
  symbol: string;
  currentPrice: number | null;
  decision: AgentDecision;
  scores: AgentScoreBreakdown;
  setup: AgentTradeSetup;
  marketRegime: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'UNKNOWN';
  thesis: string;
  counterThesis: string;
  invalidation: string;
  risks: string[];
  action: string;
  usedCapabilities: string[];
  missingCapabilities: string[];
  capabilityRequests: AgentCapabilityRequest[];
  recommendationId?: string;
  generatedAt: number;
  disclaimer: string;
}

export interface AgentRecommendation {
  id: string;
  analysis: AgentAnalysis;
  status: 'PENDING' | 'WAITING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED';
  expiresAt: number;
  /** Phase 5 WAIT lifecycle (set when status is WAITING). */
  wait?: import('./phase5').OpportunityWaitState;
}

export type AgentPositionPolicy = 'HOLD' | 'TRAIL' | 'EXIT_PENDING' | 'PARTIAL_T1' | 'HARD_STOP';

export interface AgentManagedPosition {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  target: number;
  target2?: number;
  stopLoss: number;
  unrealizedPnl: number;
  policy: AgentPositionPolicy;
  policyNote: string;
  openedAt: number;
  bookKey?: string;
  userId?: string | null;
  brandId?: string | null;
  exitMode?: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
  monitored?: boolean;
}

export interface AgentLiveArming {
  armed: boolean;
  brokerConfigured: boolean;
  brokerTestOk: boolean;
  killSwitchClear: boolean;
  riskLimitsSet: boolean;
  userConfirmed: boolean;
  blockers: string[];
}

/** Persisted capability gap card on the Agent desk. */
export type AgentSuggestionStatus =
  | 'open'
  | 'brief_ready'
  | 'acknowledged'
  | 'implementing'
  | 'completed'
  | 'failed';

export interface AgentSuggestion {
  id: string;
  title: string;
  whyNeeded: string;
  suggestedOwner: AgentCapabilityOwner;
  priority: AgentCapabilityPriority;
  status: AgentSuggestionStatus;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt?: number;
  taskBriefPath?: string;
  cursorAgentId?: string;
  cursorRunId?: string;
  resultSummary?: string;
  lastError?: string;
  progressLog?: string[];
}

export const AGENT_DISCLAIMER =
  'Not investment advice. Research/paper first; LIVE requires explicit arming and always passes the risk engine.';

// ---------------------------------------------------------------------------
// Trade Decision Engine (Approval vs Autonomous)
// ---------------------------------------------------------------------------

export type AgentDecisionMode = 'APPROVAL' | 'AUTONOMOUS';

/** Score-band eligibility only — never means auto-buy. */
export type TradeEligibility = 'REJECT' | 'HUMAN_ONLY' | 'AUTONOMOUS_ELIGIBLE';

export type TradeIntent = 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | 'NO_TRADE';

export type DecisionPolicyOutcome = 'REJECT' | 'HUMAN_REQUIRED' | 'AUTO_ACCEPTED';

export type AgentDecisionState =
  | 'CANDIDATE'
  | 'EVALUATED'
  | 'REJECTED'
  | 'RISK_BLOCKED'
  | 'PORTFOLIO_BLOCKED'
  | 'HUMAN_REQUIRED'
  | 'WAITING'
  | 'AUTONOMOUS_ELIGIBLE'
  | 'AUTO_ACCEPTED'
  | 'APPROVED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'MONITORING'
  | 'EXITED'
  | 'EXPIRED';

export type AgentExecutionPermission = 'BLOCKED' | 'PAPER_ALLOWED' | 'LIVE_ALLOWED';

export type DecisionReasonCode =
  | 'SCORE_BELOW_REJECT'
  | 'SCORE_HUMAN_ONLY'
  | 'AUTONOMOUS_ELIGIBLE'
  | 'BUY_DECISION'
  | 'NON_BUY_DECISION'
  | 'MISSING_STOP'
  | 'MISSING_ENTRY'
  | 'RR_BELOW_MINIMUM'
  | 'RISK_PER_TRADE_EXCEEDED'
  | 'INSUFFICIENT_CASH'
  | 'DAILY_DRAWDOWN_LIMIT'
  | 'WEEKLY_DRAWDOWN_LIMIT'
  | 'KILL_SWITCH'
  | 'TRADING_DISABLED'
  | 'MAX_POSITIONS'
  | 'MAX_NAME_EXPOSURE'
  | 'SECTOR_EXPOSURE_LIMIT'
  | 'SECTOR_UNKNOWN_SKIPPED'
  | 'DUPLICATE_POSITION'
  | 'CASH_RESERVE_FLOOR'
  | 'DATA_STALE'
  | 'DECISION_EXPIRED'
  | 'PRICE_DEVIATION'
  | 'DUPLICATE_ORDER'
  | 'CONFIDENCE_SCALED_DOWN'
  | 'EXECUTION_FAILURE_CIRCUIT_BREAKER'
  /** Phase 7 stop-only breakers (never authorize). */
  | 'BREAKER_DAILY_AUTO_COUNT'
  | 'BREAKER_AUTO_PNL_DRAWDOWN'
  | 'BREAKER_VETO_STREAK'
  | 'BREAKER_QUOTE_STALE'
  | 'BREAKER_BROKER_DISCONNECT'
  | 'BREAKER_SCORE_ANOMALY'
  | 'BREAKER_SLIPPAGE_ANOMALY'
  | 'BREAKER_QUALITY_DRIFT'
  | 'BREAKER_EV_DRIFT'
  | 'BREAKER_CALIBRATION_DRIFT'
  | 'BREAKER_REGIME_DRIFT'
  | 'BREAKER_EXECUTION_DRIFT'
  | 'LIVE_AUTONOMOUS_NOT_ARMED'
  | 'LIVE_AUTONOMOUS_ARMED'
  | 'P5_EVIDENCE_GATE_NOT_PASSED'
  | 'LIVE_MAX_NOTIONAL_PER_TRADE'
  | 'LIVE_MAX_OPEN_NOTIONAL'
  | 'LIVE_MAX_OPEN_POSITIONS'
  | 'WAIT_TTL_EXPIRED'
  | 'RESEARCH_NO_EXECUTE'
  | 'POLICY_APPROVAL_MODE'
  | 'POLICY_AUTO_ACCEPTED'
  | 'TECHNICAL_EDGE'
  | 'FUNDAMENTAL_EDGE'
  | 'SENTIMENT_EDGE'
  | 'REGIME_SUPPORTIVE'
  | 'REGIME_HOSTILE'
  | 'THESIS_INVALIDATED'
  | 'REVALIDATION_FAILED';

export interface TradeDecision {
  decisionId: string;
  opportunityId?: string;
  symbol: string;
  intent: TradeIntent;
  eligibility: TradeEligibility;
  signalScore: number;
  confidence: number;
  scores: AgentScoreBreakdown;
  strategy: string;
  marketRegime: AgentAnalysis['marketRegime'];
  thesis: string;
  counterThesis: string;
  invalidation: string;
  reasons: string[];
  reasonCodes: DecisionReasonCode[];
  setup: {
    entry: number | null;
    stopLoss: number | null;
    target1: number | null;
    target2: number | null;
    target3: number | null;
    riskReward: number | null;
    recommendedQty: number;
  };
  quoteTimestamp?: number;
  createdAt: number;
  ttlMs: number;
}

export type RiskVerdict =
  | {
      allowed: true;
      riskScore: number;
      quantity: number;
      /** Ceiling qty before confidence scale-down (Phase 2). */
      quantityBeforeConfidence?: number;
      /** 0–1 multiplier; never > 1. */
      confidenceScale?: number;
      riskAmount: number;
      stopLoss: number;
      maxLoss: number;
      riskReward: number;
      reasonCodes: DecisionReasonCode[];
      reasons: string[];
    }
  | {
      allowed: false;
      reasonCodes: DecisionReasonCode[];
      reasons: string[];
      blockedBy: DecisionReasonCode[];
    };

export type PortfolioVerdict =
  | {
      allowed: true;
      openPositions: number;
      cash: number;
      requiredCapital: number;
      nameExposurePct: number;
      sectorExposurePct: number | null;
      reasonCodes: DecisionReasonCode[];
      reasons: string[];
    }
  | {
      allowed: false;
      openPositions: number;
      cash: number;
      requiredCapital: number;
      nameExposurePct: number;
      sectorExposurePct: number | null;
      reasonCodes: DecisionReasonCode[];
      reasons: string[];
      blockedBy: DecisionReasonCode[];
    };

export interface DecisionPolicyResult {
  outcome: DecisionPolicyOutcome;
  reasonCodes: DecisionReasonCode[];
  reasons: string[];
}

/** Immutable ledger row — saw / thought / allowed / happened. */
export interface DecisionLedgerEntry {
  decisionId: string;
  opportunityId?: string;
  orderId?: string;
  positionId?: string;
  tradeId?: string;
  timestamp: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  operatingMode: AgentMode;
  decisionMode: AgentDecisionMode;
  state: AgentDecisionState;
  analysisSnapshot: {
    score: number;
    confidence: number;
    scores: AgentScoreBreakdown;
    regime: AgentAnalysis['marketRegime'];
    thesis: string;
    strategy: string;
    eligibility: TradeEligibility;
    quoteTimestamp?: number;
  };
  riskVerdict: RiskVerdict;
  portfolioVerdict: PortfolioVerdict;
  policy?: DecisionPolicyResult;
  /** Phase 2: equity anchors + sized budget at decision time. */
  budgetSnapshot?: DecisionBudgetSnapshot;
  decision:
    | 'REJECT'
    | 'HUMAN_REQUIRED'
    | 'AUTO_ACCEPT'
    | 'APPROVED'
    | 'BLOCKED'
    | 'EXPIRED'
    | 'EXECUTED'
    | 'WAIT';
  reasonCodes: DecisionReasonCode[];
  decisionReasons: string[];
  execution?: {
    quantity: number;
    entryPrice?: number;
    orderId?: string;
    status?: string;
    /** ₹ risk at entry: |entry − stop| × qty — denominator for realizedR. */
    plannedRiskAmount?: number;
  };
  /**
   * Materialized convenience only (read path). Source of truth for closes is
   * append-only {@link DecisionOutcomeRecord} rows — never rewrite this in place
   * as the sole history.
   */
  outcome?: DecisionTradeOutcome;
  /** Set while a PAPER soak run is active when the decision is recorded. */
  soakRunId?: string;
  /**
   * Trade Intelligence at decision time (P4 observe / P5 human-validate).
   * Must never be passed into Risk / Portfolio / Policy / Gate.
   */
  intelligenceSnapshot?: import('./trade-intelligence').IntelligenceSnapshot;
  /**
   * Immutable agent recommendation at decision time (Phase 5).
   * Never overwritten when the human chooses a different action.
   */
  agentRecommendation?: import('./phase5').AgentRecommendationAction;
  /** Human desk action (Phase 5) — preserved separately from agentRecommendation. */
  humanDecision?: import('./phase5').HumanDecisionAction;
  /** Optional human reason code (reject / wait). */
  humanReasonCode?: import('./phase5').HumanReasonCode | string;
  /** Final Gate revalidation snapshot (Phase 5 evidence). */
  gateResult?: import('./phase5').GateResultSnapshot;
  /**
   * T1.8 ranking cohort frozen at human decision time (P5 measurement).
   * Never reconstruct by re-running today's ranking engine.
   */
  rankingContext?: import('./p5-measurement').P5DecisionRankingContext;
  /** T2.1 WAIT intelligence at decision time — display only. */
  waitIntelligence?: import('./wait-intelligence').WaitRecommendation;
  /** T2.2 frozen thesis at decision time — never rewritten. */
  thesisSnapshot?: import('./thesis-intelligence').ThesisSnapshot;
  /** T2.2 materialized current thesis view (from latest append-only event). */
  thesisReassessment?: import('./thesis-intelligence').StructuredThesis;
}

/** Closed-trade economics for calibration / soak (append-only via outcome records). */
export interface DecisionTradeOutcome {
  outcomeId: string;
  decisionId: string;
  soakRunId?: string;
  positionId?: string;
  orderId?: string;
  tradeId?: string;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  holdingPeriodMs: number;
  exitReason: string;
  closedAt: number;
  /** pnl / plannedRiskAmount at entry; 0 if planned risk unknown. */
  realizedR: number;
  plannedRiskAmount?: number;
  /** P5 measurement — ACTUAL vs COUNTERFACTUAL vs WAIT_MARK (never mix in metrics). */
  outcomeKind?: import('./p5-measurement').P5OutcomeKind;
  rankingContextId?: string;
  /** Gross R before fees/slippage; defaults to realizedR when omitted. */
  grossR?: number;
  fees?: number;
  slippage?: number;
  grossPnl?: number;
  netPnl?: number;
  /** Net R after costs; prefer over realizedR for cost-adjusted reports. */
  netR?: number;
  maeR?: number | null;
  mfeR?: number | null;
  pathMetricsStatus?: import('./p5-measurement').P5PathMetricsStatus;
  counterfactualProvenance?: import('./p5-measurement').P5CounterfactualProvenance;
  waitMarkEndReason?: import('./p5-measurement').P5WaitMarkEndReason;
}

/**
 * Append-only ledger event for a closed trade. Do not mutate the original
 * {@link DecisionLedgerEntry}; merge at read time for desk convenience.
 */
export interface DecisionOutcomeRecord {
  kind: 'OUTCOME_RECORDED';
  outcomeId: string;
  decisionId: string;
  timestamp: number;
  soakRunId?: string;
  positionId?: string;
  orderId?: string;
  tradeId?: string;
  symbol?: string;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  holdingPeriodMs: number;
  exitReason: string;
  closedAt: number;
  realizedR: number;
  plannedRiskAmount?: number;
  /** P5 measurement fields (additive; older rows remain valid). */
  outcomeKind?: import('./p5-measurement').P5OutcomeKind;
  rankingContextId?: string;
  grossR?: number;
  fees?: number;
  slippage?: number;
  grossPnl?: number;
  netPnl?: number;
  netR?: number;
  maeR?: number | null;
  mfeR?: number | null;
  pathMetricsStatus?: import('./p5-measurement').P5PathMetricsStatus;
  counterfactualProvenance?: import('./p5-measurement').P5CounterfactualProvenance;
  waitMarkEndReason?: import('./p5-measurement').P5WaitMarkEndReason;
}

/**
 * Append-only thesis history event. Do not mutate the original
 * {@link DecisionLedgerEntry} or {@link ThesisSnapshot}.
 */
export interface ThesisHistoryLedgerRecord {
  kind: 'THESIS_EVENT';
  decisionId: string;
  timestamp: number;
  event: import('./thesis-intelligence').ThesisHistoryEvent;
  /** Materialized thesis view at this event (display only). */
  reassessment?: import('./thesis-intelligence').StructuredThesis;
}

export type DecisionLedgerRecord =
  | DecisionLedgerEntry
  | DecisionOutcomeRecord
  | ThesisHistoryLedgerRecord;

export function isDecisionOutcomeRecord(row: DecisionLedgerRecord): row is DecisionOutcomeRecord {
  return (row as DecisionOutcomeRecord).kind === 'OUTCOME_RECORDED';
}

export function isThesisHistoryLedgerRecord(
  row: DecisionLedgerRecord,
): row is ThesisHistoryLedgerRecord {
  return (row as ThesisHistoryLedgerRecord).kind === 'THESIS_EVENT';
}

export function isDecisionLedgerEntry(row: DecisionLedgerRecord): row is DecisionLedgerEntry {
  return !isDecisionOutcomeRecord(row) && !isThesisHistoryLedgerRecord(row);
}
