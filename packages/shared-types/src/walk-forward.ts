/** Phase 3: costed agent walk-forward harness contracts. */

import type {
  AgentAnalysis,
  AgentDecisionMode,
  AgentMode,
  AgentScoreBreakdown,
  DecisionReasonCode,
  TradeEligibility,
} from './agent';
import type { AgentRiskBudgetConfig, PaperHolding, RiskLimits } from './trading';

export const AGENT_WALKFORWARD_SCHEMA_VERSION = 'agent-walkforward.v1' as const;

export type WalkForwardTechnicalVerdict = 'PASS' | 'FAIL';
export type WalkForwardTradingVerdict = 'STRONG' | 'ACCEPTABLE' | 'REVIEW' | 'FAIL';

export interface WalkForwardBar {
  /** Bar open time (ms). Signal uses this bar's close as decision T when it is bars[0]. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Regime labels frozen at decision time T (never from future bars). */
export interface WalkForwardRegimeSnapshot {
  marketRegime: AgentAnalysis['marketRegime'];
  /** Trend × vol combo key (e.g. BULL|LOW_VOL). */
  trendVolKey: string;
  trend?: string;
  volatility?: string;
}

export interface AgentWalkForwardConfig {
  initialCash: number;
  riskBudgets?: Partial<AgentRiskBudgetConfig>;
  riskLimits?: Partial<RiskLimits>;
  /** Decision TTL (ms). Default: 7 days for daily-bar harness. */
  decisionTtlMs?: number;
  maxQuoteAgeMs?: number;
  /** DUPLICATE_ORDER window (ms); default 60_000. */
  duplicateOrderWindowMs?: number;
  /** Slippage in basis points each side; default 5. */
  slippageBps?: number;
  minRiskReward?: number;
  defaultHorizonBars?: number;
  tradingEnabled?: boolean;
  killSwitch?: boolean;
  /** Confidence values to sweep (never raises risk ceiling). */
  confidenceSweep?: number[];
  dayStartEquity?: number;
  weekStartEquity?: number;
}

/**
 * Opportunity input.
 * Signal at bars[0].close (timestamp T) → fill at bars[1].open (never same-bar).
 */
export interface WalkForwardOpportunity {
  opportunityId: string;
  /** Decision time T (signal bar close). */
  timestamp: number;
  symbol: string;
  sector?: string | null;
  analysis: AgentAnalysis;
  quote: {
    price: number;
    timestamp: number;
  };
  /**
   * bars[0] = signal bar (close at T).
   * bars[1] = fill bar (open = next-bar fill).
   * bars[2..] = exit path (stop / target / horizon).
   */
  bars: WalkForwardBar[];
  /** Precomputed as-of-T regime (required for reproducibility). */
  regimeSnapshot: WalkForwardRegimeSnapshot;
  horizonBars?: number;
}

export interface HistoricalDecisionContext {
  timestamp: number;
  symbol: string;
  quote: { price: number; timestamp: number };
  analysis: AgentAnalysis;
  scores: AgentScoreBreakdown;
  marketRegime: AgentAnalysis['marketRegime'];
  regimeSnapshot: WalkForwardRegimeSnapshot;
  sector: string | null;
  cash: number;
  equity: number;
  dayStartEquity: number;
  weekStartEquity: number;
  positions: PaperHolding[];
}

export interface ExecutionCostBreakdown {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryFillPrice: number;
  exitFillPrice: number;
  brokerage: number;
  exchange: number;
  taxes: number;
  slippage: number;
  feesTotal: number;
  grossPnl: number;
  netPnl: number;
}

export interface FunnelMetrics {
  candidates: number;
  autonomousEligible: number;
  humanOnly: number;
  rejectedEligibility: number;
  riskPass: number;
  riskBlocked: number;
  portfolioPass: number;
  portfolioBlocked: number;
  policyPass: number;
  policyHumanRequired: number;
  policyRejected: number;
  gatePass: number;
  gateBlocked: number;
  autoAccepted: number;
  humanRequired: number;
  filled: number;
  liveAutoAccepted: number;
  liveHumanRequired: number;
}

export interface RegimeSliceMetrics {
  trendVolKey: string;
  candidates: number;
  autoAccepted: number;
  filled: number;
  grossPnl: number;
  netPnl: number;
}

export interface ConfidenceSensitivityResult {
  confidence: number;
  scale: number;
  filled: number;
  autoAccepted: number;
  netPnl: number;
  neverRaisedCeiling: boolean;
}

export interface ValidationChecks {
  noFutureData: boolean;
  noSameBarFills: boolean;
  deterministicReplay: boolean;
  riskCeilingNeverExceeded: boolean;
  positionLimitsRespected: boolean;
  sectorLimitsRespected: boolean;
  cashReserveRespected: boolean;
  ttlEnforced: boolean;
  quoteFreshnessEnforced: boolean;
  duplicateOrdersPrevented: boolean;
  confidenceNeverRaisesCeiling: boolean;
  liveNeverAutoAccepted: boolean;
  eligibilityNotAcceptance: boolean;
  costsApplied: boolean;
  regimeAsOfT: boolean;
}

export interface WalkForwardVerdict {
  technical: WalkForwardTechnicalVerdict;
  trading: WalkForwardTradingVerdict;
  notes: string[];
}

export interface WalkForwardTradeRecord {
  opportunityId: string;
  decisionId: string;
  symbol: string;
  sector: string | null;
  decisionTimestamp: number;
  fillTimestamp: number;
  exitTimestamp: number;
  quantity: number;
  entry: number;
  stopLoss: number;
  target1: number | null;
  exitReason: 'STOP_LOSS_HIT' | 'TARGET_HIT' | 'HORIZON' | 'OPEN';
  eligibility: TradeEligibility;
  regimeSnapshot: WalkForwardRegimeSnapshot;
  costs: ExecutionCostBreakdown;
  reasonCodes: DecisionReasonCode[];
}

export interface RankedReasonCode {
  code: DecisionReasonCode | string;
  count: number;
  layer: 'eligibility' | 'risk' | 'portfolio' | 'policy' | 'gate' | 'execution';
}

export interface PerformanceSummary {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  grossPnl: number;
  netPnl: number;
  feesTotal: number;
  avgGrossPnl: number;
  avgNetPnl: number;
  endingCash: number;
  endingEquity: number;
}

export interface AgentWalkForwardReport {
  schemaVersion: typeof AGENT_WALKFORWARD_SCHEMA_VERSION;
  metadata: {
    generatedAt: number;
    opportunityCount: number;
    harnessOperatingMode: Extract<AgentMode, 'PAPER'>;
    harnessDecisionMode: Extract<AgentDecisionMode, 'AUTONOMOUS'>;
  };
  configuration: AgentWalkForwardConfig & {
    riskBudgets: AgentRiskBudgetConfig;
    slippageBps: number;
    decisionTtlMs: number;
    maxQuoteAgeMs: number;
    duplicateOrderWindowMs: number;
  };
  funnel: FunnelMetrics;
  reasonCodes: {
    ranked: RankedReasonCode[];
    byLayer: Record<string, RankedReasonCode[]>;
  };
  confidenceSensitivity: ConfidenceSensitivityResult[];
  regimeSlices: RegimeSliceMetrics[];
  grossPerformance: PerformanceSummary;
  netPerformance: PerformanceSummary;
  costBreakdown: {
    brokerage: number;
    exchange: number;
    taxes: number;
    slippage: number;
    feesTotal: number;
  };
  trades: WalkForwardTradeRecord[];
  validationChecks: ValidationChecks;
  verdict: WalkForwardVerdict;
}
