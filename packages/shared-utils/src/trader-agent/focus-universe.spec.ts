/**
 * Focus Universe helpers — unit tests (deterministic tiers, no RankingScore).
 */

import { FOCUS_TIER1_COUNT, FOCUS_TIER2_COUNT } from '@stockpred/shared-types';
import {
  assignFocusCandidates,
  discoverySourceForSymbol,
  focusTierFromRank,
  prioritizeSymbolsForLiveRefresh,
} from './focus-universe';

describe('focusTierFromRank', () => {
  it('assigns T1/T2/T3 from deterministic rank bands only', () => {
    expect(focusTierFromRank(1)).toBe(1);
    expect(focusTierFromRank(FOCUS_TIER1_COUNT)).toBe(1);
    expect(focusTierFromRank(FOCUS_TIER1_COUNT + 1)).toBe(2);
    expect(focusTierFromRank(FOCUS_TIER1_COUNT + FOCUS_TIER2_COUNT)).toBe(2);
    expect(focusTierFromRank(FOCUS_TIER1_COUNT + FOCUS_TIER2_COUNT + 1)).toBe(3);
  });
});

describe('assignFocusCandidates', () => {
  it('preserves lexicographic rank order and stamps tiers without a RankingScore', () => {
    const batch = assignFocusCandidates({
      batchId: 'B-test',
      generatedAt: 1_700_000_000_000,
      dataAsOf: 1_700_000_000_000 - 3_600_000,
      source: 'EOD_CACHED',
      dataStatus: 'CLOSED_MARKET',
      universeSize: 3,
      ranked: [
        { symbol: 'tcs', rank: 2, overallScore: 50 },
        { symbol: 'RELIANCE', rank: 1, overallScore: 90 },
        { symbol: 'INFY', rank: 3, overallScore: 10 },
      ],
    });
    expect(batch.candidates.map((c) => c.symbol)).toEqual(['RELIANCE', 'TCS', 'INFY']);
    expect(batch.candidates[0].focusTier).toBe(1);
    expect(batch.candidates[0].rank).toBe(1);
    expect(batch.tierBoundaries.note).toContain('no RankingScore');
  });
});

describe('discoverySourceForSymbol / prioritizeSymbolsForLiveRefresh', () => {
  const batch = assignFocusCandidates({
    batchId: 'B1',
    generatedAt: Date.now(),
    dataAsOf: Date.now(),
    source: 'EOD_CACHED',
    dataStatus: 'CLOSED_MARKET',
    universeSize: 3,
    tier1Count: 1,
    tier2Count: 1,
    ranked: [
      { symbol: 'AAA', rank: 1 },
      { symbol: 'BBB', rank: 2 },
      { symbol: 'CCC', rank: 3 },
    ],
  });

  it('marks batch members OFFLINE_PRESELECTED', () => {
    expect(discoverySourceForSymbol(batch, 'AAA').discoverySource).toBe('OFFLINE_PRESELECTED');
    expect(discoverySourceForSymbol(batch, 'ZZZ').discoverySource).toBe('LIVE_DISCOVERED');
  });

  it('orders live refresh Tier1 → Tier2 → Tier3', () => {
    expect(prioritizeSymbolsForLiveRefresh(batch)).toEqual(['AAA', 'BBB', 'CCC']);
  });
});
