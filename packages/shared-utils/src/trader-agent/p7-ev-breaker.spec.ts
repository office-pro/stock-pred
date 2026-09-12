import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
} from '@stockpred/shared-types';
import { buildP7EvMetrics, evaluateP7EvBreaker, runP7EvBreaker } from './p7-ev-breaker';

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
    intelligenceSnapshot: {
      expectedValue: { expectedValueR: 0.5 },
    } as DecisionLedgerEntry['intelligenceSnapshot'],
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

function soakHist(count: number, netR: number): DecisionLedgerRecord[] {
  const rows: DecisionLedgerRecord[] = [];
  for (let i = 0; i < count; i++) {
    const id = `h-${i}`;
    rows.push(
      decision({ decisionId: id, soakRunId: 'SOAK-1' }),
      outcome({
        outcomeId: `o-${id}`,
        decisionId: id,
        soakRunId: 'SOAK-1',
        netR,
        closedAt: BASE_TS - 86_400_000 - i,
      }),
    );
  }
  return rows;
}

function liveRows(count: number, netR: number): DecisionLedgerRecord[] {
  const rows: DecisionLedgerRecord[] = [];
  for (let i = 0; i < count; i++) {
    const id = `l-${i}`;
    rows.push(
      decision({ decisionId: id }),
      outcome({ outcomeId: `o-${id}`, decisionId: id, netR, closedAt: BASE_TS - i * 1000 }),
    );
  }
  return rows;
}

describe('p7-ev-breaker (P7.2)', () => {
  it('returns INSUFFICIENT when sample floor unmet', () => {
    const result = runP7EvBreaker({
      records: [...soakHist(10, 0.8), ...liveRows(5, 0.2)],
      now: NOW,
    });
    expect(result.subState).toBe('INSUFFICIENT');
  });

  it('returns CLEAR when deterioration below warn', () => {
    const result = runP7EvBreaker({
      records: [...soakHist(10, 0.8), ...liveRows(12, 0.7)],
      now: NOW,
    });
    expect(result.subState).toBe('CLEAR');
  });

  it('returns STOP when deterioration exceeds trip', () => {
    const result = runP7EvBreaker({
      records: [...soakHist(10, 0.8), ...liveRows(12, 0.1)],
      now: NOW,
    });
    expect(result.subState).toBe('STOP');
  });

  it('boundary: deterioration at trip threshold', () => {
    const metrics = buildP7EvMetrics({ records: [...soakHist(10, 0.8), ...liveRows(12, 0.3)] });
    expect(metrics.deterioration).toBeCloseTo(0.5);
    const result = evaluateP7EvBreaker({ metrics, now: NOW });
    expect(result.subState).toBe('STOP');
  });
});
