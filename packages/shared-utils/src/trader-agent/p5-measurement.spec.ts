/**
 * P5 Minimal Measurement Hardening — hard-gate suite.
 *
 * Invariants:
 * - Actual ≠ Counterfactual
 * - Ranking frozen at decision time (stamp from batch; never re-rank)
 * - Missing MAE/MFE stays UNAVAILABLE
 * - INCONCLUSIVE ≠ NO-GO; neither unlocks ARM
 * - GO = eligibility only (never auto-arm)
 * - Risk / Portfolio / Policy unchanged by measurement helpers
 */

import type { AgentAnalysis, OpportunityRankingResult } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
} from './index';
import { evaluateTrade } from './decision-engine';
import {
  computeActualPathMetrics,
  evaluateCounterfactual,
  evaluateWaitMark,
  P5_COUNTERFACTUAL_ENGINE_VERSION,
} from './p5-counterfactual';
import { computeOutcomeDistribution, netRFromGross } from './p5-outcome-stats';
import { stampRankingContextFromResult } from './p5-ranking-stamp';
import { buildP5ValidationReport, resolveP5Verdict } from './p5-validation-report';
import { isLiveAutoEffectivelyArmed, readP5EvidenceUnlock } from './p5-evidence-unlock';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function baseAnalysis(symbol: string, overall = 80): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: overall,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG',
      entry: 3500,
      stopLoss: 3400,
      target1: 3700,
      target2: null,
      target3: null,
      riskReward: 2,
      positionSize: 10,
      expectedHoldingPeriod: '1-5d',
      confidence: overall,
      invalidation: 'Close below stop',
    },
    marketRegime: 'RISK_ON',
    thesis: 'Breakout',
    counterThesis: 'Risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

