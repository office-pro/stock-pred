import type { BatchInstrumentData, IntelligenceBatchResultRow } from '@stockpred/shared-types';
import {
  applyRecommendationEligibility,
  evaluateBatchRecommendationEligibility,
  RANKING_CONTEXT_IS_ADVISORY,
  snapshotEvidenceAvailability,
} from './batch-recommendation-eligibility';
import { buildBatchResearchReport, isBestOpportunityRow } from './batch-research-report';

function candles(n: number): NonNullable<BatchInstrumentData['candles']> {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000_000 + i * 86_400_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + (i === 0 ? 0 : 0.1),
    volume: 1_000,
  }));
}

function equitySnapshot(opts: {
  quote?: boolean;
  candleCount?: number;
  fundamentals?: 'statements' | 'unavailable' | 'missing';
  news?: 'headlines' | 'unavailable';
  sentimentScore?: number | null;
}): BatchInstrumentData {
  const row: BatchInstrumentData = {
    instrumentRef: {
      symbol: 'TCS',
      assetClass: 'EQUITY',
      venue: 'NSE',
      quoteCurrency: 'INR',
      canonicalSymbol: 'TCS',
    },
    dataStatus: 'AVAILABLE',
  };
  if (opts.quote !== false) {
    row.quote = { price: 100 };
  }
  if (opts.candleCount != null) {
    row.candles = candles(opts.candleCount);
  }
  if (opts.fundamentals === 'statements') {
    row.fundamentals = { kind: 'EQUITY_STATEMENTS', revenue: 1_000, roe: 18 };
  } else if (opts.fundamentals === 'unavailable') {
    row.fundamentals = {
      kind: 'UNAVAILABLE',
      reasonCode: 'MDS_FUNDAMENTALS_MISSING',
      message: 'No statements',
    };
  }
  if (opts.news === 'headlines') {
    row.news = { headlineCount: 3, asOf: 1 };
  } else if (opts.news === 'unavailable') {
    row.news = { headlineCount: 0, reasonCode: 'NO_NEWS' };
  }
  if (opts.sentimentScore != null) {
    row.sentiment = { source: 'MODEL_DERIVED', score: opts.sentimentScore };
  }
  return row;
}

function approveRow(extra: Partial<IntelligenceBatchResultRow> = {}): IntelligenceBatchResultRow {
  return {
    rank: 1,
    symbol: 'TCS',
    opportunityId: 'opp-tcs',
    recommendation: 'APPROVE',
    intelligenceContext: {
      tradePlanRecommendation: 'APPROVE',
      intelligenceLifecycleState: 'OPPORTUNITY',
      opportunityQuality: 'HIGH',
    },
    ...extra,
  };
}

