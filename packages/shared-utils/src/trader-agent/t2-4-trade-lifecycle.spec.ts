/**
 * T2.4 Trade Lifecycle Intelligence crown tests.
 */
import type {
  AgentAnalysis,
  DecisionLedgerEntry,
  DecisionOutcomeRecord,
  ThesisHistoryLedgerRecord,
  TradeLifecycleEvent,
} from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  buildExitRecommendation,
  buildLifecycleTimeline,
  computeLifecycleMetrics,
  deriveLifecycleStage,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  materializeTradeLifecycle,
  verifyTradeLifecycleIsolation,
} from './index';

const NOW = 1_700_000_000_000;

function baseDecision(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  return {
    decisionId: 'dec-t24-1',
    opportunityId: 'opp-1',
    timestamp: NOW,
    symbol: 'TCS',
    direction: 'BUY',
    operatingMode: 'PAPER',
    decisionMode: 'APPROVAL',
    state: 'APPROVED',
    analysisSnapshot: {
      score: 78,
      confidence: 80,
      scores: {
        fundamental: 70,
        technical: 80,
        sentiment: 60,
        quant: 65,
        macro: 55,
        sector: 60,
        risk: 70,
        overall: 78,
      },
      regime: 'RISK_ON',
      thesis: 'Breakout',
      strategy: 'MOMENTUM',
      eligibility: 'HUMAN_ONLY',
    },
    riskVerdict: { allowed: true, reasons: [], reasonCodes: [] },
    portfolioVerdict: { allowed: true, reasons: [], reasonCodes: [] },
    decision: 'APPROVED',
    reasonCodes: [],
    decisionReasons: [],
    ...overrides,
  } as DecisionLedgerEntry;
}

function thesisEvent(
  type: ThesisHistoryLedgerRecord['event']['type'],
  at = NOW + 60_000,
): ThesisHistoryLedgerRecord {
  return {
    kind: 'THESIS_EVENT',
    decisionId: 'dec-t24-1',
    timestamp: at,
    event: {
      type,
      at: new Date(at).toISOString(),
      newState: type === 'THESIS_INVALIDATED' ? 'INVALIDATED' : 'WEAKENING',
      changes: ['test'],
    },
  };
}

