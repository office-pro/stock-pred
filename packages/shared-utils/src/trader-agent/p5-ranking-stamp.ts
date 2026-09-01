/**
 * P5 ranking cohort stamp — freeze T1.8 ranking at decision time.
 * Observe-only. Never re-ranks. Never feeds Risk / Portfolio / Policy / Gate.
 */

import { randomUUID } from 'crypto';
import type { OpportunityRankingResult, P5DecisionRankingContext } from '@stockpred/shared-types';

/**
 * Build an immutable ranking context for one opportunity from a frozen batch result.
 * Returns null when the opportunity is not in the batch (do not re-run ranking).
 */
export function stampRankingContextFromResult(
  ranking: OpportunityRankingResult | null | undefined,
  opportunityId: string,
  symbol: string,
): P5DecisionRankingContext | null {
  if (!ranking || !Array.isArray(ranking.rankings) || ranking.rankings.length === 0) {
    return null;
  }
  const self =
    ranking.rankings.find((r) => r.opportunityId === opportunityId) ??
    ranking.rankings.find((r) => r.symbol === symbol);
  if (!self) return null;

  return {
    rankingContextId: randomUUID(),
    rankingEngineVersion: ranking.engineVersion,
    calculationVersion: ranking.calculationVersion,
    tradeHorizon: ranking.context.tradeHorizon,
    strategyTag: ranking.context.strategyTag,
    timestamp: ranking.timestamp || ranking.context.timestamp,
    rank: self.rank,
    candidateUniverse: [...ranking.candidateUniverse],
    peerRanks: ranking.rankings.map((r) => ({
      symbol: r.symbol,
      opportunityId: r.opportunityId,
      rank: r.rank,
      dominance: r.dominance,
    })),
  };
}
