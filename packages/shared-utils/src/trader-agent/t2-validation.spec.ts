/**
 * T2 Validation Gate — cross-stack integration tests (V-A through V-K).
 */
import type {
  AgentAnalysis,
  DecisionLedgerEntry,
  IntelligenceSnapshot,
  StructuredThesis,
  ThesisHistoryLedgerRecord,
} from '@stockpred/shared-types';
import {
  appendThesisHistory,
  buildExitRecommendation,
  buildIntelligenceSnapshot,
  buildThesisHistoryEvent,
  buildThesisSnapshot,
  buildT2ValidationReport,
  buildWaitRecommendation,
  compareAuthorizationIsolation,
  computeLifecycleMetrics,
  deriveLifecycleStage,
  materializeTradeLifecycle,
  reassessThesis,
  resolveT2ValidationVerdict,
  runBaselineAuthorizationChain,
  verifyT2ValidationIsolation,
} from './index';

const NOW = 1_700_000_000_000;
const DECISION_ID = 'dec-t2-val-1';
const SYMBOL = 'TCS';

function baseAnalysis(overrides: Partial<AgentAnalysis> = {}): AgentAnalysis {
  return {
    symbol: SYMBOL,
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
      instrument: SYMBOL,
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
    thesis: 'Breakout with volume',
    counterThesis: 'Market risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: NOW,
    disclaimer: 'test',
    ...overrides,
  } as AgentAnalysis;
}

function snapshotFor(analysis: AgentAnalysis): IntelligenceSnapshot {
  const decision = runBaselineAuthorizationChain({ analysis }).decision;
  return buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: analysis.generatedAt,
    marketContext: {
      scannerRegime: 'RISK_ON',
      breadthPercentAboveEma50: 0.55,
      asOf: NOW,
    },
  });
}

function thesisWithState(state: StructuredThesis['state']): StructuredThesis {
  return {
    symbol: SYMBOL,
    side: 'LONG',
    setup: 'Breakout',
    primaryThesis: 'Breakout continuation',
    supportingEvidence: [],
    invalidationConditions: [],
    state,
    provenance: {
      engineVersion: 'thesis-intelligence.v1',
      generatedAt: new Date(NOW).toISOString(),
      sourceDataTimestamp: new Date(NOW).toISOString(),
    },
  };
}

function baseLedger(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  return {
    decisionId: DECISION_ID,
    opportunityId: 'opp-t2-val',
    timestamp: NOW,
    symbol: SYMBOL,
    direction: 'BUY',
    operatingMode: 'PAPER',
    decisionMode: 'APPROVAL',
    state: 'EXECUTED',
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
    decision: 'EXECUTED',
    reasonCodes: [],
    decisionReasons: [],
    execution: { quantity: 10, entryPrice: 3500, plannedRiskAmount: 1000 },
    ...overrides,
  } as DecisionLedgerEntry;
}

function buildAllT2Artifacts(analysis: AgentAnalysis) {
  const snap = snapshotFor(analysis);
  const wait = buildWaitRecommendation({
    now: NOW,
    analysis,
    snapshot: snap,
  });
  const thesisSnapshot = buildThesisSnapshot({
    now: NOW,
    analysis,
    snapshot: snap,
    tradeHorizon: 'SWING',
    strategyTag: 'MOMENTUM',
  });
  const thesis = thesisSnapshot.initialThesis;
  const exit = buildExitRecommendation({
    now: NOW,
    position: {
      symbol: SYMBOL,
      entryPrice: 3500,
      currentPrice: 3520,
      stopLoss: 3400,
      target: 3700,
      quantity: 10,
      openedAt: NOW - 86_400_000,
    },
    thesis,
  });
  const decision = baseLedger({
    waitIntelligence: wait,
    thesisSnapshot,
    thesisReassessment: thesis,
  });
  const lifecycle = materializeTradeLifecycle({
    now: NOW,
    decision,
    thesisEvents: [
      {
        kind: 'THESIS_EVENT',
        decisionId: DECISION_ID,
        timestamp: NOW,
        event: buildThesisHistoryEvent({
          now: NOW,
          priorState: undefined,
          newState: thesis.state,
          changes: [],
        }),
      },
    ],
    exitAdvisory: exit,
  });
  return { wait, thesisSnapshot, thesis, exit, lifecycle };
}