describe('T2.4 Trade Lifecycle', () => {
  it('crown A — Risk / Portfolio / Policy unchanged when lifecycle materialized', () => {
    const analysis = {
      symbol: 'TCS',
      currentPrice: 3520,
      decision: 'BUY',
      scores: {
        fundamental: 70,
        technical: 80,
        sentiment: 60,
        quant: 65,
        macro: 55,
        sector: 60,
        risk: 70,
        overall: 78,
      },
      setup: {
        instrument: 'TCS',
        direction: 'LONG',
        entry: 3500,
        stopLoss: 3400,
        target1: 3700,
        target2: null,
        target3: null,
        riskReward: 2,
        positionSize: 10,
        expectedHoldingPeriod: '1-5d',
        confidence: 78,
        invalidation: 'Close below stop',
      },
      marketRegime: 'RISK_ON',
      thesis: 'Breakout',
      counterThesis: '',
      invalidation: '',
      risks: [],
      action: '',
      usedCapabilities: [],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: NOW,
      disclaimer: 'test',
    } as AgentAnalysis;

    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const portA = evaluatePortfolio({ decision, risk: riskA, portfolio: portfolioSnap });
    const policyA = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'APPROVAL',
      eligibility: decision.eligibility,
      risk: riskA,
      portfolio: portA,
    });

    materializeTradeLifecycle({
      now: NOW,
      decision: baseDecision(),
      thesisEvents: [thesisEvent('THESIS_CREATED')],
    });

    const riskB = evaluateRisk(riskInput);
    const portB = evaluatePortfolio({ decision, risk: riskB, portfolio: portfolioSnap });
    const policyB = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'APPROVAL',
      eligibility: decision.eligibility,
      risk: riskB,
      portfolio: portB,
    });

    expect(riskB).toEqual(riskA);
    expect(portB).toEqual(portA);
    expect(policyB).toEqual(policyA);
  });

  it('crown B — derive-only: no fabricated MANAGEMENT timeline events', () => {
    const decision = baseDecision({
      execution: { quantity: 10, entryPrice: 3500 },
      state: 'EXECUTED',
      decision: 'EXECUTED',
    });
    const events = buildLifecycleTimeline({
      now: NOW + 600_000,
      decision,
      exitAdvisory: null,
    });
    expect(events.some((e) => e.kind === 'STAGE' && e.stage === 'MANAGEMENT')).toBe(false);
    expect(deriveLifecycleStage({ decision })).toBe('MANAGEMENT');
  });

  it('crown C — P5 separation: realizedR from ACTUAL only', () => {
    const decision = baseDecision({
      execution: { quantity: 10, entryPrice: 3500, plannedRiskAmount: 1000 },
      outcome: {
        outcomeId: 'out-cf',
        decisionId: 'dec-t24-1',
        exitPrice: 3600,
        pnl: 1000,
        pnlPercent: 2.8,
        holdingPeriodMs: 86_400_000,
        exitReason: 'COUNTERFACTUAL',
        closedAt: NOW + 86_400_000,
        realizedR: 2.5,
        outcomeKind: 'COUNTERFACTUAL',
      },
    });
    const metrics = computeLifecycleMetrics({
      now: NOW,
      decision,
      outcomeRecords: [
        {
          kind: 'OUTCOME_RECORDED',
          outcomeId: 'out-cf',
          decisionId: 'dec-t24-1',
          timestamp: NOW + 86_400_000,
          exitPrice: 3600,
          pnl: 1000,
          pnlPercent: 2.8,
          holdingPeriodMs: 86_400_000,
          exitReason: 'COUNTERFACTUAL',
          closedAt: NOW + 86_400_000,
          realizedR: 2.5,
          outcomeKind: 'COUNTERFACTUAL',
        } satisfies DecisionOutcomeRecord,
      ],
    });
    expect(metrics.realizedR).toBeNull();
    expect(metrics.executionDrag).toBeNull();
    expect(
      deriveLifecycleStage({
        decision,
        outcomeRecords: [
          {
            kind: 'OUTCOME_RECORDED',
            outcomeId: 'out-cf',
            decisionId: 'dec-t24-1',
            timestamp: NOW + 86_400_000,
            exitPrice: 3600,
            pnl: 1000,
            pnlPercent: 2.8,
            holdingPeriodMs: 86_400_000,
            exitReason: 'COUNTERFACTUAL',
            closedAt: NOW + 86_400_000,
            realizedR: 2.5,
            outcomeKind: 'COUNTERFACTUAL',
          },
        ],
      }),
    ).toBe('MANAGEMENT');

    const actualDecision = baseDecision({
      execution: { quantity: 10, entryPrice: 3500, plannedRiskAmount: 1000 },
      outcome: {
        outcomeId: 'out-act',
        decisionId: 'dec-t24-1',
        exitPrice: 3600,
        pnl: 1000,
        pnlPercent: 2.8,
        holdingPeriodMs: 86_400_000,
        exitReason: 'TARGET',
        closedAt: NOW + 86_400_000,
        realizedR: 1.2,
        outcomeKind: 'ACTUAL',
        grossR: 1.4,
        netR: 1.2,
      },
    });
    const actualMetrics = computeLifecycleMetrics({ now: NOW, decision: actualDecision });
    expect(actualMetrics.realizedR).toBe(1.2);
    expect(actualMetrics.executionDrag).toBeCloseTo(0.2);
  });

  it('crown D — missing data yields UNKNOWN / null metrics', () => {
    const sparse = baseDecision({
      analysisSnapshot: undefined as unknown as DecisionLedgerEntry['analysisSnapshot'],
      state: 'UNKNOWN' as DecisionLedgerEntry['state'],
      decision: 'BLOCKED',
    });
    const snapshot = materializeTradeLifecycle({ now: NOW, decision: sparse });
    expect(snapshot.currentStage).toBe('UNKNOWN');
    expect(snapshot.metrics.realizedR).toBeNull();
    expect(snapshot.metrics.waitDurationMs).toBeNull();
  });

  it('crown E — thesisEventCount vs thesisEvolutionCount', () => {
    const events = [
      thesisEvent('THESIS_CREATED', NOW),
      thesisEvent('THESIS_WEAKENED', NOW + 30_000),
      thesisEvent('THESIS_INVALIDATED', NOW + 60_000),
    ];
    const metrics = computeLifecycleMetrics({
      now: NOW,
      decision: baseDecision(),
      thesisEvents: events,
    });
    expect(metrics.thesisEventCount).toBe(3);
    expect(metrics.thesisEvolutionCount).toBe(2);
  });

  it('crown F — planned vs observed wait duration', () => {
    const waitDecision = baseDecision({
      decision: 'WAIT',
      state: 'WAITING',
      waitIntelligence: {
        decision: 'WAIT',
        reasonCodes: ['SETUP_NOT_READY'],
        summary: 'Wait for pullback',
        expiryAt: NOW + 1_800_000,
        invalidation: { conditions: [], reasonCodes: [] },
        reevaluateWhen: { trigger: 'TIME', timeAt: NOW + 1_800_000 },
      },
    });
    const withExpiryOnly = computeLifecycleMetrics({
      now: NOW,
      decision: waitDecision,
      waitContext: { waitStartMs: NOW, waitExpiresAtMs: NOW + 1_800_000, waitEndMs: null },
    });
    expect(withExpiryOnly.plannedWaitDurationMs).toBe(1_800_000);
    expect(withExpiryOnly.waitDurationMs).toBeNull();

    const withObserved = computeLifecycleMetrics({
      now: NOW,
      decision: waitDecision,
      waitContext: {
        waitStartMs: NOW,
        waitExpiresAtMs: NOW + 1_800_000,
        waitEndMs: NOW + 720_000,
      },
    });
    expect(withObserved.waitDurationMs).toBe(720_000);
    expect(withObserved.plannedWaitDurationMs).toBe(1_800_000);
  });

  it('crown G — no auth path on snapshot', () => {
    const snapshot = materializeTradeLifecycle({ now: NOW, decision: baseDecision() });
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(/execute|submit|close/i);
    const guard = verifyTradeLifecycleIsolation();
    expect(guard.ok).toBe(true);
    expect(guard.forbidden).toContain('exit-policy');
    expect(guard.forbidden).toContain('risk-engine');
  });

  it('crown H — pure functions only (no scheduler surface)', () => {
    expect(typeof materializeTradeLifecycle).toBe('function');
    expect(typeof deriveLifecycleStage).toBe('function');
    expect(verifyTradeLifecycleIsolation().ok).toBe(true);
  });

  it('crown I — T2.3 advisory EXIT is CONTEXT only; stage stays MANAGEMENT', () => {
    const decision = baseDecision({
      execution: { quantity: 10, entryPrice: 3500 },
      state: 'EXECUTED',
      decision: 'EXECUTED',
    });
    const exitAdvisory = buildExitRecommendation({
      now: NOW,
      position: {
        symbol: 'TCS',
        entryPrice: 3500,
        currentPrice: 3400,
        stopLoss: 3350,
        target: 3700,
        quantity: 10,
        openedAt: NOW - 86_400_000,
      },
      thesis: {
        symbol: 'TCS',
        side: 'LONG',
        setup: 'Breakout',
        primaryThesis: 'Invalidated',
        supportingEvidence: [],
        invalidationConditions: [],
        state: 'INVALIDATED',
        provenance: {
          engineVersion: 'thesis-intelligence.v1',
          generatedAt: new Date(NOW).toISOString(),
          sourceDataTimestamp: new Date(NOW).toISOString(),
        },
      },
    });
    expect(exitAdvisory.action).toBe('EXIT');

    const snapshot = materializeTradeLifecycle({
      now: NOW,
      decision,
      exitAdvisory,
    });
    expect(snapshot.currentStage).toBe('MANAGEMENT');
    const exitContext = snapshot.events.find(
      (e: TradeLifecycleEvent) => e.kind === 'CONTEXT' && e.detail?.includes('Exit advisory: EXIT'),
    );
    expect(exitContext).toBeDefined();
    expect(
      snapshot.events.some((e: TradeLifecycleEvent) => e.kind === 'STAGE' && e.stage === 'EXIT'),
    ).toBe(false);
  });
});
