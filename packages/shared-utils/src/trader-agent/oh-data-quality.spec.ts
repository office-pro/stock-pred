/**
 * OH-5 Data Quality hard gates.
 * Observe-only — must not change Risk / Portfolio / Policy / Gate / TI / P5.
 */

import type { AgentAnalysis, PortfolioVerdict, RiskVerdict } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  OH5_QUOTE_STALE_MS,
  OhDataQualityCollector,
  applyDecisionPolicy,
  classifyDataQuality,
  detectConflictingFeeds,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  validateCandleSeries,
  validateFundamentals,
  validateMarketContext,
  validateQuoteSample,
} from './index';

const okRisk: RiskVerdict = {
  allowed: true,
  riskScore: 1,
  quantity: 10,
  riskAmount: 500,
  stopLoss: 95,
  maxLoss: 500,
  riskReward: 2,
  reasonCodes: [],
  reasons: [],
};

const okPortfolio: PortfolioVerdict = {
  allowed: true,
  openPositions: 0,
  cash: 100_000,
  requiredCapital: 1_000,
  nameExposurePct: 5,
  sectorExposurePct: 10,
  reasonCodes: [],
  reasons: [],
};

function baseAnalysis(symbol = 'TCS'): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    setup: {
      instrument: symbol,
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
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

function goodCandle(time: number, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close };
}

