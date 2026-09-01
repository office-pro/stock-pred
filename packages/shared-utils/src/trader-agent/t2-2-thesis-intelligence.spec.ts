/**
 * T2.2 Thesis Intelligence crown tests.
 */
import type { AgentAnalysis, IntelligenceSnapshot } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  appendThesisHistory,
  applyDecisionPolicy,
  buildIntelligenceSnapshot,
  buildStructuredThesis,
  buildThesisHistoryEvent,
  buildThesisSnapshot,
  detectWeakenedChanges,
  digestFromStructuredThesis,
  digestThesisEvidence,
  emptyPortfolioSnapshot,
  evaluateInvalidationConditions,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  reassessThesis,
  verifyThesisIntelligenceIsolation,
} from './index';

const NOW = 1_700_000_000_000;

function baseAnalysis(overrides: Partial<AgentAnalysis> = {}): AgentAnalysis {
  return {
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

function snapshotFor(
  analysis: AgentAnalysis,
  patch: Partial<IntelligenceSnapshot> = {},
): IntelligenceSnapshot {
  const decision = evaluateTrade({ analysis });
  const base = buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: analysis.generatedAt,
    marketContext: {
      scannerRegime: 'RISK_ON',
      breadthPercentAboveEma50: 0.55,
      asOf: NOW,
    },
    crossSectional: {
      rsVsNifty50: 1.2,
      peerRsValues: [0.8, 1.0, 1.1, 1.3],
      asOf: NOW,
    },
  });
  return { ...base, ...patch };
}

