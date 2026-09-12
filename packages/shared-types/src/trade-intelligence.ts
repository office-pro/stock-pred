/**
 * Professional Trade Intelligence — observe-only (Phase 4 / T1).
 * Captured before evaluateTrade for the ledger; never consumed by
 * Risk / Portfolio / Policy / Gate.
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

/** T1.1 canonical direction regime (TI primary). */
export type TiDirectionRegime = 'BULL' | 'BEAR' | 'NEUTRAL';

/** T1.1 volatility regime. */
export type TiVolatilityRegime = 'HIGH_VOL' | 'LOW_VOL' | 'NORMAL_VOL';

/** Derived eligibility compatibility for evaluateTrade (behavior-stable). */
export type TiRiskCompatibility = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export type TiRegimeFit = 'HIGH' | 'MED' | 'LOW';

/** T1.4 cross-sectional relative-strength bucket (vs Nifty / peers). */
export type TiRsBucket = 'LEADERS' | 'MIDDLE' | 'LAGGARDS' | 'UNKNOWN';

/** T1.4 sector trend vs market (advisory). */
export type TiSectorTrend = 'LEADING' | 'INLINE' | 'LAGGING' | 'UNKNOWN';

/** T1.4 valuation vs sector peer medians (advisory). */
export type TiValuationVsPeers = 'CHEAP' | 'FAIR' | 'RICH' | 'UNKNOWN';

/** T1.4 combined sector + RS fit for the long thesis (advisory). */
export type TiSectorFit = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

/** T1.5 intended trade / strategy horizon (drives which charts matter). */
export type TiTradeHorizon = 'DAY_TRADE' | 'SWING_TRADE' | 'POSITION';

/** T1.5 chart horizons retained individually (never collapsed into one score). */
export type TiChartHorizon = 'M5' | 'M15' | 'H1' | 'H4' | 'D1' | 'W1';

/** T1.5 directional bias on a single chart horizon. */
export type TiHorizonBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

/** T1.5 agreement / alignment grade (advisory). */
export type TiAgreementLevel = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

/** T1.6 breadth / participation regime (kept separate from trend). */
export type TiBreadthRegime = 'STRONG' | 'NORMAL' | 'WEAK' | 'UNKNOWN';

/** T1.6 liquidity regime (kept separate — never folded into a RegimeScore). */
export type TiLiquidityRegime = 'HIGH' | 'NORMAL' | 'LOW' | 'UNKNOWN';

/** T1.6 index structure bias (advisory). */
export type TiIndexStructure = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

/**
 * T1.6 setup ↔ regime compatibility (advisory).
 * UNFAVORABLE ≠ REJECT — soft information only.
 */
export type TiRegimeCompatibility = 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE' | 'UNKNOWN';

/** Per-dimension stance vs the intended setup (preserved for drift / P7 learning). */
export type TiDimensionStance = 'SUPPORTIVE' | 'NEUTRAL' | 'HOSTILE' | 'UNKNOWN';

/** Named regime dimensions retained individually. */
export type TiRegimeDimension =
  | 'TREND'
  | 'VOLATILITY'
  | 'BREADTH'
  | 'LIQUIDITY'
  | 'INDEX_STRUCTURE'
  | 'SECTOR_BREADTH';

/**
 * Attributable provenance for TI assessments (audit / later realized-R learning).
 * Observe-only — never an authorization input.
 */
export interface TiAssessmentProvenance {
  engineVersion: string;
  calculationVersion: string;
  sourceDataTimestamp?: string;
  asOf?: string;
  /** Compact input fingerprint for explainability. */
  inputs?: Record<string, string | number | boolean | null>;
}

/**
 * Provenance for direction / barrier probabilities.
 * Never treat RAW_MODEL confidence as calibrated without labeling.
 */
export type ProbabilitySource = 'CALIBRATED' | 'RAW_MODEL' | 'HEURISTIC';

