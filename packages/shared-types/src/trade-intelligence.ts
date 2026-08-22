/**
 * Professional Trade Intelligence — observe-only in Phase 4.
 * Captured before evaluateTrade for the ledger; never consumed by
 * Risk / Portfolio / Policy / Gate in P4.
 */

export type StrategyTag =
  | 'BREAKOUT'
  | 'TREND_FOLLOWING'
  | 'MEAN_REVERSION'
  | 'MOMENTUM'
  | 'VALUE'
  | 'EVENT_DRIVEN'
  | 'COMPOSITE'
  | 'UNKNOWN';

export interface MarketContextSnapshot {
  regime?: string;
  volatilityRegime?: string;
  breadth?: number | null;
  indexTrend?: string;
  sectorTrend?: string;
  liquidity?: string;
}

export interface TradeThesisSnapshot {
  direction: 'LONG' | 'SHORT';
  setup: string;
  rationale: string[];
  catalyst?: string;
  entryReason?: string;
  invalidation?: {
    price?: number;
    conditions: string[];
  };
  target?: {
    price?: number;
    expectedR?: number;
  };
  expectedHoldingPeriodSessions?: number;
  thesisConfidence?: number;
}

export interface ExpectedValueSnapshot {
  probabilityTarget?: number;
  probabilityStop?: number;
  rewardR?: number;
  riskR?: number;
  expectedValueR?: number;
}

export interface TradeQualitySnapshot {
  technical?: number;
  fundamental?: number;
  momentum?: number;
  relativeStrength?: number;
  sentiment?: number;
  catalyst?: number;
  regimeCompatibility?: number;
  liquidity?: number;
  executionQuality?: number;
  expectedValueR?: number;
  overallScore?: number;
}

export interface DecisionConflict {
  code: string;
  severity: 'INFO' | 'WARN' | 'BLOCK';
  message: string;
  factors?: string[];
}

export const INTELLIGENCE_SCHEMA_VERSION = 'intelligence.v1';
export const INTELLIGENCE_ENGINE_VERSION = 'trade-intelligence-0.1.0';

/**
 * Versioned, immutable decision-time evidence.
 * P4: store only. Do not feed into authorization engines.
 */
export interface IntelligenceSnapshot {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION | string;
  engineVersion: string;
  generatedAt: string;
  /** As-of timestamp of market/analysis inputs used to build this snapshot. */
  sourceDataTimestamp: string;
  strategyTag?: StrategyTag;
  marketContext: MarketContextSnapshot;
  thesis?: TradeThesisSnapshot;
  expectedValue?: ExpectedValueSnapshot;
  tradeQuality?: TradeQualitySnapshot;
  conflicts?: DecisionConflict[];
}
