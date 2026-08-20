/** Professional trader agent contracts (live-ready, paper-first). */

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
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED';
  expiresAt: number;
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
  /** Path to the retained implementation brief under the repo. */
  taskBriefPath?: string;
  cursorAgentId?: string;
  cursorRunId?: string;
  resultSummary?: string;
  lastError?: string;
  /** Live Cursor agent progress lines (newest last). */
  progressLog?: string[];
}

export const AGENT_DISCLAIMER =
  'Not investment advice. Research/paper first; LIVE requires explicit arming and always passes the risk engine.';