/** Documents that E[R] / hit probs are heuristic, not a trained ML probability. */
export type ExpectedValueMethod = 'GEOMETRIC_HEURISTIC_V1';

export interface MarketContextSnapshot {
  /** Compatibility string (direction or legacy RISK_*). Prefer directionRegime. */
  regime?: string;
  volatilityRegime?: string;
  directionRegime?: TiDirectionRegime;
  /** e.g. BULL+LOW_VOL */
  regimeCombo?: string;
  asOf?: string;
  scannerRegime?: string;
  riskCompatibility?: TiRiskCompatibility;
  breadth?: number | null;
  indexTrend?: string;
  sectorTrend?: string;
  liquidity?: string;
  vixLevel?: number | null;
  niftyChangePercent?: number | null;
}

/** T1.4 cross-sectional relative strength (observe-only). */
export interface CrossSectionalRsAssessment {
  /** Stock / Nifty cumulative-return ratio (~60d); >1 outperforms. */
  rsVsNifty50?: number | null;
  /** Percentile among provided peers (0–100); omitted when peer sample missing. */
  rsPercentile?: number | null;
  rsBucket: TiRsBucket;
  peerSampleSize?: number;
  asOf?: string;
  source: 'QUOTE_RS' | 'PEER_CROSS_SECTION' | 'MIXED' | 'MISSING';
  provenance?: TiAssessmentProvenance;
}

/** T1.4 sector intelligence (observe-only). */
export interface SectorIntelligenceAssessment {
  sector?: string | null;
  sectorTrend: TiSectorTrend;
  /** Stock RS / sector-median RS when both present. */
  stockVsSectorRs?: number | null;
  valuationVsPeers: TiValuationVsPeers;
  peVsMedianPct?: number | null;
  pbVsMedianPct?: number | null;
  sectorFit: TiSectorFit;
  asOf?: string;
  provenance?: TiAssessmentProvenance;
}

/** T1.5 single-horizon bias (preserved; not averaged into a magic score). */
export interface HorizonBiasAssessment {
  horizon: TiChartHorizon;
  bias: TiHorizonBias;
  /** 0–1 heuristic strength from return magnitude; omit when unknown. */
  strength?: number;
  /** PRIMARY = required for trade horizon; HIGHER_TF = confirmation; CONTEXT = optional. */
  role: 'PRIMARY' | 'HIGHER_TF' | 'CONTEXT';
  provenance?: TiAssessmentProvenance;
}

/** Soft conflict on multi-horizon agreement (information, not a veto). */
export interface MultiHorizonConflict {
  code: string;
  message: string;
  horizons?: TiChartHorizon[];
}

/**
 * T1.5 multi-horizon agreement relative to intended trade horizon / side.
 * Advisory only — never Risk / Portfolio / Policy / Gate input.
 */
export interface MultiHorizonAgreementAssessment {
  tradeHorizon: TiTradeHorizon;
  intendedSide: 'LONG' | 'SHORT';
  /** Full per-horizon list — do not collapse clientside into one score. */
  horizons: HorizonBiasAssessment[];
  agreement: TiAgreementLevel;
  higherTimeframeAlignment: TiAgreementLevel;
  dominantBias: TiHorizonBias;
  conflicts: MultiHorizonConflict[];
  provenance: TiAssessmentProvenance;
}

/** T1.6 multidimensional market regime (never collapsed into one RegimeScore). */
export interface MarketRegimeDimensions {
  trend: TiDirectionRegime;
  volatility: TiVolatilityRegime;
  breadth: TiBreadthRegime;
  liquidity: TiLiquidityRegime;
  indexStructure: TiIndexStructure;
  sectorBreadth: TiBreadthRegime;
  asOf?: string;
  provenance?: TiAssessmentProvenance;
}

/** Soft conflict on regime compatibility (information, not a veto). */
export interface RegimeCompatibilityConflict {
  code: string;
  message: string;
  dimension?: TiRegimeDimension;
}

