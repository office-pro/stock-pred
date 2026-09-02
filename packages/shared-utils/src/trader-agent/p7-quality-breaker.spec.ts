import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
} from '@stockpred/shared-types';
import {
  buildP7QualityMetrics,
  evaluateP7QualityBreaker,
  extractP7QualityBandSamples,
  resolveDecisionQualityScore,
  runP7QualityBreaker,
} from './p7-quality-breaker';

const BASE_TS = 1_700_000_000_000;
const NOW = BASE_TS + 60_000;

function decision(
  overrides: Partial<DecisionLedgerEntry> & { decisionId: string },
): DecisionLedgerEntry {
  return {
    timestamp: BASE_TS,
    symbol: 'INFY',
    direction: 'BUY',
    operatingMode: 'PAPER',
    decisionMode: 'AUTONOMOUS',
    state: 'EXECUTED',
    analysisSnapshot: {
      score: 82,
      confidence: 70,
      scores: {
        fundamental: null,
        technical: 82,
        sentiment: null,
        quant: null,
        macro: null,
        sector: null,
        risk: null,
        overall: 82,
      },
      regime: 'RISK_ON',
      thesis: 'test',
      strategy: 'BREAKOUT',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
    },
    riskVerdict: {
      allowed: true,
      riskScore: 1,
      quantity: 5,
      riskAmount: 250,
      stopLoss: 1400,
      maxLoss: 250,
      riskReward: 2,
      reasonCodes: [],
      reasons: [],
    },
    portfolioVerdict: {
      allowed: true,
      openPositions: 0,
      cash: 1_000_000,
      requiredCapital: 20_000,
      nameExposurePct: 2,
      sectorExposurePct: null,
      reasonCodes: [],
      reasons: [],
    },
    decision: 'AUTO_ACCEPT',
    reasonCodes: [],
    decisionReasons: [],
    ...overrides,
  };
}

function outcome(
  overrides: Partial<DecisionOutcomeRecord> & { outcomeId: string; decisionId: string },
): DecisionOutcomeRecord {
  return {
    kind: 'OUTCOME_RECORDED',
    timestamp: BASE_TS,
    exitPrice: 1550,
    pnl: 250,
    pnlPercent: 3.3,
    holdingPeriodMs: 3_600_000,
    exitReason: 'TARGET',
    closedAt: BASE_TS,
    realizedR: 1,
    outcomeKind: 'ACTUAL',
    ...overrides,
  };
}

function soakHistRecords(
  count: number,
  avgR: number,
  soakRunId = 'SOAK-1',
): DecisionLedgerRecord[] {
  const rows: DecisionLedgerRecord[] = [];
  for (let i = 0; i < count; i++) {
    const id = `hist-${i}`;
    rows.push(
      decision({
        decisionId: id,
        soakRunId,
        intelligenceSnapshot: {
          tradeQuality: { overallScore: 85 },
        } as DecisionLedgerEntry['intelligenceSnapshot'],
      }),
      outcome({
        outcomeId: `o-${id}`,
        decisionId: id,
        soakRunId,
        closedAt: BASE_TS - 86_400_000 - i,
        netR: avgR,
        realizedR: avgR,
      }),
    );
  }
  return rows;
}

function liveRecords(count: number, netR: number): DecisionLedgerRecord[] {
  const rows: DecisionLedgerRecord[] = [];
  for (let i = 0; i < count; i++) {
    const id = `live-${i}`;
    rows.push(
      decision({
        decisionId: id,
        intelligenceSnapshot: {
          tradeQuality: { overallScore: 85 },
        } as DecisionLedgerEntry['intelligenceSnapshot'],
      }),
      outcome({
        outcomeId: `o-${id}`,
        decisionId: id,
        closedAt: BASE_TS - i * 1000,
        netR,
        realizedR: netR,
      }),
    );
  }
  return rows;
}