describe('T2.2 Thesis Intelligence', () => {
  it('builds deterministic structured thesis', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const a = buildStructuredThesis({ now: NOW, analysis, snapshot: snap });
    const b = buildStructuredThesis({ now: NOW, analysis, snapshot: snap });
    expect(a).toEqual(b);
    expect(a.provenance.engineVersion).toBeTruthy();
    expect(a.provenance.generatedAt).toBe(new Date(NOW).toISOString());
    expect(a.state).toBe('VALID');
  });

  it('does not expose ThesisScore on structured thesis', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const thesis = buildStructuredThesis({ now: NOW, analysis, snapshot: snap });
    expect('thesisScore' in thesis).toBe(false);
    expect('score' in thesis).toBe(false);
  });

  it('maps supporting evidence to real TI field paths', () => {
    const analysis = baseAnalysis();
    const base = snapshotFor(analysis);
    const snap = snapshotFor(analysis, {
      sectorIntelligence: {
        sector: 'IT',
        sectorTrend: 'LEADING',
        valuationVsPeers: 'FAIR',
        sectorFit: 'HIGH',
      },
      regimeCompatibility: base.regimeCompatibility
        ? { ...base.regimeCompatibility, compatibility: 'FAVORABLE' }
        : undefined,
      multiHorizonAgreement: base.multiHorizonAgreement
        ? { ...base.multiHorizonAgreement, agreement: 'HIGH' }
        : undefined,
      catalystContext: base.catalystContext
        ? { ...base.catalystContext, eventRisk: 'LOW' }
        : undefined,
    });
    const thesis = buildStructuredThesis({ now: NOW, analysis, snapshot: snap });
    const sources = thesis.supportingEvidence.map((e) => e.source);
    expect(sources).toContain('crossSectionalRs.rsBucket');
    expect(sources).toContain('sectorIntelligence.sectorFit');
    expect(sources).toContain('regimeCompatibility.compatibility');
  });

  it('reassessment does not mutate frozen initial thesis', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const frozen = buildThesisSnapshot({ now: NOW, analysis, snapshot: snap });
    const initialBytes = JSON.stringify(frozen.initialThesis);

    const weakenedSnap = snapshotFor(analysis, {
      crossSectionalRs: {
        rsBucket: 'LAGGARDS',
        source: 'PEER_CROSS_SECTION',
      },
    });
    reassessThesis({
      now: NOW + 60_000,
      initial: frozen.initialThesis,
      analysis,
      snapshot: weakenedSnap,
    });

    expect(JSON.stringify(frozen.initialThesis)).toBe(initialBytes);
  });

  it('hard test 1 — missing data is not deterioration', () => {
    const analysis = baseAnalysis();
    const full = snapshotFor(analysis, {
      sectorIntelligence: {
        sector: 'IT',
        sectorTrend: 'LEADING',
        valuationVsPeers: 'FAIR',
        sectorFit: 'HIGH',
      },
    });
    const sparse = snapshotFor(analysis, {
      crossSectionalRs: undefined,
      sectorIntelligence: undefined,
      regimeCompatibility: undefined,
      multiHorizonAgreement: undefined,
      catalystContext: undefined,
    });
    const initial = buildStructuredThesis({ now: NOW, analysis, snapshot: full });
    const reassessed = reassessThesis({
      now: NOW + 60_000,
      initial,
      analysis,
      snapshot: sparse,
    });
    expect(reassessed.state).not.toBe('WEAKENING');
    const changes = detectWeakenedChanges(
      digestFromStructuredThesis(initial),
      digestThesisEvidence(sparse),
    );
    expect(changes).toHaveLength(0);
  });

  it('hard test 2 — regime unfavorable weakens but does not invalidate', () => {
    const analysis = baseAnalysis({ invalidation: '' });
    const base = snapshotFor(analysis);
    const favorable = snapshotFor(analysis, {
      regimeCompatibility: base.regimeCompatibility
        ? { ...base.regimeCompatibility, compatibility: 'FAVORABLE' }
        : undefined,
    });
    const unfavorable = snapshotFor(analysis, {
      regimeCompatibility: base.regimeCompatibility
        ? { ...base.regimeCompatibility, compatibility: 'UNFAVORABLE' }
        : undefined,
    });
    const initial = buildStructuredThesis({ now: NOW, analysis, snapshot: favorable });
    const reassessed = reassessThesis({
      now: NOW + 60_000,
      initial,
      analysis,
      snapshot: unfavorable,
    });
    expect(reassessed.state).toBe('WEAKENING');
    expect(reassessed.state).not.toBe('INVALIDATED');
  });

  it('hard test 3 — risk stop alone does not invalidate thesis', () => {
    const analysis = baseAnalysis({
      currentPrice: 3350,
      invalidation: '',
      setup: {
        ...baseAnalysis().setup,
        stopLoss: 3400,
        invalidation: 'Close below stop',
      },
    });
    const baseSnap = snapshotFor(analysis);
    const snap: IntelligenceSnapshot = {
      ...baseSnap,
      thesis: baseSnap.thesis
        ? {
            ...baseSnap.thesis,
            invalidation: { conditions: [] },
          }
        : undefined,
    };
    const initial = buildStructuredThesis({ now: NOW, analysis, snapshot: snap });
    expect(initial.invalidationConditions.some((c) => c.includes('3400'))).toBe(false);
    expect(evaluateInvalidationConditions(initial.invalidationConditions, analysis)).toBe(false);
    const reassessed = reassessThesis({ now: NOW, initial, analysis, snapshot: snap });
    expect(reassessed.state).not.toBe('INVALIDATED');
  });

  it('hard test 4 — append-only history preserves prior events and initial thesis', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const frozen = buildThesisSnapshot({ now: NOW, analysis, snapshot: snap });
    const initialBytes = JSON.stringify(frozen.initialThesis);

    const store = { events: [] as ReturnType<typeof buildThesisHistoryEvent>[] };
    const created = buildThesisHistoryEvent({
      now: NOW,
      newState: frozen.initialThesis.state,
      changes: [],
    });
    store.events = appendThesisHistory(store, created);

    const weakenedSnap = snapshotFor(analysis, {
      crossSectionalRs: {
        rsBucket: 'MIDDLE',
        source: 'PEER_CROSS_SECTION',
      },
    });
    const reassessed1 = reassessThesis({
      now: NOW + 60_000,
      initial: frozen.initialThesis,
      analysis,
      snapshot: weakenedSnap,
    });
    const event1 = buildThesisHistoryEvent({
      now: NOW + 60_000,
      priorState: frozen.initialThesis.state,
      newState: reassessed1.state,
      changes: detectWeakenedChanges(
        digestFromStructuredThesis(frozen.initialThesis),
        digestThesisEvidence(weakenedSnap),
      ),
    });
    const after1 = appendThesisHistory(store, event1);
    const snapshotAfter1 = JSON.stringify(after1);

    const reassessed2 = reassessThesis({
      now: NOW + 120_000,
      initial: frozen.initialThesis,
      analysis,
      snapshot: weakenedSnap,
    });
    const event2 = buildThesisHistoryEvent({
      now: NOW + 120_000,
      priorState: reassessed1.state,
      newState: reassessed2.state,
      changes: [],
    });
    const after2 = appendThesisHistory({ events: after1 }, event2);

    expect(JSON.stringify(frozen.initialThesis)).toBe(initialBytes);
    expect(JSON.stringify(after2.slice(0, 2))).toBe(snapshotAfter1);
    expect(after2).toHaveLength(3);
    expect(after2[0].type).toBe('THESIS_CREATED');
  });

  it('enforces monotonic thesis history timestamps', () => {
    const store = { events: [] as ReturnType<typeof buildThesisHistoryEvent>[] };
    store.events = appendThesisHistory(
      store,
      buildThesisHistoryEvent({ now: NOW, newState: 'VALID', changes: [] }),
    );
    expect(() =>
      appendThesisHistory(
        store,
        buildThesisHistoryEvent({ now: NOW - 1, newState: 'WEAKENING', changes: [] }),
      ),
    ).toThrow(/monotonic/i);
  });

  it('evaluateTrade / Risk / Portfolio / Policy unchanged when thesis intelligence attached', () => {
    const analysis = baseAnalysis();
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

    const snap = snapshotFor(analysis);
    buildThesisSnapshot({ now: NOW, analysis, snapshot: snap });
    buildStructuredThesis({ now: NOW, analysis, snapshot: snap });

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

  it('exposes isolation guard without forbidden engine imports', () => {
    const guard = verifyThesisIntelligenceIsolation();
    expect(guard.ok).toBe(true);
    expect(guard.forbidden).toContain('risk-engine');
  });
});
