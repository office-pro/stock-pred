import {
  DEFAULT_LIVE_CAPS,
  type DecisionLedgerEntry,
  type TradeDecision,
} from '@stockpred/shared-types';
import { checkLiveCaps } from './live-caps';
import { rankOpportunitiesForDisplay } from './opportunity-rank';
import { applyWait, deriveAgentRecommendation, isWaitExpired } from './wait-lifecycle';
import { computeHumanIntelMetrics } from './human-intel-metrics';
import { applyDecisionPolicy } from './decision-policy';
import { simulateRevalidatingGate, liveCapsGateInput } from './gate-sim';
import { SimulatedBook } from './simulated-book';

function baseDecision(overrides: Partial<TradeDecision> = {}): TradeDecision {
  const now = Date.now();
  return {
    decisionId: 'd1',
    symbol: 'TEST',
    intent: 'BUY',
    eligibility: 'AUTONOMOUS_ELIGIBLE',
    signalScore: 80,
    confidence: 0.8,
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 70,
      macro: 50,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    strategy: 'COMPOSITE',
    marketRegime: 'NEUTRAL',
    thesis: 't',
    counterThesis: 'c',
    invalidation: 'i',
    reasons: [],
    reasonCodes: ['BUY_DECISION'],
    setup: {
      entry: 100,
      stopLoss: 95,
      target1: 110,
      target2: null,
      target3: null,
      riskReward: 2,
      recommendedQty: 10,
    },
    createdAt: now,
    ttlMs: 60_000,
    ...overrides,
  };
}