/** Per-dimension note for explainability / later drift attribution. */
export interface RegimeDimensionNote {
  dimension: TiRegimeDimension;
  stance: TiDimensionStance;
  note: string;
}

/**
 * T1.6 setup ↔ market regime compatibility (advisory).
 * UNFAVORABLE is contextual weakness — never a Gate reject.
 */
export interface RegimeCompatibilityAssessment {
  setupStyle: StrategyTag;
  tradeHorizon?: TiTradeHorizon;
  intendedSide: 'LONG' | 'SHORT';
  /** Full dimension set — do not average clientside into one score. */
  dimensions: MarketRegimeDimensions;
  compatibility: TiRegimeCompatibility;
  dimensionNotes: RegimeDimensionNote[];
  conflicts: RegimeCompatibilityConflict[];
  provenance: TiAssessmentProvenance;
}

/** T1.7 explicit catalyst / event types (never collapsed into CatalystScore). */
export type TiCatalystType =
  | 'EARNINGS'
  | 'GUIDANCE'
  | 'CORPORATE_ACTION'
  | 'DIVIDEND'
  | 'ORDER_WIN'
  | 'REGULATORY'
  | 'MACRO'
  | 'SECTOR_EVENT'
  | 'MANAGEMENT_EVENT'
  | 'NEWS'
  | 'OTHER';

/** Directional implication when known; UNKNOWN for unresolved binary events. */
export type TiCatalystDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

export type TiCatalystStrength = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

export type TiCatalystRelevance = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

/** How soon the event is relative to the decision. */
export type TiEventProximity = 'IMMINENT' | 'NEAR' | 'UPCOMING' | 'DISTANT' | 'PAST' | 'UNKNOWN';

export type TiExpectedImpact = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

export type TiEventUncertainty = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

/** Event-risk grade — separate from catalyst direction. */
export type TiEventRisk = 'HIGH' | 'MED' | 'LOW' | 'NONE' | 'UNKNOWN';

/**
 * How the event interacts with the trade thesis.
 * INCREASES_EVENT_RISK is not a directional call.
 */
export type TiThesisInteraction =
  | 'SUPPORTS'
  | 'CONFLICTS'
  | 'INCREASES_EVENT_RISK'
  | 'NEUTRAL'
  | 'UNKNOWN';

/**
 * Look-ahead provenance for a catalyst event.
 * At decision time T, only events with eventPublishedAt ≤ T may enter the snapshot.
 */
export interface CatalystEventProvenance {
  sourceDataTimestamp?: string;
  /** When the event became publicly knowable. */
  eventPublishedAt: string;
  /** When the event occurs / takes effect (e.g. earnings release). */
  eventEffectiveAt?: string;
  /** When TI observed / ingested the event. */
  observedAt: string;
  feedId?: string;
  source?: string;
}

/** Single logical catalyst/event after dedupe (observe-only). */
export interface CatalystEventAssessment {
  /** Stable logical id after feed deduplication. */
  id: string;
  type: TiCatalystType;
  title?: string;
  direction: TiCatalystDirection;
  strength: TiCatalystStrength;
  relevance: TiCatalystRelevance;
  proximity: TiEventProximity;
  expectedImpact: TiExpectedImpact;
  uncertainty: TiEventUncertainty;
  /** Approx trading sessions until effectiveAt; omit when unknown. */
  sessionsUntil?: number | null;
  provenance: CatalystEventProvenance;
  /** Feed ids merged into this logical event. */
  sourceFeeds?: string[];
}

/** Optional pre-event market reaction context (advisory). */
export interface MarketReactionContext {
  preEventBehavior?: 'ACCUMULATION' | 'DISTRIBUTION' | 'QUIET' | 'VOLATILE' | 'UNKNOWN';
  volumeStance?: 'ELEVATED' | 'NORMAL' | 'LIGHT' | 'UNKNOWN';
  volatilityStance?: 'ELEVATED' | 'NORMAL' | 'COMPRESSED' | 'UNKNOWN';
}

