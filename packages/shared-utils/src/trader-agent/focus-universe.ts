/**
 * Focus Universe helpers — tiers from deterministic rank only (no RankingScore).
 * Offline batch is read-only: never ledger / Risk / Policy / Gate / orders.
 */

import type {
  DataFreshnessStatus,
  DataProvenance,
  FocusTier,
  FocusUniverseBatch,
  FocusUniverseCandidate,
  OpportunityDiscoverySource,
  OpportunityEvidenceProvenance,
  TiTradeHorizon,
} from '@stockpred/shared-types';
import { FOCUS_TIER1_COUNT, FOCUS_TIER2_COUNT } from '@stockpred/shared-types';
import { classifyQuoteStatus } from '../market-hours';

export function focusTierFromRank(
  rank: number,
  tier1Count = FOCUS_TIER1_COUNT,
  tier2Count = FOCUS_TIER2_COUNT,
): FocusTier {
  if (!Number.isFinite(rank) || rank < 1) return 3;
  if (rank <= tier1Count) return 1;
  if (rank <= tier1Count + tier2Count) return 2;
  return 3;
}

export function buildDataProvenance(input: {
  dataAsOf: number | null | undefined;
  receivedAt?: number;
  analysisAt?: number;
  now?: number;
}): DataProvenance {
  const now = input.now ?? Date.now();
  const receivedAt = input.receivedAt ?? now;
  const analysisAt = input.analysisAt ?? now;
  const dataAsOf =
    input.dataAsOf != null && Number.isFinite(input.dataAsOf) && input.dataAsOf > 0
      ? input.dataAsOf
      : 0;
  const dataStatus = classifyQuoteStatus(dataAsOf > 0 ? dataAsOf : null, now);
  const dataAgeMs = dataAsOf > 0 ? Math.max(0, now - dataAsOf) : -1;
  return {
    dataAsOf,
    receivedAt,
    analysisAt,
    dataAgeMs,
    dataStatus,
  };
}

export interface RankedFocusInputRow {
  symbol: string;
  rank: number;
  opportunityId?: string;
  rankingEngineVersion?: string;
  calculationVersion?: string;
  tradeHorizon?: TiTradeHorizon;
  strategyTag?: string;
  thesis?: string;
  decision?: string;
  overallScore?: number;
  dataAsOf?: number | null;
}

export function assignFocusCandidates(input: {
  ranked: RankedFocusInputRow[];
  batchId: string;
  generatedAt: number;
  dataAsOf: number;
  source: FocusUniverseBatch['source'];
  dataStatus: DataFreshnessStatus;
  universeSize: number;
  tier1Count?: number;
  tier2Count?: number;
}): FocusUniverseBatch {
  const tier1Count = input.tier1Count ?? FOCUS_TIER1_COUNT;
  const tier2Count = input.tier2Count ?? FOCUS_TIER2_COUNT;
  const analysisAt = input.generatedAt;

  const candidates: FocusUniverseCandidate[] = [...input.ranked]
    .sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol))
    .map((row) => {
      const focusTier = focusTierFromRank(row.rank, tier1Count, tier2Count);
      const provenance = buildDataProvenance({
        dataAsOf: row.dataAsOf ?? input.dataAsOf,
        receivedAt: input.generatedAt,
        analysisAt,
        now: input.generatedAt,
      });
      const rankingContext: FocusUniverseCandidate['rankingContext'] =
        row.rankingEngineVersion && row.calculationVersion && row.tradeHorizon && row.strategyTag
          ? {
              rankingEngineVersion: row.rankingEngineVersion,
              calculationVersion: row.calculationVersion,
              tradeHorizon: row.tradeHorizon,
              strategyTag: row.strategyTag,
              rank: row.rank,
            }
          : undefined;
      return {
        symbol: row.symbol.toUpperCase(),
        focusTier,
        rank: row.rank,
        opportunityId: row.opportunityId,
        rankingContext,
        intelligenceContext: {
          thesis: row.thesis,
          decision: row.decision,
          overallScore: row.overallScore,
        },
        provenance,
      };
    });

  return {
    schemaVersion: 'focus-universe.v1',
    batchId: input.batchId,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataAsOf,
    source: input.source,
    dataStatus: input.dataStatus,
    universeSize: input.universeSize,
    tierBoundaries: {
      tier1Count,
      tier2Count,
      note: `T1=ranks 1..${tier1Count}; T2=ranks ${tier1Count + 1}..${tier1Count + tier2Count}; T3=rest. Deterministic RankingContext order only — no RankingScore.`,
    },
    candidates,
  };
}

export function discoverySourceForSymbol(
  batch: FocusUniverseBatch | null | undefined,
  symbol: string,
): { discoverySource: OpportunityDiscoverySource; batchId?: string; focusTier?: FocusTier } {
  if (!batch) {
    return { discoverySource: 'LIVE_DISCOVERED' };
  }
  const hit = batch.candidates.find((c) => c.symbol === symbol.toUpperCase());
  if (!hit) {
    return { discoverySource: 'LIVE_DISCOVERED', batchId: batch.batchId };
  }
  return {
    discoverySource: 'OFFLINE_PRESELECTED',
    batchId: batch.batchId,
    focusTier: hit.focusTier,
  };
}

export function buildOpportunityEvidenceProvenance(input: {
  batch: FocusUniverseBatch | null | undefined;
  symbol: string;
  dataProvenance: DataProvenance;
  liveReady: boolean;
}): OpportunityEvidenceProvenance {
  const disc = discoverySourceForSymbol(input.batch, input.symbol);
  return {
    discoverySource: disc.discoverySource,
    batchId: disc.batchId,
    focusTier: disc.focusTier,
    dataProvenance: input.dataProvenance,
    liveReady: input.liveReady,
  };
}

/** Sort symbols for live refresh: Tier1 → Tier2 → Tier3, then stable by rank. */
export function prioritizeSymbolsForLiveRefresh(batch: FocusUniverseBatch): string[] {
  return [...batch.candidates]
    .sort(
      (a, b) => a.focusTier - b.focusTier || a.rank - b.rank || a.symbol.localeCompare(b.symbol),
    )
    .map((c) => c.symbol);
}
