import type { AgentAnalysis, WalkForwardOpportunity } from '@stockpred/shared-types';
import {
  assertNoFutureData,
  buildHistoricalDecisionContext,
  canonicalizeWalkForwardReport,
  confidenceToScale,
  DEFAULT_DUPLICATE_ORDER_WINDOW_MS,
  evaluateRisk,
  evaluateTrade,
  NSEDeliveryCostModel,
  runAgentWalkForward,
  simulateRevalidatingGate,
  SimulatedBook,
} from './index';
import { applyDecisionPolicy } from './decision-policy';
import { evaluatePortfolio } from './portfolio-engine';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 2, 10, 0, 0);

function analysis(overrides?: Partial<AgentAnalysis>): AgentAnalysis {
  return {
    symbol: 'TCS',
    currentPrice: 3500,
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
      confidence: 80,
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
    generatedAt: T0,
    disclaimer: 'test',
    ...overrides,
  } as AgentAnalysis;
}

function barsFrom(
  signalClose: number,
  nextOpen: number,
  extras: Array<{ o: number; h: number; l: number; c: number }> = [],
) {
  const signalTs = T0;
  const rows = [
    {
      timestamp: signalTs,
      open: signalClose,
      high: signalClose,
      low: signalClose,
      close: signalClose,
    },
    {
      timestamp: signalTs + DAY,
      open: nextOpen,
      high: nextOpen * 1.01,
      low: nextOpen * 0.99,
      close: nextOpen,
    },
  ];
  extras.forEach((b, i) => {
    rows.push({
      timestamp: signalTs + DAY * (i + 2),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    });
  });
  return rows;
}

function opportunity(partial?: Partial<WalkForwardOpportunity>): WalkForwardOpportunity {
  return {
    opportunityId: 'opp-1',
    timestamp: T0,
    symbol: 'TCS',
    sector: 'IT',
    analysis: analysis(),
    quote: { price: 3500, timestamp: T0 },
    bars: barsFrom(3500, 3500, [
      { o: 3520, h: 3720, l: 3510, c: 3710 }, // target hit
    ]),
    regimeSnapshot: {
      marketRegime: 'RISK_ON',
      trend: 'BULL',
      volatility: 'MID',
      trendVolKey: 'BULL|MID',
    },
    horizonBars: 5,
    ...partial,
  };
}

