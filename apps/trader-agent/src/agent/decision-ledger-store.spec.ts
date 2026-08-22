import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DecisionLedgerEntry } from '@stockpred/shared-types';
import { DecisionLedgerStore } from './decision-ledger-store';

function minimalDecision(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  return {
    decisionId: 'dec-1',
    timestamp: Date.now(),
    symbol: 'TCS',
    direction: 'BUY',
    operatingMode: 'PAPER',
    decisionMode: 'AUTONOMOUS',
    state: 'EXECUTED',
    analysisSnapshot: {
      score: 80,
      confidence: 80,
      scores: {
        fundamental: null,
        technical: 80,
        sentiment: null,
        quant: null,
        macro: null,
        sector: null,
        risk: null,
        overall: 80,
      },
      regime: 'RISK_ON',
      thesis: 'test',
      strategy: 'BREAKOUT',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
    },
    riskVerdict: {
      allowed: true,
      riskScore: 1,
      quantity: 10,
      riskAmount: 500,
      stopLoss: 3800,
      maxLoss: 500,
      riskReward: 2,
      reasonCodes: [],
      reasons: [],
    },
    portfolioVerdict: {
      allowed: true,
      openPositions: 0,
      cash: 1_000_000,
      requiredCapital: 40_000,
      nameExposurePct: 0,
      sectorExposurePct: null,
      reasonCodes: [],
      reasons: [],
    },
    decision: 'AUTO_ACCEPT',
    reasonCodes: [],
    decisionReasons: [],
    execution: {
      quantity: 10,
      entryPrice: 3900,
      orderId: 'ord-1',
      status: 'EXECUTED',
      plannedRiskAmount: 500,
    },
    ...overrides,
  };
}

describe('DecisionLedgerStore outcomes (P4)', () => {
  let dir: string;
  let store: DecisionLedgerStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    store = new DecisionLedgerStore(join(dir, 'ledger.json'), 100);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends outcomes without mutating the original decision row', () => {
    store.append(minimalDecision());
    const before = JSON.stringify(
      store
        .listRaw()
        .find((r) => !('kind' in r && (r as { kind?: string }).kind === 'OUTCOME_RECORDED')),
    );
    store.appendOutcome({
      outcomeId: 'out-1',
      decisionId: 'dec-1',
      tradeId: 'ord-1',
      exitPrice: 4000,
      pnl: 1000,
      pnlPercent: 2.5,
      holdingPeriodMs: 86_400_000,
      exitReason: 'TARGET',
      closedAt: Date.now(),
      realizedR: 2,
      plannedRiskAmount: 500,
    });
    const raw = store.listRaw();
    const decisionRow = raw.find(
      (r) => !('kind' in r && (r as { kind?: string }).kind === 'OUTCOME_RECORDED'),
    );
    expect(JSON.stringify(decisionRow)).toBe(before);
    const view = store.get('dec-1');
    expect(view?.outcome?.realizedR).toBe(2);
    expect(view?.outcome?.pnl).toBe(1000);
  });

  it('is idempotent on tradeId / decisionId', () => {
    store.append(minimalDecision());
    const first = store.appendOutcome({
      outcomeId: 'out-1',
      decisionId: 'dec-1',
      tradeId: 'ord-1',
      exitPrice: 4000,
      pnl: 1000,
      pnlPercent: 2.5,
      holdingPeriodMs: 1,
      exitReason: 'TARGET',
      closedAt: Date.now(),
      realizedR: 2,
      plannedRiskAmount: 500,
    });
    const second = store.appendOutcome({
      outcomeId: 'out-2',
      decisionId: 'dec-1',
      tradeId: 'ord-1',
      exitPrice: 4100,
      pnl: 2000,
      pnlPercent: 5,
      holdingPeriodMs: 2,
      exitReason: 'TARGET',
      closedAt: Date.now(),
      realizedR: 4,
      plannedRiskAmount: 500,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.recorded.outcomeId).toBe('out-1');
    const outcomes = store
      .listRaw()
      .filter((r) => 'kind' in r && (r as { kind?: string }).kind === 'OUTCOME_RECORDED');
    expect(outcomes).toHaveLength(1);
  });
});
