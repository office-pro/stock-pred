/**
 * B6 — Professional Trader Assessment + TradePlan + advisory Recommendation.
 * Advisory only — never authorizes. APPROVE ≠ evaluateTrade / Risk / Gate / orders.
 */

export type ProfessionalTraderDirection = 'LONG' | 'SHORT' | 'FLAT';

export type OpportunityQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

/** Advisory recommendation — not authorization. */
export type AdvisoryRecommendation = 'APPROVE' | 'WAIT' | 'REJECT';

export interface ProfessionalTraderEvidenceItem {
  code: string;
  message: string;
  source: string;
  polarity?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNKNOWN';
}

export interface ProfessionalTraderAssessment {
  schemaVersion: 'professional-trader.v1';
  symbol: string;
  direction: ProfessionalTraderDirection;
  opportunityQuality: OpportunityQuality;
  /** Upside / favorability probability in [0, 1] when known. */
  probability?: number;
  expectedReturnPct?: { low: number; high: number };
  expectedR?: number;
  horizon?: string;
  confidence?: number;
  evidence: ProfessionalTraderEvidenceItem[];
  risks: string[];
  invalidation: string[];
  reasoning: string[];
  provenance: {
    generatedAt: string;
    dataAsOf?: string;
    intelligenceVersion?: string;
    modelVersions?: string[];
  };
}

export interface TradePlan {
  schemaVersion: 'trade-plan.v1';
  opportunityId: string;
  symbol: string;
  direction: ProfessionalTraderDirection;
  entryRange?: { low: number; high: number };
  preferredEntry?: number;
  upsideProbability?: number;
  expectedReturnRange?: { lowPct: number; highPct: number };
  expectedPriceRange?: { low: number; high: number };
  horizon?: string;
  targetRange?: { t1?: number; t2?: number; t3?: number };
  invalidationPrice?: number;
  expectedR?: number;
  confidence?: number;
  cutoffTime?: number;
  thesis?: string;
  catalyst?: string;
  regime?: string;
  exitStrategy?: string;
  reassessmentRequired: boolean;
  recommendation: AdvisoryRecommendation;
  assessment: ProfessionalTraderAssessment;
  provenance: {
    generatedAt: string;
    dataAsOf?: string;
    intelligenceVersion: string;
    modelVersions: string[];
    rankingContextVersion?: string;
  };
}
