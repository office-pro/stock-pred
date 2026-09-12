/**
 * P5 Phase 3 Focus Universe — optimization-only preselection.
 * Never authorization. Never RankingScore. Tiers from deterministic rank order.
 */

import type { DataFreshnessStatus } from './market';
import type { P5DecisionRankingContext } from './p5-measurement';

/** How the desk candidate entered the human decision path. */
export type OpportunityDiscoverySource = 'OFFLINE_PRESELECTED' | 'LIVE_DISCOVERED';

/** Focus priority buckets — not trade auth. */
export type FocusTier = 1 | 2 | 3;

/**
 * Deterministic tier boundaries from RankingContext lexicographic rank (1-based).
 * Documented constants — not scores, not authorization.
 *
 * T1 = ranks 1..FOCUS_TIER1_COUNT
 * T2 = ranks FOCUS_TIER1_COUNT+1 .. FOCUS_TIER1_COUNT+FOCUS_TIER2_COUNT
 * T3 = remaining
 */
export const FOCUS_TIER1_COUNT = 15;
export const FOCUS_TIER2_COUNT = 35;

export interface DataProvenance {
  dataAsOf: number;
  receivedAt: number;
  analysisAt: number;
  dataAgeMs: number;
  dataStatus: DataFreshnessStatus;
}

export interface FocusUniverseCandidate {
  symbol: string;
  focusTier: FocusTier;
  /** 1-based rank from existing lexicographic RankingContext order. */
  rank: number;
  opportunityId?: string;
  rankingContext?: Pick<
    P5DecisionRankingContext,
    'rankingEngineVersion' | 'calculationVersion' | 'tradeHorizon' | 'strategyTag' | 'rank'
  >;
  /** Compact intelligence labels at batch time (read-only snapshot). */
  intelligenceContext?: {
    thesis?: string;
    decision?: string;
    overallScore?: number;
  };
  provenance: DataProvenance;
}

export interface FocusUniverseBatch {
  schemaVersion: 'focus-universe.v1';
  batchId: string;
  generatedAt: number;
  dataAsOf: number;
  source: 'EOD_CACHED' | 'MIXED' | 'LIVE';
  dataStatus: DataFreshnessStatus;
  universeSize: number;
  /** Documented tier cutoffs used for this batch. */
  tierBoundaries: {
    tier1Count: number;
    tier2Count: number;
    note: string;
  };
  candidates: FocusUniverseCandidate[];
}

/** Stamp on opportunities / ledger — FocusUniverseBatch → Opportunity → Decision. */
export interface OpportunityEvidenceProvenance {
  discoverySource: OpportunityDiscoverySource;
  batchId?: string;
  focusTier?: FocusTier;
  dataProvenance: DataProvenance;
  /**
   * True only after live refresh + intel recalculation for the current session.
   * OFFLINE_PRESELECTED does NOT imply LIVE_READY.
   */
  liveReady: boolean;
}
