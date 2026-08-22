import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
} from '@stockpred/shared-types';
import {
  compareWalkForwardToSoak,
  computeSoakCalibration,
  computeSoakOpsMetrics,
  filterLedgerForSoak,
} from './soak-metrics';

function decision(
  overrides: Partial<DecisionLedgerEntry> & { decisionId: string },
): DecisionLedgerEntry {
  return {
    timestamp: Date.now(),
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
    execution: {
      quantity: 5,
      entryPrice: 1500,
      status: 'EXECUTED',
      plannedRiskAmount: 250,
    },
    ...overrides,
  };
}

function outcome(
  overrides: Partial<DecisionOutcomeRecord> & { outcomeId: string; decisionId: string },
): DecisionOutcomeRecord {
  return {
    kind: 'OUTCOME_RECORDED',
    timestamp: Date.now(),
    exitPrice: 1550,
    pnl: 250,
    pnlPercent: 3.3,
    holdingPeriodMs: 3_600_000,
    exitReason: 'TARGET',
    closedAt: Date.now(),
    realizedR: 1,
    ...overrides,
  };
}

describe('soak-metrics (P4)', () => {
  it('isolates metrics by soakRunId (prior ledger ignored)', () => {
    const records: DecisionLedgerRecord[] = [
      decision({ decisionId: 'old', soakRunId: 'SOAK-OLD' }),
      outcome({
        outcomeId: 'o-old',
        decisionId: 'old',
        soakRunId: 'SOAK-OLD',
        realizedR: -2,
        pnl: -500,
      }),
      decision({ decisionId: 'new', soakRunId: 'SOAK-NEW' }),
      outcome({
        outcomeId: 'o-new',
        decisionId: 'new',
        soakRunId: 'SOAK-NEW',
        realizedR: 1.5,
        pnl: 375,
      }),
    ];
    expect(filterLedgerForSoak(records, 'SOAK-NEW')).toHaveLength(2);
    const ops = computeSoakOpsMetrics(records, 'SOAK-NEW');
    expect(ops.candidates).toBe(1);
    expect(ops.accepted).toBe(1);
    expect(ops.avgR).toBe(1.5);
    expect(ops.autoGrossPnl).toBe(375);
  });

  it('calibration bands match fixture hit rates', () => {
    const records: DecisionLedgerRecord[] = [
      decision({ decisionId: 'a', soakRunId: 'S1' }),
      outcome({
        outcomeId: 'oa',
        decisionId: 'a',
        soakRunId: 'S1',
        pnl: 100,
        realizedR: 1,
      }),
      decision({
        decisionId: 'b',
        soakRunId: 'S1',
        analysisSnapshot: {
          score: 85,
          confidence: 60,
          scores: {
            fundamental: null,
            technical: 85,
            sentiment: null,
            quant: null,
            macro: null,
            sector: null,
            risk: null,
            overall: 85,
          },
          regime: 'RISK_ON',
          thesis: 't',
          strategy: 'BREAKOUT',
          eligibility: 'AUTONOMOUS_ELIGIBLE',
        },
      }),
      outcome({
        outcomeId: 'ob',
        decisionId: 'b',
        soakRunId: 'S1',
        pnl: -50,
        realizedR: -0.5,
      }),
    ];
    const cal = computeSoakCalibration(records, 'S1');
    const band = cal.byScore.find((r) => r.band === '80-89');
    expect(band?.n).toBe(2);
    expect(band?.hitRate).toBe(0.5);
    expect(cal.disclaimer.toLowerCase()).toContain('confidence');
  });

  it('compareWalkForwardToSoak computes deltas', () => {
    const soak = computeSoakOpsMetrics(
      [
        decision({ decisionId: 'd1', soakRunId: 'S1' }),
        outcome({
          outcomeId: 'o1',
          decisionId: 'd1',
          soakRunId: 'S1',
          realizedR: 1,
          holdingPeriodMs: 2_000,
        }),
      ],
      'S1',
      { startedAt: Date.now() - 24 * 60 * 60 * 1000, now: Date.now() },
    );
    const rows = compareWalkForwardToSoak({
      walkForward: {
        autoAcceptRate: 0.5,
        winRate: 0.4,
        avgR: 0.8,
        maxDrawdownPct: 0.05,
        avgHoldMs: 1_000,
      },
      soak,
      soakWinRate: 1,
      soakMaxDd: 0.02,
    });
    expect(rows.find((r) => r.metric === 'Avg R')?.delta).toBeCloseTo(0.2);
    expect(rows.find((r) => r.metric === 'Win rate')?.paperSoak).toBe(1);
  });
});