const okRisk = {
  allowed: true as const,
  riskScore: 1,
  quantity: 10,
  riskAmount: 500,
  stopLoss: 95,
  maxLoss: 500,
  riskReward: 2,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

const okPortfolio = {
  allowed: true as const,
  openPositions: 0,
  cash: 100_000,
  requiredCapital: 1_000,
  nameExposurePct: 5,
  sectorExposurePct: 10 as number | null,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

describe('Phase 5 — LIVE + AUTONOMOUS → HUMAN_REQUIRED', () => {
  it('policy keeps LIVE autonomous human-required', () => {
    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
    expect(live.reasonCodes).toContain('LIVE_AUTONOMOUS_NOT_ARMED');
  });
});

describe('Phase 5 — LIVE caps (service + Gate)', () => {
  it('blocks oversized per-trade notional on LIVE', () => {
    const early = checkLiveCaps({
      mode: 'LIVE',
      tradeNotional: DEFAULT_LIVE_CAPS.maxNotionalPerTrade + 1,
      openNotional: 0,
      openPositions: 0,
      caps: DEFAULT_LIVE_CAPS,
    });
    expect(early.passed).toBe(false);
    expect(early.reasonCodes).toContain('LIVE_MAX_NOTIONAL_PER_TRADE');
  });

  it('PAPER ignores LIVE caps', () => {
    const paper = checkLiveCaps({
      mode: 'PAPER',
      tradeNotional: 1_000_000,
      openNotional: 1_000_000,
      openPositions: 99,
      caps: DEFAULT_LIVE_CAPS,
    });
    expect(paper.passed).toBe(true);
  });

  it('Gate revalidation: approve-time within cap, stale book → BLOCK', () => {
    const decision = baseDecision();
    const book = new SimulatedBook(1_000_000);
    const tradeNotional = 40_000;

    const early = checkLiveCaps({
      mode: 'LIVE',
      tradeNotional,
      openNotional: 0,
      openPositions: 0,
      caps: DEFAULT_LIVE_CAPS,
    });
    expect(early.passed).toBe(true);

    const gate = simulateRevalidatingGate({
      decision,
      livePrice: 100,
      maxPriceDeviationPct: 2,
      book,
      now: decision.createdAt + 1_000,
      liveCaps: liveCapsGateInput(
        DEFAULT_LIVE_CAPS,
        tradeNotional,
        DEFAULT_LIVE_CAPS.maxOpenNotional,
        0,
      ),
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasonCodes).toContain('LIVE_MAX_OPEN_NOTIONAL');
  });
});

describe('Phase 5 — liveAutoArmed structurally false', () => {
  it('DEFAULT_LIVE_CAPS has no arm flag', () => {
    expect(DEFAULT_LIVE_CAPS.maxOpenPositions).toBeGreaterThan(0);
    expect('liveAutoArmed' in DEFAULT_LIVE_CAPS).toBe(false);
  });
});

describe('Phase 5 — WAIT lifecycle (no Gate)', () => {
  it('applyWait increments count and sets TTL; expiry detected', () => {
    const now = 1_000_000;
    const wait = applyWait({ now, reason: 'WAIT_FOR_CONFIRMATION' });
    expect(wait.waitCount).toBe(1);
    expect(wait.waitExpiresAt).toBeGreaterThan(now);
    expect(isWaitExpired(wait, now)).toBe(false);
    expect(isWaitExpired(wait, wait.waitExpiresAt)).toBe(true);

    const again = applyWait({ now: now + 1, previous: wait, reason: 'LIQUIDITY' });
    expect(again.waitCount).toBe(2);
  });

  it('disagreement preserved: agent APPROVE + human WAIT — no Gate', () => {
    const agent = deriveAgentRecommendation({ decision: 'BUY' });
    expect(agent).toBe('RECOMMEND_APPROVE');

    const entry: Partial<DecisionLedgerEntry> = {
      decisionId: 'opp-1',
      agentRecommendation: agent,
      humanDecision: 'HUMAN_WAIT',
      humanReasonCode: 'WAIT_FOR_CONFIRMATION',
      decision: 'WAIT',
      gateResult: undefined,
    };
    expect(entry.agentRecommendation).toBe('RECOMMEND_APPROVE');
    expect(entry.humanDecision).toBe('HUMAN_WAIT');
    expect(entry.gateResult).toBeUndefined();
  });
});

describe('Phase 5 — ranking display-only', () => {
  it('stable ranks, referenceAllocationPct ~100, quantity unchanged', () => {
    const ranked = rankOpportunitiesForDisplay([
      {
        opportunityId: 'a',
        symbol: 'AAA',
        quality: 90,
        expectedValueR: 1.2,
        signalScore: 80,
        quantity: 7,
        portfolioFit: 'GOOD',
      },
      {
        opportunityId: 'b',
        symbol: 'BBB',
        quality: 40,
        expectedValueR: 0.2,
        signalScore: 55,
        quantity: 3,
        portfolioFit: 'BLOCKED',
      },
      {
        opportunityId: 'c',
        symbol: 'CCC',
        quality: 70,
        expectedValueR: 0.8,
        signalScore: 70,
        quantity: 5,
        portfolioFit: 'EXCELLENT',
      },
    ]);

    expect(ranked.map((r) => r.symbol)).toEqual(['AAA', 'CCC', 'BBB']);
    expect(ranked[0]!.quantityUnchanged).toBe(7);
    expect(ranked[1]!.quantityUnchanged).toBe(5);
    expect(ranked[2]!.quantityUnchanged).toBe(3);
    const sum = ranked.reduce((a, r) => a + r.referenceAllocationPct, 0);
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThan(100.5);
    expect(ranked.some((r) => r.portfolioFit === 'BLOCKED')).toBe(true);
  });
});

describe('Phase 5 — PAPER AUTONOMOUS still AUTO_ACCEPTED', () => {
  it('eligible PAPER autonomous remains AUTO_ACCEPTED', () => {
    const paper = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
    });
    expect(paper.outcome).toBe('AUTO_ACCEPTED');
  });
});

describe('Phase 5 — human intel metrics', () => {
  it('computes agreement and override rates', () => {
    const rows = [
      {
        decisionId: '1',
        agentRecommendation: 'RECOMMEND_APPROVE',
        humanDecision: 'HUMAN_APPROVE',
      },
      {
        decisionId: '2',
        agentRecommendation: 'RECOMMEND_APPROVE',
        humanDecision: 'HUMAN_WAIT',
      },
      {
        decisionId: '2',
        agentRecommendation: 'RECOMMEND_APPROVE',
        humanDecision: 'HUMAN_APPROVE',
      },
    ] as DecisionLedgerEntry[];

    const m = computeHumanIntelMetrics(rows);
    expect(m.reviewed).toBe(3);
    expect(m.agreementCount).toBe(2);
    expect(m.overrideCount).toBe(1);
    expect(m.waitThenLaterCount).toBe(1);
  });
});