describe('Phase 3 walk-forward', () => {
  it('assertNoFutureData fails when quoteTimestamp > T', () => {
    const ctx = buildHistoricalDecisionContext({
      opportunity: opportunity({
        quote: { price: 3500, timestamp: T0 + 1 },
      }),
      cash: 1_000_000,
      equity: 1_000_000,
      dayStartEquity: 1_000_000,
      weekStartEquity: 1_000_000,
      positions: [],
    });
    expect(() => assertNoFutureData(ctx, T0)).toThrow(/Future data/);
  });

  it('never fills on the same bar (fillTimestamp > decisionTimestamp)', () => {
    const report = runAgentWalkForward({ initialCash: 1_000_000, slippageBps: 5 }, [opportunity()]);
    expect(report.trades.length).toBeGreaterThanOrEqual(1);
    for (const t of report.trades) {
      expect(t.fillTimestamp).toBeGreaterThan(t.decisionTimestamp);
    }
    expect(report.validationChecks.noSameBarFills).toBe(true);
  });

  it('deterministic replay: two runs deep-equal after canonicalize', () => {
    const opps = [
      opportunity(),
      opportunity({
        opportunityId: 'opp-2',
        symbol: 'INFY',
        analysis: analysis({
          symbol: 'INFY',
          setup: {
            ...analysis().setup,
            instrument: 'INFY',
            entry: 1500,
            stopLoss: 1450,
            target1: 1600,
          },
        }),
        quote: { price: 1500, timestamp: T0 + DAY },
        timestamp: T0 + DAY,
        bars: [
          { timestamp: T0 + DAY, open: 1500, high: 1500, low: 1500, close: 1500 },
          { timestamp: T0 + DAY * 2, open: 1500, high: 1510, low: 1490, close: 1505 },
          { timestamp: T0 + DAY * 3, open: 1505, high: 1610, low: 1500, close: 1605 },
        ],
      }),
    ];
    const a = canonicalizeWalkForwardReport(runAgentWalkForward({ initialCash: 2_000_000 }, opps));
    const b = canonicalizeWalkForwardReport(runAgentWalkForward({ initialCash: 2_000_000 }, opps));
    expect(a).toEqual(b);
  });

  it('confidence cannot raise ceiling; risk ceiling respected', () => {
    const decision = evaluateTrade({ analysis: analysis() });
    decision.createdAt = T0;
    decision.quoteTimestamp = T0;
    const ceiling = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 100,
      now: T0,
    });
    expect(ceiling.allowed).toBe(true);
    if (!ceiling.allowed) return;
    const hyped = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 250,
      now: T0,
    });
    expect(hyped.allowed).toBe(true);
    if (!hyped.allowed) return;
    expect(hyped.confidenceScale).toBe(1);
    expect(hyped.quantity).toBeLessThanOrEqual(hyped.quantityBeforeConfidence!);
    expect(hyped.quantity).toBe(ceiling.quantity);
    expect(confidenceToScale(250)).toBe(1);

    const report = runAgentWalkForward(
      { initialCash: 1_000_000, confidenceSweep: [50, 100, 200] },
      [opportunity()],
    );
    expect(report.validationChecks.confidenceNeverRaisesCeiling).toBe(true);
    expect(report.validationChecks.riskCeilingNeverExceeded).toBe(true);
    for (const row of report.confidenceSensitivity) {
      expect(row.neverRaisedCeiling).toBe(true);
      expect(row.scale).toBeLessThanOrEqual(1);
    }
  });

  it('position / sector / cash reserve limits respected via engines', () => {
    // Sector block: already large IT book → eligible but not accepted.
    const bookHeavy: WalkForwardOpportunity = opportunity({
      opportunityId: 'sector-block',
      analysis: analysis({ scores: { ...analysis().scores, overall: 80 } }),
    });
    // Pre-seed via tiny cash reserve and max positions in config.
    const report = runAgentWalkForward(
      {
        initialCash: 1_000_000,
        riskBudgets: {
          maxOpenPositions: 0,
          maxSectorExposurePct: 1,
          cashReservePct: 99,
          maxNameExposurePct: 0.01,
        },
      },
      [bookHeavy],
    );
    expect(report.funnel.autonomousEligible).toBeGreaterThanOrEqual(1);
    expect(report.funnel.filled).toBe(0);
    expect(report.funnel.autoAccepted).toBe(0);
    expect(
      report.funnel.portfolioBlocked + report.funnel.riskBlocked + report.funnel.policyRejected,
    ).toBeGreaterThan(0);
  });

  it('TTL and quote freshness enforced at gate', () => {
    const decision = evaluateTrade({
      analysis: analysis(),
      quoteTimestamp: T0 - 120_000,
      ttlMs: 60_000,
    });
    decision.createdAt = T0 - 120_000;
    const book = new SimulatedBook(1_000_000);
    const stale = simulateRevalidatingGate({
      decision,
      livePrice: 3500,
      maxPriceDeviationPct: 1,
      book,
      now: T0,
      maxQuoteAgeMs: 60_000,
    });
    expect(stale.passed).toBe(false);
    expect(stale.reasonCodes).toEqual(expect.arrayContaining(['DECISION_EXPIRED', 'DATA_STALE']));

    const report = runAgentWalkForward(
      { initialCash: 1_000_000, decisionTtlMs: 1, maxQuoteAgeMs: 1 },
      [
        opportunity({
          quote: { price: 3500, timestamp: T0 - 10_000 },
          bars: barsFrom(3500, 3500, [{ o: 3600, h: 3720, l: 3590, c: 3700 }]),
        }),
      ],
    );
    // Either risk or gate blocks; nothing should fill with 1ms TTL/freshness vs day gaps.
    expect(report.funnel.filled).toBe(0);
    expect(report.funnel.riskBlocked + report.funnel.gateBlocked).toBeGreaterThan(0);
  });

  it('duplicate orders prevented within window', () => {
    const decision = evaluateTrade({ analysis: analysis() });
    decision.createdAt = T0;
    decision.quoteTimestamp = T0;
    const book = new SimulatedBook(1_000_000);
    book.recordSubmit('TCS', T0);
    const dup = simulateRevalidatingGate({
      decision,
      livePrice: 3500,
      maxPriceDeviationPct: 1,
      book,
      now: T0 + 1_000,
      duplicateOrderWindowMs: DEFAULT_DUPLICATE_ORDER_WINDOW_MS,
    });
    expect(dup.passed).toBe(false);
    expect(dup.reasonCodes).toContain('DUPLICATE_ORDER');

    const sameDay = opportunity({ opportunityId: 'a' });
    const twin = opportunity({
      opportunityId: 'b',
      timestamp: T0 + 1_000,
      quote: { price: 3500, timestamp: T0 + 1_000 },
      analysis: analysis({ generatedAt: T0 + 1_000 }),
      bars: [
        { timestamp: T0 + 1_000, open: 3500, high: 3500, low: 3500, close: 3500 },
        { timestamp: T0 + DAY, open: 3500, high: 3720, low: 3490, close: 3700 },
        { timestamp: T0 + DAY * 2, open: 3700, high: 3720, low: 3690, close: 3710 },
      ],
    });
    const report = runAgentWalkForward(
      { initialCash: 5_000_000, duplicateOrderWindowMs: DAY * 2 },
      [sameDay, twin],
    );
    expect(report.funnel.gateBlocked).toBeGreaterThanOrEqual(1);
    expect(report.funnel.filled).toBeLessThan(report.funnel.autoAccepted || 1);
  });

  it('LIVE never AUTO_ACCEPTED in harness', () => {
    const report = runAgentWalkForward({ initialCash: 1_000_000 }, [opportunity()]);
    expect(report.funnel.liveAutoAccepted).toBe(0);
    expect(report.validationChecks.liveNeverAutoAccepted).toBe(true);

    const decision = evaluateTrade({ analysis: analysis() });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      now: T0,
    });
    const portfolio = evaluatePortfolio({
      decision,
      risk,
      portfolio: new SimulatedBook(1_000_000).toPortfolioSnapshot(),
      symbolSector: 'IT',
    });
    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
  });

  it('eligibility ≠ acceptance (funnel: eligible > autoAccepted when blocked)', () => {
    const report = runAgentWalkForward(
      {
        initialCash: 1_000_000,
        riskBudgets: { maxPriceDeviationPct: 0.0001 },
      },
      [
        opportunity({
          bars: barsFrom(3500, 3600, [{ o: 3610, h: 3720, l: 3600, c: 3700 }]), // 2.8% gap → PRICE_DEVIATION
        }),
      ],
    );
    expect(report.funnel.autonomousEligible).toBeGreaterThan(0);
    expect(report.funnel.autonomousEligible).toBeGreaterThan(report.funnel.gatePass);
    expect(report.validationChecks.eligibilityNotAcceptance).toBe(true);
  });

  it('PRICE_DEVIATION gate blocks fill when next-bar open gaps beyond budget', () => {
    const decision = evaluateTrade({ analysis: analysis() });
    decision.createdAt = T0;
    decision.quoteTimestamp = T0;
    const book = new SimulatedBook(1_000_000);
    const blocked = simulateRevalidatingGate({
      decision,
      livePrice: 3600, // ~2.86% vs entry 3500
      maxPriceDeviationPct: 1,
      book,
      now: T0 + DAY,
      maxQuoteAgeMs: DAY * 7,
    });
    expect(blocked.passed).toBe(false);
    expect(blocked.reasonCodes).toContain('PRICE_DEVIATION');

    const report = runAgentWalkForward(
      {
        initialCash: 1_000_000,
        riskBudgets: { maxPriceDeviationPct: 1 },
      },
      [
        opportunity({
          bars: barsFrom(3500, 3600, [{ o: 3610, h: 3720, l: 3600, c: 3700 }]),
        }),
      ],
    );
    expect(report.funnel.autoAccepted).toBeGreaterThanOrEqual(1);
    expect(report.funnel.gateBlocked).toBeGreaterThanOrEqual(1);
    expect(report.funnel.filled).toBe(0);
    expect(report.reasonCodes.ranked.some((r) => r.code === 'PRICE_DEVIATION')).toBe(true);
  });

  it('gross/net + costs correct (hand-check one trade)', () => {
    const model = new NSEDeliveryCostModel({ slippageBps: 5 });
    const qty = 10;
    const entryRaw = 100;
    const exitRaw = 110;
    const costs = model.roundTrip({
      entryRawPrice: entryRaw,
      exitRawPrice: exitRaw,
      quantity: qty,
    });
    expect(costs.grossPnl).toBeCloseTo(100, 8);
    const entryFill = 100 * (1 + 5 / 10_000);
    const exitFill = 110 * (1 - 5 / 10_000);
    const entryNotional = qty * entryFill;
    const exitNotional = qty * exitFill;
    const entryFees = model.sideFees(entryNotional, 'BUY').feesTotal;
    const exitFees = model.sideFees(exitNotional, 'SELL').feesTotal;
    expect(costs.feesTotal).toBeCloseTo(entryFees + exitFees, 8);
    expect(costs.netPnl).toBeCloseTo((exitFill - entryFill) * qty - (entryFees + exitFees), 8);
    expect(costs.slippage).toBeCloseTo(
      Math.abs(entryFill - 100) * qty + Math.abs(110 - exitFill) * qty,
      8,
    );

    const report = runAgentWalkForward({ initialCash: 1_000_000, slippageBps: 5 }, [opportunity()]);
    expect(report.trades.length).toBe(1);
    const t = report.trades[0];
    expect(t.costs.feesTotal).toBeGreaterThan(0);
    expect(t.costs.netPnl).toBeLessThan(t.costs.grossPnl);
    expect(report.validationChecks.costsApplied).toBe(true);
  });

  it('regime is as-of T', () => {
    const report = runAgentWalkForward({ initialCash: 1_000_000 }, [
      opportunity({
        regimeSnapshot: {
          marketRegime: 'RISK_OFF',
          trend: 'BEAR',
          volatility: 'HIGH',
          trendVolKey: 'BEAR|HIGH',
        },
        analysis: analysis({ marketRegime: 'RISK_OFF' }),
      }),
    ]);
    expect(report.regimeSlices.some((s) => s.trendVolKey === 'BEAR|HIGH')).toBe(true);
    expect(report.validationChecks.regimeAsOfT).toBe(true);
    if (report.trades[0]) {
      expect(report.trades[0].regimeSnapshot.trendVolKey).toBe('BEAR|HIGH');
    }
  });
});