/** Soft conflict on catalyst / event context (information, not a veto). */
export interface CatalystConflict {
  code: string;
  message: string;
  eventIds?: string[];
}

/**
 * T1.7 catalyst / event context (advisory).
 * Distinguishes event risk from directional catalysts — never a magic score.
 */
export interface CatalystContextAssessment {
  intendedSide: 'LONG' | 'SHORT';
  tradeHorizon?: TiTradeHorizon;
  /** Deduped, look-ahead-safe events. */
  events: CatalystEventAssessment[];
  eventRisk: TiEventRisk;
  thesisInteraction: TiThesisInteraction;
  marketReaction?: MarketReactionContext;
  conflicts: CatalystConflict[];
  provenance: TiAssessmentProvenance;
}

/** T1.2 stock opportunity assessment (advisory). */
export interface StockOpportunityAssessment {
  pUp?: number;
  pDown?: number;
  pSideways?: number;
  expectedReturn?: number | null;
  expectedMfe?: number | null;
  expectedMae?: number | null;
  regimeFit?: TiRegimeFit;
  probabilitySource?: ProbabilitySource;
  holdingPeriodSessions?: number;
  /** T1.4 — attached when RS/sector context is available. */
  crossSectionalRs?: CrossSectionalRsAssessment;
  sectorIntelligence?: SectorIntelligenceAssessment;
  /** T1.5 — attached when multi-horizon context is available. */
  multiHorizonAgreement?: MultiHorizonAgreementAssessment;
  /** T1.6 — attached when regime compatibility context is available. */
  regimeCompatibility?: RegimeCompatibilityAssessment;
  /** T1.7 — attached when catalyst/event context is available. */
  catalystContext?: CatalystContextAssessment;
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
  /** Residual: neither barrier within horizon. pHit + pStop + pNeither = 1. */
  probabilityNeither?: number;
  rewardR?: number;
  riskR?: number;
  expectedValueR?: number;
  /** Heuristic P(target before stop) — not a trained calibrated ML probability. */
  probTargetBeforeStop?: number;
  probabilitySource?: ProbabilitySource;
  expectedValueMethod?: ExpectedValueMethod;
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

// ─── T1.8 Opportunity Ranking (advisory shortlist — never authorize) ───

/** Ranking objective / horizon context (CLEAR dominance is scoped to this). */
export type TiRankingHorizon = TiTradeHorizon;

/** Ordinal band for a ranking dimension (UNKNOWN ≠ neutral). */
export type TiRankingBand = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';

export type TiRankingDominance = 'CLEAR' | 'CLOSE' | 'MIXED' | 'NO_CLEAR_WINNER';

export type TiDataCompleteness = 'COMPLETE' | 'PARTIAL' | 'DATA_INCOMPLETE';

/** Named dimensions compared under RankingContext precedence. */
export type TiRankingDimension =
  | 'EV'
  | 'RS'
  | 'SECTOR'
  | 'MTF'
  | 'REGIME'
  | 'EVENT_RISK'
  | 'TECHNICAL'
  | 'LIQUIDITY'
  | 'FRESHNESS'
  | 'PORTFOLIO_FIT';

/**
 * Frozen ranking context. Replays must use the same context + universe + versions.
 */
export interface RankingContext {
  tradeHorizon: TiTradeHorizon;
  strategyTag?: StrategyTag;
  marketRegime?: string;
  /** Soft portfolio anchors (display/tie-break only — never veto/authorize). */
  portfolioState?: {
    openSymbols?: string[];
    sectorExposurePct?: Record<string, number>;
  };
  timestamp: string;
}

export interface RankingEvidence {
  code: string;
  message: string;
  dimension?: TiRankingDimension;
  polarity: 'STRENGTH' | 'WEAKNESS';
}

/** Symmetric pairwise explanation (store both ABOVE and BELOW sides). */
export interface PairwiseRankingReason {
  peerSymbol: string;
  peerOpportunityId?: string;
  /** ABOVE = this candidate beats peer; BELOW = this candidate loses to peer. */
  polarity: 'ABOVE' | 'BELOW';
  evidence: RankingEvidence[];
}

/** Per-candidate dimension strip (explicit bands — no RankingScore). */
export interface RankingDimensionStrip {
  ev: TiRankingBand;
  rs: TiRankingBand;
  sector: TiRankingBand;
  mtf: TiRankingBand;
  regime: TiRankingBand;
  /** Higher band = lower event risk (safer). */
  eventSafety: TiRankingBand;
  technical: TiRankingBand;
  liquidity: TiRankingBand;
  freshness: TiRankingBand;
  /** Soft context only — tie-break at end of precedence. */
  portfolioFit: TiRankingBand;
  expectedValueR?: number | null;
}

/**
 * T1.8 per-opportunity ranking assessment (observe-only).
 * Never contains rankingScore / rankScore.
 */
export interface OpportunityRankingAssessment {
  rank: number;
  symbol: string;
  opportunityId: string;
  dimensions: RankingDimensionStrip;
  strengths: RankingEvidence[];
  weaknesses: RankingEvidence[];
  conflicts: DecisionConflict[];
  comparedAgainst: string[];
  /** CLEAR means clear under RankingContext — not objectively best trade. */
  dominance: TiRankingDominance;
  pairwiseReasons: PairwiseRankingReason[];
  dataCompleteness: TiDataCompleteness;
  unknownDimensions: TiRankingDimension[];
  stale: boolean;
  provenance: TiAssessmentProvenance;
}

/**
 * Immutable ranking result / decision briefing envelope.
 * Reconstructable: context + universe + versions + candidates → same ranks.
 */
export interface OpportunityRankingResult {
  context: RankingContext;
  timestamp: string;
  engineVersion: string;
  calculationVersion: string;
  /** Input universe (order-independent; sorted for stability in provenance). */
  candidateUniverse: string[];
  rankings: OpportunityRankingAssessment[];
  noClearWinner: boolean;
  provenance: TiAssessmentProvenance;
}

export const INTELLIGENCE_SCHEMA_VERSION = 'intelligence.v1';
export const INTELLIGENCE_ENGINE_VERSION = 'trade-intelligence-t1.8.0';

/**
 * Versioned, immutable decision-time evidence.
 * Store / display only. Do not feed into authorization engines.
 */
export interface IntelligenceSnapshot {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION | string;
  engineVersion: string;
  generatedAt: string;
  sourceDataTimestamp: string;
  strategyTag?: StrategyTag;
  marketContext: MarketContextSnapshot;
  thesis?: TradeThesisSnapshot;
  expectedValue?: ExpectedValueSnapshot;
  tradeQuality?: TradeQualitySnapshot;
  opportunity?: StockOpportunityAssessment;
  /** T1.4 cross-sectional RS (also mirrored on opportunity when present). */
  crossSectionalRs?: CrossSectionalRsAssessment;
  /** T1.4 sector intelligence (also mirrored on opportunity when present). */
  sectorIntelligence?: SectorIntelligenceAssessment;
  /** T1.5 multi-horizon agreement (also mirrored on opportunity when present). */
  multiHorizonAgreement?: MultiHorizonAgreementAssessment;
  /** T1.6 regime compatibility (also mirrored on opportunity when present). */
  regimeCompatibility?: RegimeCompatibilityAssessment;
  /** T1.7 catalyst / event context (also mirrored on opportunity when present). */
  catalystContext?: CatalystContextAssessment;
  /**
   * T1.8 single-symbol echo only when a batch ranking was narrowed to one name.
   * Primary shortlist lives on OpportunityRankingResult from getOpportunities.
   */
  opportunityRanking?: OpportunityRankingAssessment;
  conflicts?: DecisionConflict[];
  /**
   * Optional ML evidence for ledger/audit (M4).
   * Observe-only — never feed into Risk / Portfolio / Policy / Gate.
   */
  mlPrediction?: import('./ml').MLPredictionSnapshot;
}