describe('batch recommendation eligibility', () => {
  it('1. complete evidence + APPROVE → eligible opportunity', () => {
    const instrument = equitySnapshot({
      candleCount: 30,
      fundamentals: 'statements',
      news: 'headlines',
    });
    const elig = evaluateBatchRecommendationEligibility({
      instrument,
      assetClass: 'EQUITY',
      dataCompleteness: 'COMPLETE',
    });
    expect(elig.recommendationEligible).toBe(true);
    expect(elig.bestOpportunityEligible).toBe(true);
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      reasonCode: 'TRADE_PLAN_APPROVE',
      reason: 'ProfessionalTrader approved the setup',
      eligibility: elig,
    });
    expect(applied.recommendation).toBe('APPROVE');
    expect(applied.bestOpportunityEligible).toBe(true);
    const row = approveRow({
      dataCompleteness: 'COMPLETE',
      intelligenceContext: {
        tradePlanRecommendation: 'APPROVE',
        intelligenceLifecycleState: 'OPPORTUNITY',
        opportunityQuality: 'HIGH',
        bestOpportunityEligible: true,
      },
    });
    expect(isBestOpportunityRow(row)).toBe(true);
  });

  it('2. fundamentals unavailable → not eligible for Best Opportunities', () => {
    const elig = evaluateBatchRecommendationEligibility({
      instrument: equitySnapshot({
        candleCount: 30,
        fundamentals: 'unavailable',
      }),
      assetClass: 'EQUITY',
      dataCompleteness: 'COMPLETE',
    });
    expect(elig.recommendationEligible).toBe(true);
    expect(elig.bestOpportunityEligible).toBe(false);
    expect(elig.blockingCapabilities).toContain('fundamentals');
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      reasonCode: 'TRADE_PLAN_APPROVE',
      eligibility: elig,
    });
    expect(applied.recommendation).toBe('APPROVE');
    expect(applied.bestOpportunityEligible).toBe(false);
    expect(
      isBestOpportunityRow(
        approveRow({
          intelligenceContext: {
            tradePlanRecommendation: 'APPROVE',
            intelligenceLifecycleState: 'OPPORTUNITY',
            opportunityQuality: 'HIGH',
            bestOpportunityEligible: false,
          },
        }),
      ),
    ).toBe(false);
  });

  it('3. news unavailable → not eligible when news is required by the contract', () => {
    const elig = evaluateBatchRecommendationEligibility({
      instrument: equitySnapshot({
        candleCount: 30,
        fundamentals: 'statements',
        news: 'unavailable',
      }),
      assetClass: 'EQUITY',
      dataCompleteness: 'COMPLETE',
      contract: { requireNews: true },
    });
    expect(elig.recommendationEligible).toBe(false);
    expect(elig.bestOpportunityEligible).toBe(false);
    expect(elig.blockingCapabilities).toContain('news');
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      eligibility: elig,
    });
    expect(applied.recommendation).toBe('WATCH');
    expect(applied.reasonCode).toBe('REQUIRED_EVIDENCE_UNAVAILABLE');
  });

  it('4. multiple required capabilities unavailable → no actionable opportunity', () => {
    const elig = evaluateBatchRecommendationEligibility({
      instrument: equitySnapshot({
        quote: false,
        candleCount: 0,
        fundamentals: 'unavailable',
      }),
      assetClass: 'EQUITY',
    });
    expect(elig.recommendationEligible).toBe(false);
    expect(elig.bestOpportunityEligible).toBe(false);
    expect(elig.blockingCapabilities).toEqual(
      expect.arrayContaining(['marketData', 'historicalCandles']),
    );
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      eligibility: elig,
    });
    expect(applied.recommendation).toBe('WATCH');
    expect(applied.bestOpportunityEligible).toBe(false);
  });

  it('5. capability UNKNOWN / DATA_INCOMPLETE → not promoted', () => {
    expect(
      evaluateBatchRecommendationEligibility({ dataCompleteness: 'DATA_INCOMPLETE' })
        .bestOpportunityEligible,
    ).toBe(false);
    expect(
      evaluateBatchRecommendationEligibility({ dataCompleteness: 'UNKNOWN' })
        .recommendationEligible,
    ).toBe(false);
    expect(snapshotEvidenceAvailability('marketData')).toBe('UNKNOWN');
    expect(
      applyRecommendationEligibility({
        recommendation: 'APPROVE',
        eligibility: evaluateBatchRecommendationEligibility({
          dataCompleteness: 'DATA_INCOMPLETE',
        }),
      }).recommendation,
    ).toBe('WATCH');
  });

  it('6. legitimate numeric zero remains valid data, not treated as missing', () => {
    const instrument = equitySnapshot({
      candleCount: 30,
      fundamentals: 'statements',
      sentimentScore: 0,
    });
    expect(snapshotEvidenceAvailability('sentiment', instrument)).toBe('AVAILABLE');
    expect(instrument.sentiment?.score).toBe(0);
    const elig = evaluateBatchRecommendationEligibility({
      instrument,
      assetClass: 'EQUITY',
      dataCompleteness: 'COMPLETE',
    });
    expect(elig.bestOpportunityEligible).toBe(true);
  });

  it('7. recommendation enum stays APPROVE — no BUY conversion', () => {
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      reasonCode: 'TRADE_PLAN_APPROVE',
      eligibility: {
        recommendationEligible: true,
        bestOpportunityEligible: true,
        blockingCapabilities: [],
      },
    });
    expect(applied.recommendation).toBe('APPROVE');
    expect(applied.recommendation).not.toBe('BUY');
    expect(JSON.stringify(applied)).not.toContain('BUY');
  });

  it('8. high score + incomplete evidence cannot become Best Opportunity', () => {
    const elig = evaluateBatchRecommendationEligibility({
      instrument: equitySnapshot({
        candleCount: 30,
        fundamentals: 'unavailable',
      }),
      assetClass: 'EQUITY',
      dataCompleteness: 'COMPLETE',
    });
    expect(elig.bestOpportunityEligible).toBe(false);
    const row = approveRow({
      rank: 1,
      dataCompleteness: 'COMPLETE',
      intelligenceContext: {
        tradePlanRecommendation: 'APPROVE',
        intelligenceLifecycleState: 'OPPORTUNITY',
        opportunityQuality: 'HIGH',
        tradePlanExpectedR: 4.2,
        bestOpportunityEligible: false,
        recommendationEligibilityReason: 'BEST_OPPORTUNITY_EVIDENCE_INSUFFICIENT',
      },
    });
    expect(isBestOpportunityRow(row)).toBe(false);
    const report = buildBatchResearchReport({
      batchId: 'high-score-incomplete',
      completedAt: 1,
      universe: 'NIFTY500',
      coverage: { total: 1, processed: 1, failed: 0 },
      rankings: [row],
    });
    expect(report.bestOpportunities).toHaveLength(0);
    expect(report.bestPicks).toHaveLength(0);
  });

  it('11. no eligible rows → NO_SUITABLE_OPPORTUNITY', () => {
    const report = buildBatchResearchReport({
      batchId: 'none-eligible',
      completedAt: 1,
      universe: 'NIFTY500',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings: [
        approveRow({
          symbol: 'A',
          opportunityId: 'a',
          intelligenceContext: {
            tradePlanRecommendation: 'APPROVE',
            intelligenceLifecycleState: 'OPPORTUNITY',
            opportunityQuality: 'HIGH',
            bestOpportunityEligible: false,
          },
        }),
        {
          rank: 2,
          symbol: 'B',
          opportunityId: 'b',
          recommendation: 'WATCH',
          intelligenceContext: {
            tradePlanRecommendation: 'APPROVE',
            bestOpportunityEligible: false,
          },
        },
      ],
    });
    expect(report.outcome).toBe('NO_SUITABLE_OPPORTUNITY');
    expect(report.bestOpportunities).toHaveLength(0);
  });

  it('12. RankingContext remains advisory and cannot authorize/rescale/veto execution', () => {
    expect(RANKING_CONTEXT_IS_ADVISORY).toBe(true);
    const elig = evaluateBatchRecommendationEligibility({
      instrument: equitySnapshot({ candleCount: 0, quote: false }),
      assetClass: 'EQUITY',
    });
    expect(elig.recommendationEligible).toBe(false);
    const applied = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      eligibility: elig,
    });
    expect(applied.recommendation).toBe('WATCH');
    expect(applied.bestOpportunityEligible).toBe(false);
    const ranked = approveRow({
      rank: 1,
      recommendation: applied.recommendation,
      intelligenceContext: {
        tradePlanRecommendation: 'APPROVE',
        intelligenceLifecycleState: 'OPPORTUNITY',
        opportunityQuality: 'HIGH',
        bestOpportunityEligible: applied.bestOpportunityEligible,
      },
    });
    expect(ranked.rank).toBe(1);
    expect(isBestOpportunityRow(ranked)).toBe(false);
  });
});