describe('P5 Operational Hardening OH-5 Data Quality', () => {
  it('1. Clean quote + candles → HEALTHY', () => {
    const now = Date.now();
    const quoteIssues = validateQuoteSample(
      { price: 100, updatedAt: now - 1_000, previousClose: 99 },
      now,
    );
    expect(quoteIssues).toEqual([]);

    const step = 60_000;
    const candles = [0, 1, 2, 3].map((i) => goodCandle(now - (3 - i) * step, 100 + i));
    const candleIssues = validateCandleSeries(candles, '1m');
    expect(candleIssues).toEqual([]);

    const collector = new OhDataQualityCollector();
    collector.noteSourceReachable(true);
    collector.recordIssues('QUOTE', quoteIssues, { symbol: 'TCS' });
    collector.recordIssues('CANDLE', candleIssues, { symbol: 'TCS', timeframe: '1m' });
    const snap = collector.snapshot();
    expect(snap.observeOnly).toBe(true);
    expect(snap.schemaVersion).toBe('oh-data-quality.v1');
    expect(snap.status).toBe('HEALTHY');
    expect(snap.diagnostics).toEqual([]);
  });

  it('2. Stale quote → DATA_STALE → DEGRADED', () => {
    const now = Date.now();
    const issues = validateQuoteSample(
      { price: 100, updatedAt: now - OH5_QUOTE_STALE_MS - 1, previousClose: 100 },
      now,
    );
    expect(issues.some((i) => i.diagnostic === 'DATA_STALE')).toBe(true);

    const collector = new OhDataQualityCollector();
    collector.noteSourceReachable(true);
    collector.recordIssues('QUOTE', issues);
    expect(collector.snapshot().status).toBe('DEGRADED');
    expect(collector.snapshot().diagnostics).toContain('DATA_STALE');
  });

  it('3. Invalid OHLC → OHLC_INVALID', () => {
    const issues = validateCandleSeries([{ time: 1, open: 10, high: 9, low: 8, close: 10 }], '1m');
    expect(issues.some((i) => i.diagnostic === 'OHLC_INVALID')).toBe(true);
  });

  it('4. Duplicate / out-of-order candles → DUPLICATE_DATA / TIMESTAMP_ANOMALY', () => {
    const dup = validateCandleSeries([goodCandle(1_000), goodCandle(1_000)], '1m');
    expect(dup.some((i) => i.diagnostic === 'DUPLICATE_DATA')).toBe(true);

    const ooo = validateCandleSeries([goodCandle(2_000), goodCandle(1_000)], '1m');
    expect(ooo.some((i) => i.diagnostic === 'TIMESTAMP_ANOMALY')).toBe(true);
  });

  it('5. Missing bar in series → MISSING_CANDLE', () => {
    const step = 60_000;
    const issues = validateCandleSeries([goodCandle(0), goodCandle(step * 3)], '1m');
    expect(issues.some((i) => i.diagnostic === 'MISSING_CANDLE')).toBe(true);
  });

  it('6. Zero/negative / huge gap → PRICE_ANOMALY', () => {
    expect(
      validateQuoteSample({ price: 0, updatedAt: Date.now() }).some(
        (i) => i.diagnostic === 'PRICE_ANOMALY',
      ),
    ).toBe(true);

    const gap = validateCandleSeries([goodCandle(0, 100), goodCandle(60_000, 130)], '1m');
    expect(gap.some((i) => i.diagnostic === 'PRICE_ANOMALY')).toBe(true);
  });

  it('7. Null MDS / unreachable → SOURCE_UNAVAILABLE → UNAVAILABLE', () => {
    const issues = validateQuoteSample(null);
    expect(issues.some((i) => i.diagnostic === 'SOURCE_UNAVAILABLE')).toBe(true);

    const classified = classifyDataQuality({
      samples: [
        {
          sampleId: '1',
          recordedAt: Date.now(),
          kind: 'SOURCE',
          ok: false,
          diagnostic: 'SOURCE_UNAVAILABLE',
        },
      ],
      sourceReachable: false,
    });
    expect(classified.status).toBe('UNAVAILABLE');
  });

  it('8. Missing context / stale fundamentals → CONTEXT_MISSING / FUNDAMENTAL_DATA_STALE', () => {
    expect(validateMarketContext(null).some((i) => i.diagnostic === 'CONTEXT_MISSING')).toBe(true);
    expect(
      validateFundamentals({ missing: true }).some((i) => i.diagnostic === 'CONTEXT_MISSING'),
    ).toBe(true);

    const stale = validateFundamentals(
      { missing: false, asOfDate: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      Date.now(),
    );
    expect(stale.some((i) => i.diagnostic === 'FUNDAMENTAL_DATA_STALE')).toBe(true);
  });

  it('9. Crown isolation: OH-5 ON + bad telemetry → identical Risk/Portfolio/Policy', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };

    const riskOff = evaluateRisk(riskInput);
    const portOff = evaluatePortfolio({ decision, risk: riskOff, portfolio: portfolioSnap });
    const policyOff = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk: riskOff,
      portfolio: portOff,
    });

    const collector = new OhDataQualityCollector();
    collector.noteSourceReachable(false);
    collector.recordIssues('QUOTE', validateQuoteSample(null));
    collector.recordIssues(
      'CANDLE',
      validateCandleSeries([{ time: 1, open: -1, high: 0, low: 0, close: 0 }], '1m'),
    );
    collector.record({
      kind: 'SOURCE',
      ok: false,
      diagnostic: undefined as unknown as 'DATA_STALE',
    });
    expect(collector.snapshot().status).not.toBe('HEALTHY');

    const riskOn = evaluateRisk(riskInput);
    const portOn = evaluatePortfolio({ decision, risk: riskOn, portfolio: portfolioSnap });
    const policyOn = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk: riskOn,
      portfolio: portOn,
    });

    expect(JSON.stringify(riskOn)).toBe(JSON.stringify(riskOff));
    expect(JSON.stringify(portOn)).toBe(JSON.stringify(portOff));
    expect(JSON.stringify(policyOn)).toBe(JSON.stringify(policyOff));
    // unused okRisk/okPortfolio keep shape parity with other OH specs
    expect(okRisk.allowed).toBe(true);
    expect(okPortfolio.allowed).toBe(true);
  });

  it('10. Bad telemetry must not throw', () => {
    const collector = new OhDataQualityCollector();
    expect(() =>
      collector.record({ kind: undefined as unknown as 'QUOTE', ok: false }),
    ).not.toThrow();
    expect(() => collector.recordIssues('QUOTE', undefined as unknown as [])).not.toThrow();
    expect(() => collector.snapshot()).not.toThrow();
    expect(() => collector.clear()).not.toThrow();
  });

  it('11. Unknown timeframe → INSUFFICIENT_VALIDATION_CONTEXT, no fabricated MISSING_CANDLE', () => {
    const issues = validateCandleSeries([goodCandle(0), goodCandle(60_000 * 10)], '3m');
    expect(issues.some((i) => i.diagnostic === 'INSUFFICIENT_VALIDATION_CONTEXT')).toBe(true);
    expect(issues.some((i) => i.diagnostic === 'MISSING_CANDLE')).toBe(false);
  });

  it('12. CONFLICTING_FEEDS only when two comparable quotes disagree', () => {
    expect(detectConflictingFeeds({ price: 100 }, { price: 101 })).toEqual([]);
    const conflict = detectConflictingFeeds({ price: 100 }, { price: 120 });
    expect(conflict.some((i) => i.diagnostic === 'CONFLICTING_FEEDS')).toBe(true);
  });
});
