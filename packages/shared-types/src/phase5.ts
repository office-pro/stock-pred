/**
 * Phase 5 — human-validation experiment for Trade Intelligence.
 * LIVE caps, WAIT lifecycle, agent vs human decisions, display-only ranking.
 */

import type { DecisionReasonCode } from './agent';

/** Agent's immutable recommendation at decision time (never overwritten by human). */
export type AgentRecommendationAction = 'RECOMMEND_APPROVE' | 'RECOMMEND_WAIT' | 'RECOMMEND_REJECT';

/** Human action taken on the desk (preserved separately from agent recommendation). */
export type HumanDecisionAction = 'HUMAN_APPROVE' | 'HUMAN_REJECT' | 'HUMAN_WAIT';

export type HumanRejectReasonCode =
  | 'THESIS_NOT_CONVINCING'
  | 'MARKET_CONTEXT'
  | 'VALUATION_CONCERN'
  | 'EVENT_RISK'
  | 'PORTFOLIO_PREFERENCE';

export type HumanWaitReasonCode =
  | 'ENTRY_PRICE_DEGRADED'
  | 'WAIT_FOR_CONFIRMATION'
  | 'LIQUIDITY'
  | 'MARKET_VOLATILITY'
  | 'CATALYST_PENDING';

export type HumanReasonCode = HumanRejectReasonCode | HumanWaitReasonCode;

/** Hard LIVE size ceilings — enforced early on approve and finally at Gate. */
export interface LiveCapsConfig {
  maxNotionalPerTrade: number;
  maxOpenNotional: number;
  maxOpenPositions: number;
}

/** Conservative defaults for the P5 human-validation LIVE experiment. */
export const DEFAULT_LIVE_CAPS: LiveCapsConfig = {
  maxNotionalPerTrade: 50_000,
  maxOpenNotional: 150_000,
  maxOpenPositions: 3,
};

export interface LiveCapsCheckInput {
  /** Caps apply only when mode is LIVE; PAPER/RESEARCH always pass. */
  mode: 'RESEARCH' | 'PAPER' | 'LIVE';
  tradeNotional: number;
  openNotional: number;
  openPositions: number;
  caps: LiveCapsConfig;
}

export interface LiveCapsCheckResult {
  passed: boolean;
  reasonCodes: DecisionReasonCode[];
  reasons: string[];
}

/** Snapshot of Gate revalidation at submit time (ledger evidence). */
export interface GateResultSnapshot {
  passed: boolean;
  reasonCodes: DecisionReasonCode[];
  reasons: string[];
  checkedAt: number;
}

/** WAIT lifecycle fields on an opportunity (PENDING → WAITING → …). */
export interface OpportunityWaitState {
  waitExpiresAt: number;
  waitReason?: HumanWaitReasonCode | string;
  waitCount: number;
  lastEvaluatedAt: number;
}

/**
 * Display-only ranking row.
 * Must not mutate quantity, risk budget, cash, or order size.
 */
export type PortfolioFitLabel = 'EXCELLENT' | 'GOOD' | 'BLOCKED';

export interface RankedOpportunityDisplay {
  opportunityId: string;
  symbol: string;
  rank: number;
  rankScore: number;
  quality: number;
  expectedValueR: number;
  signalScore: number;
  /** Display-only share of the ranked book; not an order size. */
  referenceAllocationPct: number;
  portfolioFit: PortfolioFitLabel;
  /** Echo of input qty so callers can assert ranking did not resize. */
  quantityUnchanged: number;
}

/** Multi-signal P5 human-intelligence metrics (not LIVE P&L alone). */
export interface HumanIntelMetrics {
  reviewed: number;
  agentApproveCount: number;
  agentWaitCount: number;
  agentRejectCount: number;
  humanApproveCount: number;
  humanWaitCount: number;
  humanRejectCount: number;
  agreementCount: number;
  overrideCount: number;
  agreementPct: number;
  overridePct: number;
  waitThenLaterCount: number;
  /** Closed trades with both quality and realizedR. */
  qualityVsRealizedRSamples: number;
  avgQualityWhenPositiveR: number | null;
  avgQualityWhenNegativeR: number | null;
}