describe('p7-quality-breaker (P7.1)', () => {
  it('prefers tradeQuality.overallScore over analysisSnapshot.score', () => {
    const d = decision({
      decisionId: 'q1',
      analysisSnapshot: {
        ...decision({ decisionId: 'x' }).analysisSnapshot,
        score: 70,
      },
      intelligenceSnapshot: {
        tradeQuality: { overallScore: 88 },
      } as DecisionLedgerEntry['intelligenceSnapshot'],
    });
    expect(resolveDecisionQualityScore(d)).toBe(88);
  });

  it('extracts only ACTUAL outcomes in quality band', () => {
    const records: DecisionLedgerRecord[] = [
      decision({
        decisionId: 'a',
        analysisSnapshot: { ...decision({ decisionId: 'x' }).analysisSnapshot, score: 75 },
      }),
      outcome({ outcomeId: 'oa', decisionId: 'a', netR: 1 }),
      decision({ decisionId: 'b' }),
      outcome({ outcomeId: 'ob', decisionId: 'b', outcomeKind: 'COUNTERFACTUAL', netR: -1 }),
      decision({ decisionId: 'c' }),
      outcome({ outcomeId: 'oc', decisionId: 'c', netR: 0.5 }),
    ];
    const samples = extractP7QualityBandSamples(records, 80);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.decisionId).toBe('c');
  });

  it('returns INSUFFICIENT when live sample floor unmet', () => {
    const records = [...soakHistRecords(10, 0.6), ...liveRecords(5, 0.2)];
    const result = runP7QualityBreaker({
      records,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('INSUFFICIENT');
  });

  it('returns CLEAR when healthy live avgR', () => {
    const records = [...soakHistRecords(10, 0.6), ...liveRecords(10, 0.3)];
    const result = runP7QualityBreaker({
      records,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('CLEAR');
    expect(result.metrics.qualityLiveAvgR).toBeCloseTo(0.3);
  });

  it('returns STOP when live avgR <= 0 with strong hist precondition', () => {
    const records = [...soakHistRecords(10, 0.6), ...liveRecords(10, -0.05)];
    const result = runP7QualityBreaker({
      records,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('STOP');
  });

  it('boundary: live = 0 → STOP only', () => {
    const metrics = buildP7QualityMetrics({
      records: [...soakHistRecords(10, 0.6), ...liveRecords(10, 0)],
      floors: { minQualityBandSamples: 8 },
    });
    const result = evaluateP7QualityBreaker({
      metrics,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('STOP');
  });

  it('boundary: live = -0.1 → STOP only (not inside warn band)', () => {
    const metrics = buildP7QualityMetrics({
      records: [...soakHistRecords(10, 0.6), ...liveRecords(10, -0.1)],
      floors: { minQualityBandSamples: 8 },
    });
    const result = evaluateP7QualityBreaker({
      metrics,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('STOP');
  });

  it('boundary: live = -0.05 → STOP (precedence over DEGRADED)', () => {
    const metrics = buildP7QualityMetrics({
      records: [...soakHistRecords(10, 0.6), ...liveRecords(10, -0.05)],
      floors: { minQualityBandSamples: 8 },
    });
    const result = evaluateP7QualityBreaker({
      metrics,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('STOP');
  });

  it('does not trip when hist edge is weak', () => {
    const records = [...soakHistRecords(10, 0.1), ...liveRecords(10, -0.2)];
    const result = runP7QualityBreaker({
      records,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('CLEAR');
  });

  it('returns UNKNOWN when live evidence is stale', () => {
    const records = [...soakHistRecords(10, 0.6), ...liveRecords(10, 0.2)];
    const result = runP7QualityBreaker({
      records,
      floors: { minQualityBandSamples: 8 },
      now: BASE_TS + 8 * 24 * 60 * 60 * 1000,
      config: { maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000 },
    });
    expect(result.subState).toBe('UNKNOWN');
  });

  it('recovers to CLEAR after consecutive positive live evaluations', () => {
    const metrics = buildP7QualityMetrics({
      records: [...soakHistRecords(10, 0.6), ...liveRecords(10, 0.2)],
      floors: { minQualityBandSamples: 8 },
    });
    const stopped = evaluateP7QualityBreaker({
      metrics: { ...metrics, qualityLiveAvgR: -0.05 },
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(stopped.subState).toBe('STOP');

    const recovering = evaluateP7QualityBreaker({
      metrics: { ...metrics, qualityLiveAvgR: 0.2 },
      floors: { minQualityBandSamples: 8 },
      recovery: { consecutiveClearEvaluations: 2 },
      now: NOW,
    });
    expect(recovering.subState).toBe('CLEAR');
  });

  it('uses walk-forward hist when soak hist absent', () => {
    const records = liveRecords(10, 0.2);
    const metrics = buildP7QualityMetrics({
      records,
      walkForwardHistAvgR: 0.55,
      floors: { minQualityBandSamples: 8 },
    });
    expect(metrics.qualityHistAvgR).toBeCloseTo(0.55);
    const result = evaluateP7QualityBreaker({
      metrics,
      floors: { minQualityBandSamples: 8 },
      now: NOW,
    });
    expect(result.subState).toBe('CLEAR');
  });
});
