import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
} from '@stockpred/shared-types';
import { isRegimeMismatch, runP7RegimeBreaker } from './p7-regime-breaker';

const BASE_TS = 1_700_000_000_000;
const NOW = BASE_TS + 60_000;

function pair(
  id: string,
  opts: {
    decisionRegime?: string;
    outcomeRegime?: string | null;
    compat?: 'FAVORABLE' | 'UNFAVORABLE' | 'UNKNOWN';
    netR: number;
  },
): DecisionLedgerRecord[] {
  const decision: DecisionLedgerEntry = {
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
      thesis: 't',
      strategy: 'B',
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
      cash: 1e6,
      requiredCapital: 20_000,
      nameExposurePct: 2,
      sectorExposurePct: null,
      reasonCodes: [],
      reasons: [],
    },
    decision: 'AUTO_ACCEPT',
    reasonCodes: [],
    decisionReasons: [],
    decisionId: id,
    intelligenceSnapshot: {
      marketContext: { regimeCombo: opts.decisionRegime ?? 'BULL+LOW_VOL' },
      regimeCompatibility: { compatibility: opts.compat ?? 'FAVORABLE' },
    } as DecisionLedgerEntry['intelligenceSnapshot'],
  };
  const out: DecisionOutcomeRecord = {
    kind: 'OUTCOME_RECORDED',
    outcomeId: `o-${id}`,
    decisionId: id,
    timestamp: BASE_TS,
    exitPrice: 1,
    pnl: opts.netR,
    pnlPercent: 1,
    holdingPeriodMs: 1,
    exitReason: 'T',
    closedAt: BASE_TS - 100,
    realizedR: opts.netR,
    netR: opts.netR,
    outcomeKind: 'ACTUAL',
  };
  return [decision, out];
}

describe('p7-regime-breaker (P7.4)', () => {
  it('missing outcome regime never counts as mismatch alone', () => {
    expect(
      isRegimeMismatch({
        decision: pair('x', { netR: 1 })[0] as DecisionLedgerEntry,
        outcomeRegime: null,
        netR: 1,
      }),
    ).toBeNull();
  });

  it('counts UNFAVORABLE + negative netR as mismatch', () => {
    expect(
      isRegimeMismatch({
        decision: pair('x', { compat: 'UNFAVORABLE', netR: -0.5 })[0] as DecisionLedgerEntry,
        outcomeRegime: null,
        netR: -0.5,
      }),
    ).toBe(true);
  });

  it('returns INSUFFICIENT below minRegimeDecisions', () => {
    const records = pair('a', { netR: 1 });
    const result = runP7RegimeBreaker({ records, now: NOW });
    expect(result.subState).toBe('INSUFFICIENT');
  });

  it('returns STOP at high mismatch rate', () => {
    const records: DecisionLedgerRecord[] = [];
    for (let i = 0; i < 16; i++) {
      records.push(
        ...pair(`m${i}`, {
          decisionRegime: 'BULL+LOW_VOL',
          netR: -0.2,
          compat: 'UNFAVORABLE',
        }),
      );
    }
    const result = runP7RegimeBreaker({
      records,
      now: NOW,
      resolveOutcomeRegime: () => 'BEAR+HIGH_VOL',
    });
    expect(result.subState).toBe('STOP');
  });
});