describe('P5 Minimal Measurement Hardening', () => {
  it('resolveP5Verdict: floors unmet → INCONCLUSIVE (not NO-GO)', () => {
    const v = resolveP5Verdict({
      floorsMet: false,
      safetyPass: true,
      evidenceSupportsReadiness: true,
    });
    expect(v.verdict).toBe('INCONCLUSIVE');
    expect(v.armEligibility).toBe('BLOCKED');
  });

  it('resolveP5Verdict: floors met + safety fail → NO-GO', () => {
    const v = resolveP5Verdict({
      floorsMet: true,
      safetyPass: false,
      evidenceSupportsReadiness: true,
    });
    expect(v.verdict).toBe('NO-GO');
    expect(v.armEligibility).toBe('BLOCKED');
  });

  it('resolveP5Verdict: floors + safety + readiness → GO eligibility only', () => {
    const v = resolveP5Verdict({
      floorsMet: true,
      safetyPass: true,
      evidenceSupportsReadiness: true,
    });
    expect(v.verdict).toBe('GO');
    expect(v.armEligibility).toBe('ELIGIBLE');
  });

  it('INCONCLUSIVE/NO-GO never unlock ARM; GO does not auto-arm', () => {
    const dir = tmpdir();
    const inconclusive = join(dir, `p5-inc-${Date.now()}.json`);
    const nogo = join(dir, `p5-nogo-${Date.now()}.json`);
    const go = join(dir, `p5-go-${Date.now()}.json`);
    writeFileSync(inconclusive, JSON.stringify({ overallDecision: 'INCONCLUSIVE' }));
    writeFileSync(nogo, JSON.stringify({ overallDecision: 'NO-GO' }));
    writeFileSync(go, JSON.stringify({ overallDecision: 'GO' }));
    try {
      expect(readP5EvidenceUnlock(inconclusive).unlocked).toBe(false);
      expect(readP5EvidenceUnlock(nogo).unlocked).toBe(false);
      expect(readP5EvidenceUnlock(go).unlocked).toBe(true);
      expect(isLiveAutoEffectivelyArmed(true, inconclusive)).toBe(false);
      expect(isLiveAutoEffectivelyArmed(true, nogo)).toBe(false);
      expect(isLiveAutoEffectivelyArmed(false, go)).toBe(false);
      expect(isLiveAutoEffectivelyArmed(true, go)).toBe(true);
    } finally {
      for (const p of [inconclusive, nogo, go]) {
        if (existsSync(p)) unlinkSync(p);
      }
    }
  });

  it('empty sample report is INCONCLUSIVE (no fabricated fills)', () => {
    const report = buildP5ValidationReport({
      records: [],
      evidenceSupportsReadiness: true,
    });
    expect(report.verdict).toBe('INCONCLUSIVE');
    expect(report.sample.actualFills).toBe(0);
    expect(report.armEligibility).toBe('BLOCKED');
    expect(report.ranking.outcomeKind).toBe('ACTUAL');
    expect(report.rankingCounterfactual.outcomeKind).toBe('COUNTERFACTUAL');
  });

  it('missing path metrics stay UNAVAILABLE (never invent MAE/MFE)', () => {
    const m = computeActualPathMetrics({
      direction: 'BUY',
      entryPrice: 100,
      stopPrice: 95,
      bars: null,
    });
    expect(m.pathMetricsStatus).toBe('UNAVAILABLE');
    expect(m.maeR).toBeNull();
    expect(m.mfeR).toBeNull();
  });

  it('counterfactual carries provenance versions', () => {
    const result = evaluateCounterfactual({
      direction: 'BUY',
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 110,
      plannedRiskAmount: 50,
      quantity: 10,
      decisionTimestamp: 1_000,
      bars: [
        { ts: 1_100, high: 102, low: 99, close: 101 },
        { ts: 1_200, high: 111, low: 100, close: 110 },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.outcomeKind).toBe('COUNTERFACTUAL');
    expect(result!.counterfactualProvenance.evaluationEngineVersion).toBe(
      P5_COUNTERFACTUAL_ENGINE_VERSION,
    );
    expect(result!.pathMetricsStatus).toBe('AVAILABLE');
  });

  it('WAIT_MARK keeps MAE/MFE UNAVAILABLE', () => {
    const mark = evaluateWaitMark({
      markPrice: 102,
      entryPrice: 100,
      direction: 'BUY',
      plannedRiskAmount: 50,
      quantity: 10,
      decisionTimestamp: 1_000,
      markedAt: 2_000,
      endReason: 'WAIT_EXPIRED',
    });
    expect(mark).not.toBeNull();
    expect(mark!.outcomeKind).toBe('WAIT_MARK');
    expect(mark!.pathMetricsStatus).toBe('UNAVAILABLE');
    expect(mark!.maeR).toBeNull();
  });

  it('ranking stamp freezes cohort from batch (null when absent — no re-rank)', () => {
    const ranking = {
      context: {
        tradeHorizon: 'SWING_TRADE',
        strategyTag: 'BREAKOUT',
        timestamp: '2026-08-24T10:00:00.000Z',
      },
      timestamp: '2026-08-24T10:00:00.000Z',
      engineVersion: 'opportunity-ranking.v1',
      calculationVersion: 'lexicographic-context-precedence.v1',
      candidateUniverse: ['TCS', 'INFY'],
      rankings: [
        {
          rank: 1,
          symbol: 'TCS',
          opportunityId: 'opp-tcs',
          dimensions: {
            ev: 'HIGH',
            rs: 'HIGH',
            sector: 'HIGH',
            mtf: 'MED',
            regime: 'HIGH',
            eventSafety: 'MED',
            technical: 'HIGH',
            liquidity: 'MED',
            freshness: 'HIGH',
            portfolioFit: 'MED',
          },
          strengths: [],
          weaknesses: [],
          conflicts: [],
          comparedAgainst: ['INFY'],
          dominance: 'CLEAR',
          pairwiseReasons: [],
          dataCompleteness: 'PARTIAL',
          unknownDimensions: [],
          stale: false,
          provenance: {
            engineVersion: 'opportunity-ranking.v1',
            calculationVersion: 'lexicographic-context-precedence.v1',
            sourceDataTimestamp: '2026-08-24T10:00:00.000Z',
            asOf: '2026-08-24T10:00:00.000Z',
          },
        },
      ],
      noClearWinner: false,
      provenance: {
        engineVersion: 'opportunity-ranking.v1',
        calculationVersion: 'lexicographic-context-precedence.v1',
        sourceDataTimestamp: '2026-08-24T10:00:00.000Z',
        asOf: '2026-08-24T10:00:00.000Z',
      },
    } as OpportunityRankingResult;

    const stamped = stampRankingContextFromResult(ranking, 'opp-tcs', 'TCS');
    expect(stamped).not.toBeNull();
    expect(stamped!.rank).toBe(1);
    expect(stamped!.candidateUniverse).toEqual(['TCS', 'INFY']);
    expect(stampRankingContextFromResult(ranking, 'opp-x', 'WIPRO')).toBeNull();
  });

  it('cost-adjusted stats never invent empty samples', () => {
    expect(computeOutcomeDistribution([]).sampleCount).toBe(0);
    expect(computeOutcomeDistribution([]).expectancyNetR).toBeNull();
    expect(netRFromGross(1.2, 100, 5, 5)).toBeCloseTo(1.1);
    expect(netRFromGross(null, 100, 0, 0)).toBeNull();
  });

  it('Risk / Portfolio / Policy identical with measurement helpers present (isolation)', () => {
    const analysis = baseAnalysis('TCS');
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const risk = evaluateRisk(riskInput);
    expect(evaluateRisk(riskInput)).toEqual(risk);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const portfolio = evaluatePortfolio({ decision, risk, portfolio: port });
    expect(evaluatePortfolio({ decision, risk, portfolio: port })).toEqual(portfolio);
    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk,
      portfolio,
    };
    expect(applyDecisionPolicy(policyInput)).toEqual(applyDecisionPolicy(policyInput));
  });
});