describe('T2 Validation Gate', () => {
  it('V-A — combined isolation: AuthorizationProjection unchanged with all T2 attached', () => {
    const analysis = baseAnalysis();
    const baseline = runBaselineAuthorizationChain({ analysis, includeGate: true, now: NOW });

    buildAllT2Artifacts(analysis);

    const enriched = runBaselineAuthorizationChain({ analysis, includeGate: true, now: NOW });
    const isolation = compareAuthorizationIsolation(baseline.projection, enriched.projection);
    expect(isolation.ok).toBe(true);
    expect(isolation.reasons).toEqual([]);
  });

  it('V-B — WAIT→Thesis→Exit→Lifecycle coherence on shared decision anchor', () => {
    const analysis = baseAnalysis();
    const { wait, thesisSnapshot, exit, lifecycle } = buildAllT2Artifacts(analysis);

    expect(wait.decision).toBe('WAIT');
    expect(thesisSnapshot.initialThesis.symbol).toBe(SYMBOL);
    expect(exit.advisory).toBe(true);
    expect(lifecycle.decisionId).toBe(DECISION_ID);
    expect(lifecycle.symbol).toBe(SYMBOL);
    expect(lifecycle.events.some((e) => e.detail?.includes('Exit advisory'))).toBe(true);
  });

  it('V-C — WAIT cannot bypass Gate: no execute surface; gate projection unchanged', () => {
    const analysis = baseAnalysis();
    const baseline = runBaselineAuthorizationChain({ analysis, includeGate: true, now: NOW });
    const wait = buildWaitRecommendation({
      now: NOW,
      analysis,
      snapshot: snapshotFor(analysis),
    });

    expect(wait.decision).toBe('WAIT');
    expect(wait).not.toHaveProperty('execute');
    expect(wait).not.toHaveProperty('quantity');
    expect(JSON.stringify(wait)).not.toMatch(/execute|submit/i);

    const afterWait = runBaselineAuthorizationChain({ analysis, includeGate: true, now: NOW });
    const isolation = compareAuthorizationIsolation(baseline.projection, afterWait.projection);
    expect(isolation.ok).toBe(true);
  });

  it('V-D — thesis weakening yields TRIM or HOLD advisory, not authorization escalation', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: {
        symbol: SYMBOL,
        entryPrice: 3500,
        currentPrice: 3520,
        stopLoss: 3400,
        target: 3700,
        quantity: 10,
        openedAt: NOW - 86_400_000,
      },
      thesis: thesisWithState('WEAKENING'),
    });
    expect(['HOLD', 'TRIM']).toContain(rec.action);
    expect(rec.action).not.toBe('EXIT');
    expect(rec).not.toHaveProperty('execute');
  });

  it('V-E — thesis invalidation yields advisory EXIT only', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: {
        symbol: SYMBOL,
        entryPrice: 3500,
        currentPrice: 3520,
        stopLoss: 3400,
        target: 3700,
        quantity: 10,
        openedAt: NOW - 86_400_000,
      },
      thesis: thesisWithState('INVALIDATED'),
    });
    expect(rec.action).toBe('EXIT');
    expect(rec.advisory).toBe(true);
    expect(rec).not.toHaveProperty('execute');
    expect(rec).not.toHaveProperty('quantity');
  });

  it('V-F — advisory EXIT ≠ lifecycle EXIT in combined stack', () => {
    const decision = baseLedger();
    const exitAdvisory = buildExitRecommendation({
      now: NOW,
      position: {
        symbol: SYMBOL,
        entryPrice: 3500,
        currentPrice: 3400,
        stopLoss: 3350,
        target: 3700,
        quantity: 10,
        openedAt: NOW - 86_400_000,
      },
      thesis: thesisWithState('INVALIDATED'),
    });
    const snapshot = materializeTradeLifecycle({
      now: NOW,
      decision,
      exitAdvisory,
    });
    expect(snapshot.currentStage).toBe('MANAGEMENT');
    expect(
      snapshot.events.some(
        (e) => e.kind === 'CONTEXT' && e.detail?.includes('Exit advisory: EXIT'),
      ),
    ).toBe(true);
    expect(snapshot.events.some((e) => e.kind === 'STAGE' && e.stage === 'EXIT')).toBe(false);
  });

  it('V-G — lifecycle metrics from ACTUAL only; COUNTERFACTUAL timeline-only', () => {
    const cfDecision = baseLedger({
      outcome: {
        outcomeId: 'out-cf',
        decisionId: DECISION_ID,
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
    const cfMetrics = computeLifecycleMetrics({ now: NOW, decision: cfDecision });
    expect(cfMetrics.realizedR).toBeNull();
    expect(
      deriveLifecycleStage({
        decision: cfDecision,
        outcomeRecords: [],
      }),
    ).toBe('MANAGEMENT');

    const actualDecision = baseLedger({
      outcome: {
        outcomeId: 'out-act',
        decisionId: DECISION_ID,
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
  });

  it('V-H — missing data yields UNKNOWN / null metrics', () => {
    const sparse = baseLedger({
      analysisSnapshot: undefined as unknown as DecisionLedgerEntry['analysisSnapshot'],
      execution: undefined,
      decision: 'BLOCKED',
      state: 'EXECUTING',
    });
    const snapshot = materializeTradeLifecycle({ now: NOW, decision: sparse });
    expect(snapshot.currentStage).toBe('UNKNOWN');
    expect(snapshot.metrics.realizedR).toBeNull();
  });

  it('V-I — historical immutability: frozen thesis + append-only events', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const frozen = buildThesisSnapshot({
      now: NOW,
      analysis,
      snapshot: snap,
      tradeHorizon: 'SWING',
      strategyTag: 'MOMENTUM',
    });
    const initialCopy = JSON.parse(JSON.stringify(frozen.initialThesis));

    let events: ThesisHistoryLedgerRecord['event'][] = [];
    const created = buildThesisHistoryEvent({
      now: NOW,
      priorState: undefined,
      newState: frozen.initialThesis.state,
      changes: [],
    });
    events = appendThesisHistory({ events }, created);

    const reassessed = reassessThesis({
      now: NOW + 60_000,
      initial: frozen.initialThesis,
      analysis,
      snapshot: snap,
    });
    const weakened = buildThesisHistoryEvent({
      now: NOW + 60_000,
      priorState: frozen.initialThesis.state,
      newState: reassessed.state,
      changes: ['regime weakened'],
    });
    events = appendThesisHistory({ events }, weakened);

    expect(frozen.initialThesis).toEqual(initialCopy);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('THESIS_CREATED');
    expect(events[1].type).not.toBe('THESIS_CREATED');
  });

  it('V-J — report builder returns schema v1 with verdict precedence', () => {
    const passReport = buildT2ValidationReport({
      checks: [
        {
          id: 'isolation-combined',
          title: 'Combined isolation',
          required: true,
          status: 'PASS',
          detail: 'ok',
        },
      ],
      regression: {
        t2SliceTests: [],
        sharedUtils: { passed: 10, total: 10 },
        builds: [{ target: 'shared-utils', ok: true }],
        frozenFilesDiffClean: true,
      },
    });
    expect(passReport.schemaVersion).toBe('t2-validation-report.v1');
    expect(passReport.evidenceOnly).toBe(true);
    expect(passReport.verdict).toBe('PASS');

    const skipVerdict = resolveT2ValidationVerdict({
      checks: [
        {
          id: 'required-check',
          title: 'Required',
          required: true,
          status: 'SKIP',
          detail: 'skipped',
        },
      ],
      regression: {
        t2SliceTests: [],
        sharedUtils: { passed: 10, total: 10 },
        builds: [],
        frozenFilesDiffClean: true,
      },
    });
    expect(skipVerdict.verdict).toBe('INCONCLUSIVE');

    const failVerdict = resolveT2ValidationVerdict({
      checks: [
        {
          id: 'safety',
          title: 'Safety',
          required: true,
          status: 'FAIL',
          detail: 'failed',
        },
      ],
      regression: {
        t2SliceTests: [],
        sharedUtils: { passed: 10, total: 10 },
        builds: [],
        frozenFilesDiffClean: true,
      },
    });
    expect(failVerdict.verdict).toBe('FAIL');
  });

  it('V-K — isolation guard on report module passes', () => {
    const guard = verifyT2ValidationIsolation();
    expect(guard.ok).toBe(true);
    expect(guard.forbidden).toContain('risk-engine');
    expect(guard.forbidden).toContain('gate-sim');
    expect(guard.forbidden).toContain('exit-policy');
  });
});
