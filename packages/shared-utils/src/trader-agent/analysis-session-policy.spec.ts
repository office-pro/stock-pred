/**
 * Slice G — analysis-session.v1 contract tests.
 * readiness-policy.v1 and 15m CURRENT_MARKET rules must remain unchanged.
 */

import {
  ANALYSIS_SESSION_VERSION,
  type CombinedBatchPreflightV2,
  type MiPreflightReasonCode,
} from '@stockpred/shared-types';
import {
  actionabilityForAnalysisSession,
  applyAnalysisSessionToPreflight,
  coerceStoredAnalysisSession,
  normalizeAnalysisSession,
  quoteFreshnessPolicyForAnalysisSession,
  resolveAnalysisQuoteProvenance,
  AnalysisSessionError,
} from './analysis-session-policy';
import { applyTradePlanExecutionReady } from './intelligence-batch-context';
import type { IntelligenceBatchContextLabels } from '@stockpred/shared-types';

function basePreflight(
  overrides: Partial<CombinedBatchPreflightV2> = {},
): CombinedBatchPreflightV2 {
  return {
    canRun: false,
    universe: { requested: 2, resolved: 2, unresolved: 0, mismatched: 0 },
    marketData: {
      mode: 'REQUIRED',
      available: 2,
      requiredCount: 2,
      coverage: 'COMPLETE',
      freshness: 'STALE',
      reasonCodes: ['STALE_REQUIRED_DATA'],
    },
    historical: {
      mode: 'REQUIRED',
      available: 2,
      requiredCount: 2,
      coverage: 'COMPLETE',
      freshness: 'CURRENT',
    },
    intelligence: {
      fundamentals: {
        mode: 'REQUIRED',
        available: 2,
        requiredCount: 2,
        coverage: 'COMPLETE',
        freshness: 'CURRENT',
      },
      news: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      sentiment: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      corporateEvents: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      macro: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      social: {
        mode: 'NOT_APPLICABLE',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
    },
    blockers: ['STALE_REQUIRED_DATA'] as MiPreflightReasonCode[],
    warnings: [],
    generatedAt: new Date().toISOString(),
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

describe('analysis-session.v1 normalize/coerce', () => {
  it('omit → CURRENT_MARKET', () => {
    expect(normalizeAnalysisSession(undefined)).toEqual({
      id: 'CURRENT_MARKET',
      version: ANALYSIS_SESSION_VERSION,
    });
  });

  it('explicit OFF_SESSION_ANALYSIS accepted', () => {
    expect(
      normalizeAnalysisSession({
        id: 'OFF_SESSION_ANALYSIS',
        version: ANALYSIS_SESSION_VERSION,
      }),
    ).toEqual({ id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION });
  });

  it('rejects unknown version / id', () => {
    expect(() => normalizeAnalysisSession({ id: 'CURRENT_MARKET', version: 'wrong' })).toThrow(
      AnalysisSessionError,
    );
    expect(() =>
      normalizeAnalysisSession({ id: 'LIVE', version: ANALYSIS_SESSION_VERSION }),
    ).toThrow(AnalysisSessionError);
  });

  it('coerce never invents OFF_SESSION from garbage', () => {
    expect(coerceStoredAnalysisSession({ id: 'OFF_SESSION_ANALYSIS' }).id).toBe('CURRENT_MARKET');
  });
});

describe('analysis-session.v1 quote policy', () => {
  it('CURRENT_MARKET + closed → LATEST_AVAILABLE (overnight research)', () => {
    expect(
      quoteFreshnessPolicyForAnalysisSession({
        analysisSession: { id: 'CURRENT_MARKET', version: ANALYSIS_SESSION_VERSION },
        venueSessionOpen: false,
      }),
    ).toEqual({ mode: 'LATEST_AVAILABLE' });
  });

  it('CURRENT_MARKET + open → STRICT 15m', () => {
    expect(
      quoteFreshnessPolicyForAnalysisSession({
        analysisSession: { id: 'CURRENT_MARKET', version: ANALYSIS_SESSION_VERSION },
        venueSessionOpen: true,
      }),
    ).toEqual({ mode: 'STRICT', maxAgeMs: 15 * 60 * 1000 });
  });

  it('OFF_SESSION + closed → LATEST_AVAILABLE', () => {
    expect(
      quoteFreshnessPolicyForAnalysisSession({
        analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
        venueSessionOpen: false,
      }),
    ).toEqual({ mode: 'LATEST_AVAILABLE' });
  });

  it('OFF_SESSION + open → STRICT 15m (no laundering)', () => {
    expect(
      quoteFreshnessPolicyForAnalysisSession({
        analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
        venueSessionOpen: true,
      }),
    ).toEqual({ mode: 'STRICT', maxAgeMs: 15 * 60 * 1000 });
  });
});

describe('analysis-session.v1 provenance', () => {
  const tip = Date.parse('2026-10-16T10:00:00.000Z');
  const asOf = Date.parse('2026-10-18T12:00:00.000Z');

  it('closed session → OFF_SESSION; timestamp preserved', () => {
    const p = resolveAnalysisQuoteProvenance({
      asOfMs: asOf,
      latestQuoteTimestampMs: tip,
      venueSessionOpen: false,
    });
    expect(p.dataStatus).toBe('OFF_SESSION');
    expect(p.dataAsOfMs).toBe(tip);
    expect(p.dataAgeMs).toBe(asOf - tip);
  });

  it('open session + aged tip → STALE; timestamp preserved', () => {
    const p = resolveAnalysisQuoteProvenance({
      asOfMs: asOf,
      latestQuoteTimestampMs: tip,
      venueSessionOpen: true,
    });
    expect(p.dataStatus).toBe('STALE');
    expect(p.dataAsOfMs).toBe(tip);
  });
});

describe('analysis-session.v1 preflight apply', () => {
  it('CURRENT_MARKET + open + STALE: canRun false; research canAnalyze false (no laundering)', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight(),
      analysisSession: { id: 'CURRENT_MARKET', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: true,
      latestQuoteTimestampMs: Date.parse('2026-10-16T10:00:00.000Z'),
    });
    expect(out.canRun).toBe(false);
    expect(out.canAnalyze).toBe(false);
    expect(out.blockers).toContain('STALE_REQUIRED_DATA');
    expect(out.analysisActionability).toBe('NON_ACTIONABLE');
  });

  it('CURRENT_MARKET + open + partial coverage: research canAnalyze; canRun false', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight({
        canRun: false,
        blockers: ['MARKET_DATA_INSUFFICIENT', 'FUNDAMENTALS_INSUFFICIENT'],
        marketData: {
          mode: 'REQUIRED',
          available: 499,
          requiredCount: 500,
          coverage: 'PARTIAL',
          freshness: 'CURRENT',
        },
      }),
      analysisSession: { id: 'CURRENT_MARKET', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: true,
      latestQuoteTimestampMs: Date.now(),
    });
    expect(out.canRun).toBe(false);
    expect(out.canAnalyze).toBe(true);
    expect(out.blockers).toEqual([]);
    expect(out.analysisActionability).toBe('NON_ACTIONABLE');
  });

  it('CURRENT_MARKET + closed: research canAnalyze; canRun false; NON_ACTIONABLE', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight({
        blockers: [
          'MARKET_DATA_INSUFFICIENT',
          'STALE_REQUIRED_DATA',
          'HISTORICAL_DATA_INSUFFICIENT',
          'FUNDAMENTALS_INSUFFICIENT',
        ],
        marketData: {
          mode: 'REQUIRED',
          available: 499,
          requiredCount: 500,
          coverage: 'PARTIAL',
          freshness: 'STALE',
        },
        historical: {
          mode: 'REQUIRED',
          available: 400,
          requiredCount: 500,
          coverage: 'PARTIAL',
          freshness: 'CURRENT',
        },
      }),
      analysisSession: { id: 'CURRENT_MARKET', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: false,
      latestQuoteTimestampMs: Date.parse('2026-10-16T10:00:00.000Z'),
    });
    expect(out.canRun).toBe(false);
    expect(out.canAnalyze).toBe(true);
    expect(out.blockers).toEqual([]);
    expect(out.analysisSession?.id).toBe('CURRENT_MARKET');
    expect(out.analysisActionability).toBe('NON_ACTIONABLE');
  });

  it('OFF_SESSION + closed: canAnalyze true; canRun false; NON_ACTIONABLE', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight({
        blockers: ['STALE_REQUIRED_DATA', 'NO_ELIGIBLE_INSTRUMENTS'],
      }),
      analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: false,
      latestQuoteTimestampMs: Date.parse('2026-10-16T10:00:00.000Z'),
    });
    expect(out.canRun).toBe(false);
    expect(out.canAnalyze).toBe(true);
    expect(out.blockers).not.toContain('STALE_REQUIRED_DATA');
    expect(out.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(out.analysisActionability).toBe('NON_ACTIONABLE');
    expect(out.quoteProvenance?.dataStatus).toBe('OFF_SESSION');
    expect(actionabilityForAnalysisSession(out.analysisSession!)).toBe('NON_ACTIONABLE');
  });

  it('OFF_SESSION + open + STALE: still blocked', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight(),
      analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: true,
      latestQuoteTimestampMs: Date.parse('2026-10-16T10:00:00.000Z'),
    });
    expect(out.canAnalyze).toBe(false);
    expect(out.canRun).toBe(false);
    expect(out.blockers).toContain('STALE_REQUIRED_DATA');
  });

  it('OFF_SESSION integrity failure still blocks research', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight({
        blockers: ['MARKET_DATA_INSUFFICIENT', 'STALE_REQUIRED_DATA'],
        marketData: {
          mode: 'REQUIRED',
          available: 0,
          requiredCount: 2,
          coverage: 'MISSING',
          freshness: 'UNKNOWN',
        },
      }),
      analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: false,
    });
    expect(out.canAnalyze).toBe(false);
    expect(out.blockers).toContain('MARKET_DATA_INSUFFICIENT');
  });

  it('OFF_SESSION + closed: STRICT partial coverage demoted — canAnalyze true', () => {
    const out = applyAnalysisSessionToPreflight({
      combined: basePreflight({
        blockers: [
          'MARKET_DATA_INSUFFICIENT',
          'STALE_REQUIRED_DATA',
          'HISTORICAL_DATA_INSUFFICIENT',
          'FUNDAMENTALS_INSUFFICIENT',
        ],
        marketData: {
          mode: 'REQUIRED',
          available: 499,
          requiredCount: 500,
          coverage: 'PARTIAL',
          freshness: 'STALE',
          reasonCodes: ['STALE_REQUIRED_DATA', 'MARKET_DATA_INSUFFICIENT'],
        },
        historical: {
          mode: 'REQUIRED',
          available: 153,
          requiredCount: 500,
          coverage: 'PARTIAL',
          freshness: 'CURRENT',
        },
        intelligence: {
          ...basePreflight().intelligence,
          fundamentals: {
            mode: 'REQUIRED',
            available: 496,
            requiredCount: 500,
            coverage: 'PARTIAL',
            freshness: 'CURRENT',
          },
        },
      }),
      analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      venueSessionOpen: false,
      latestQuoteTimestampMs: Date.parse('2026-10-16T10:00:00.000Z'),
    });
    expect(out.canRun).toBe(false);
    expect(out.canAnalyze).toBe(true);
    expect(out.blockers).toEqual([]);
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        'MARKET_DATA_INSUFFICIENT',
        'STALE_REQUIRED_DATA',
        'HISTORICAL_DATA_INSUFFICIENT',
        'FUNDAMENTALS_INSUFFICIENT',
      ]),
    );
    expect(out.analysisActionability).toBe('NON_ACTIONABLE');
  });
});

describe('analysis-session.v1 executionReady isolation', () => {
  it('researchNonActionable forces tradePlanExecutionReady false', () => {
    const labels: IntelligenceBatchContextLabels = {
      tradePlanRecommendation: 'APPROVE',
      tradePlanStatus: 'COMPLETE',
      researchNonActionable: true,
    };
    applyTradePlanExecutionReady(labels);
    expect(labels.tradePlanExecutionReady).toBe(false);
  });
});
