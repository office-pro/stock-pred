import {
  DEFAULT_FRESH_QUOTE_MAX_AGE_MS,
  DEFAULT_LIVE_QUOTE_MAX_AGE_MS,
  classifyQuoteStatus,
  isNseCashSessionOpen,
  isNseRegularSession,
  isUsableForAnalysis,
  isUsableForLiveTrading,
  resolveActiveIngestMode,
} from './market-hours';
import { evaluateRisk } from './trader-agent/risk-engine';
import type { TradeDecision } from '@stockpred/shared-types';

describe('isNseRegularSession', () => {
  it('is open on a weekday during cash hours (IST)', () => {
    // Friday 14 Aug 2026, 10:00 IST = 04:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
    expect(isNseCashSessionOpen(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
  });

  it('opens at 09:15 IST and stays closed just before', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 44, 0))).toBe(false);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 45, 0))).toBe(true);
  });

  it('closes after 15:30 IST', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 0, 0))).toBe(true);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 1, 0))).toBe(false);
  });

  it('is closed on weekends', () => {
    // Saturday 15 Aug 2026, 11:00 IST = 05:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 15, 5, 30, 0))).toBe(false);
    // Sunday 16 Aug 2026, 11:00 IST
    expect(isNseRegularSession(Date.UTC(2026, 7, 16, 5, 30, 0))).toBe(false);
  });
});

describe('classifyQuoteStatus / delayed-data resilience (A–D)', () => {
  const openNow = Date.UTC(2026, 7, 14, 4, 30, 0); // Fri 10:00 IST
  const closedNow = Date.UTC(2026, 7, 14, 12, 0, 0); // Fri 17:30 IST

  it('A: 0–30s → LIVE; freshness alone does not block', () => {
    const status = classifyQuoteStatus(openNow - 5_000, openNow);
    expect(status).toBe('LIVE');
    expect(isUsableForLiveTrading(status)).toBe(true);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('A edge: exactly 30s → LIVE', () => {
    expect(classifyQuoteStatus(openNow - DEFAULT_FRESH_QUOTE_MAX_AGE_MS, openNow)).toBe('LIVE');
  });

  it('B: >30–60s → DELAYED; intel usable; provenance preserved; no freshness-only block', () => {
    const status = classifyQuoteStatus(openNow - DEFAULT_FRESH_QUOTE_MAX_AGE_MS - 1, openNow);
    expect(status).toBe('DELAYED');
    expect(isUsableForLiveTrading(status)).toBe(true);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('B edge: exactly 60s → DELAYED', () => {
    expect(classifyQuoteStatus(openNow - DEFAULT_LIVE_QUOTE_MAX_AGE_MS, openNow)).toBe('DELAYED');
  });

  it('C: >60s → STALE; intel labeled; freshness blocks live trading flag', () => {
    const status = classifyQuoteStatus(openNow - DEFAULT_LIVE_QUOTE_MAX_AGE_MS - 1, openNow);
    expect(status).toBe('STALE');
    expect(isUsableForLiveTrading(status)).toBe(false);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('D: missing/invalid → UNKNOWN; not neutralized; freshness blocks', () => {
    expect(classifyQuoteStatus(null, openNow)).toBe('UNKNOWN');
    expect(classifyQuoteStatus(0, openNow)).toBe('UNKNOWN');
    expect(isUsableForLiveTrading('UNKNOWN')).toBe(false);
    expect(isUsableForAnalysis('UNKNOWN')).toBe(true);
  });

  it('marks any quote as CLOSED_MARKET when session is closed', () => {
    const status = classifyQuoteStatus(closedNow - 1_000, closedNow);
    expect(status).toBe('CLOSED_MARKET');
    expect(isUsableForLiveTrading(status)).toBe(false);
    expect(isUsableForAnalysis(status)).toBe(true);
  });

  it('resolves ingest mode from provider flags', () => {
    expect(resolveActiveIngestMode({ liveProviderEnabled: true, simulatedLiveFeed: false })).toBe(
      'LIVE_INGEST',
    );
    expect(resolveActiveIngestMode({ liveProviderEnabled: false, simulatedLiveFeed: true })).toBe(
      'LIVE_INGEST',
    );
    expect(resolveActiveIngestMode({ liveProviderEnabled: false, simulatedLiveFeed: false })).toBe(
      'EOD_INGEST',
    );
  });
});

function baseDecision(overrides: Partial<TradeDecision> = {}): TradeDecision {
  const now = overrides.createdAt ?? Date.now();
  return {
    decisionId: 'd1',
    symbol: 'RELIANCE',
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
    ttlMs: 300_000,
    quoteTimestamp: overrides.quoteTimestamp ?? now,
    ...overrides,
  };
}

describe('DELAYED must never bypass Risk (freshness gate still 60s)', () => {
  const now = Date.UTC(2026, 7, 14, 4, 30, 0);

  it('B: delayed quote age ≤60s is not blocked by DATA_STALE alone', () => {
    const decision = baseDecision({
      createdAt: now,
      quoteTimestamp: now - 45_000,
    });
    const verdict = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      now,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('C: age >60s still DATA_STALE via existing Risk path', () => {
    const decision = baseDecision({
      createdAt: now,
      quoteTimestamp: now - 60_001,
    });
    const verdict = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      now,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toContain('DATA_STALE');
    }
  });

  it('DELAYED still subject to other Risk blocks (e.g. kill switch)', () => {
    const decision = baseDecision({
      createdAt: now,
      quoteTimestamp: now - 45_000,
    });
    const verdict = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: true,
      now,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toContain('KILL_SWITCH');
      expect(verdict.blockedBy).not.toContain('DATA_STALE');
    }
  });
});
