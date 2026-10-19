import type { BatchPreflightConfiguration, DataRequirementPlan } from '@stockpred/shared-types';
import {
  classifyFreshness,
  emptyInventory,
  isPitEligibleDual,
  naInventory,
  runCombinedBatchPreflight,
  type CapabilityInventory,
  type CombinedPreflightInventories,
} from './mi-combined-preflight';
import { resolveDataRequirementPlan } from './mi-data-requirement-plan';
import { isPitEligible } from './mi-coverage-report';
import { sufficientDailyCandleLimit } from './historical-requirement';

function baseConfig(
  overrides: Partial<BatchPreflightConfiguration> = {},
): BatchPreflightConfiguration {
  return {
    universeType: 'CUSTOM',
    customSymbols: ['AAA', 'BBB'],
    analysisPeriod: { value: 3, unit: 'M' },
    resolution: '1D',
    predictionHorizon: { value: 1, unit: 'M' },
    mode: 'STANDARD',
    asOf: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function fullInventories(
  denom: number,
  overrides: Partial<CombinedPreflightInventories> = {},
): CombinedPreflightInventories {
  const ok = (n = denom): CapabilityInventory => ({
    available: n,
    requiredCount: n,
    latestTimestamp: '2026-09-01T11:55:00.000Z',
    freshnessApplicable: true,
  });
  return {
    marketData: ok(),
    historical: { available: denom, requiredCount: denom, freshnessApplicable: false },
    fundamentals: ok(),
    news: { available: 0, requiredCount: denom, freshnessApplicable: false },
    sentiment: { available: 0, requiredCount: 0, freshnessApplicable: false },
    corporateEvents: { available: 0, requiredCount: denom, freshnessApplicable: false },
    macro: {
      available: 1,
      requiredCount: 1,
      latestTimestamp: '2026-08-01T00:00:00.000Z',
      freshnessApplicable: true,
    },
    social: naInventory(),
    ...overrides,
  };
}

describe('MI-3 resolveDataRequirementPlan', () => {
  it('derives historical minBars from analysisPeriod (not hard-coded 263)', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({ analysisPeriod: { value: 1, unit: 'Y' } }),
    );
    const expected = sufficientDailyCandleLimit('1Y');
    expect(plan.historical.minimumBarsPerInstrument).toBe(expected.limit);
    expect(plan.historical.minimumBarsPerInstrument).not.toBe(263);
    expect(plan.historical.start).toBe(expected.startDate);
    expect(plan.universe.resolved.length).toBe(2);
  });

  it('STANDARD defaults: fundamentals REQUIRED, news OPTIONAL, social N/A', () => {
    const plan = resolveDataRequirementPlan(baseConfig({ mode: 'STANDARD' }));
    expect(plan.intelligence.fundamentals.mode).toBe('REQUIRED');
    expect(plan.intelligence.news.mode).toBe('OPTIONAL');
    expect(plan.intelligence.social.mode).toBe('NOT_APPLICABLE');
    expect(plan.marketData.freshness.mode).toBe('STRICT');
    expect(plan.intelligence.fundamentals.freshness.mode).toBe('LATEST_AVAILABLE');
    expect(plan.intelligence.news.freshness.mode).toBe('WINDOWED');
  });

  it('explicit intelligence flags override mode defaults', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({
        mode: 'STANDARD',
        intelligence: { news: false, fundamentals: true, social: true },
      }),
    );
    expect(plan.intelligence.news.mode).toBe('NOT_APPLICABLE');
    expect(plan.intelligence.fundamentals.mode).toBe('REQUIRED');
    expect(plan.intelligence.social.mode).toBe('REQUIRED');
    // news false → sentiment falls back to N/A when not explicit
    expect(plan.intelligence.sentiment.mode).toBe('NOT_APPLICABLE');
  });

  it('ADVANCED requires news/sentiment/corporate/macro', () => {
    const plan = resolveDataRequirementPlan(baseConfig({ mode: 'ADVANCED' }));
    expect(plan.intelligence.news.mode).toBe('REQUIRED');
    expect(plan.intelligence.sentiment.mode).toBe('REQUIRED');
    expect(plan.intelligence.corporateEvents.mode).toBe('REQUIRED');
    expect(plan.intelligence.macro.mode).toBe('REQUIRED');
  });

  it('counts IDENTITY_UNRESOLVED for non-ticker custom symbols', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({
        customSymbols: ['RELIANCE', 'Some Company Ltd', 'TCS'],
      }),
    );
    expect(plan.universe.requestedCount).toBe(3);
    expect(plan.universe.unresolved).toBe(1);
    expect(plan.universe.resolved.length).toBe(2);
  });
});

describe('MI-3 dual PIT', () => {
  it('requires both publishedAt and availableAt <= asOf', () => {
    const asOf = '2026-09-01T00:00:00.000Z';
    expect(isPitEligibleDual('2026-08-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z', asOf)).toBe(
      true,
    );
    expect(isPitEligibleDual('2026-09-02T00:00:00.000Z', '2026-08-15T00:00:00.000Z', asOf)).toBe(
      false,
    );
    expect(isPitEligibleDual('2026-08-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', asOf)).toBe(
      false,
    );
    expect(isPitEligibleDual(null, '2026-08-15T00:00:00.000Z', asOf)).toBe(false);
    expect(isPitEligibleDual('2026-08-01T00:00:00.000Z', null, asOf)).toBe(false);
    expect(isPitEligible('2026-08-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z', asOf)).toBe(true);
  });
});

describe('MI-3 freshness', () => {
  it('STRICT marks STALE past maxAge', () => {
    expect(
      classifyFreshness({
        policy: { mode: 'STRICT', maxAgeMs: 15 * 60 * 1000 },
        asOf: '2026-09-01T12:00:00.000Z',
        latestTimestamp: '2026-09-01T10:00:00.000Z',
      }),
    ).toBe('STALE');
  });

  it('LATEST_AVAILABLE is CURRENT when timestamp <= asOf', () => {
    expect(
      classifyFreshness({
        policy: { mode: 'LATEST_AVAILABLE' },
        asOf: '2026-09-01T12:00:00.000Z',
        latestTimestamp: '2025-01-01T00:00:00.000Z',
      }),
    ).toBe('CURRENT');
  });
});

describe('MI-3 runCombinedBatchPreflight', () => {
  it('PASS when integrity clean and required coverage complete', () => {
    const plan = resolveDataRequirementPlan(baseConfig());
    const result = runCombinedBatchPreflight({
      plan,
      inventories: fullInventories(2),
    });
    expect(result.canRun).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.marketData.coverage).toBe('COMPLETE');
    expect(result.warnings.some((w: string) => w === 'NEWS_INSUFFICIENT')).toBe(true);
  });

  it('BLOCK on UNIVERSE_IDENTITY_INCOMPLETE even if coverage looks full', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({ customSymbols: ['RELIANCE', 'Bad Name Corp'] }),
    );
    expect(plan.universe.unresolved).toBeGreaterThan(0);
    const denom = plan.universe.resolved.length;
    const result = runCombinedBatchPreflight({
      plan,
      inventories: fullInventories(denom),
    });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('UNIVERSE_IDENTITY_INCOMPLETE');
    expect(result.blockers).toContain('IDENTITY_UNRESOLVED');
  });

  it('BLOCK on MARKET_DATA_INSUFFICIENT', () => {
    const plan = resolveDataRequirementPlan(baseConfig());
    const inv = fullInventories(2, {
      marketData: { available: 1, requiredCount: 2, freshnessApplicable: false },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('MARKET_DATA_INSUFFICIENT');
  });

  it('surfaces QUOTE_INVENTORY_UNAVAILABLE so a failed quote read is not a silent zero', () => {
    const plan = resolveDataRequirementPlan(baseConfig());
    const inv = fullInventories(2, {
      marketData: {
        available: 0,
        requiredCount: 2,
        freshnessApplicable: false,
        inventoryReasons: ['QUOTE_INVENTORY_UNAVAILABLE'],
      },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('MARKET_DATA_INSUFFICIENT');
    expect(result.warnings).toContain('QUOTE_INVENTORY_UNAVAILABLE');
  });

  it('BLOCK on HISTORICAL_DATA_INSUFFICIENT', () => {
    const plan = resolveDataRequirementPlan(baseConfig());
    const inv = fullInventories(2, {
      historical: { available: 0, requiredCount: 2, freshnessApplicable: false },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('HISTORICAL_DATA_INSUFFICIENT');
  });

  it('BLOCK on STALE_REQUIRED_DATA for STRICT quotes', () => {
    const plan = resolveDataRequirementPlan(baseConfig());
    const inv = fullInventories(2, {
      marketData: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-09-01T08:00:00.000Z',
        freshnessApplicable: true,
      },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('STALE_REQUIRED_DATA');
  });

  it('BLOCK on FUNDAMENTALS_INSUFFICIENT when REQUIRED', () => {
    const plan = resolveDataRequirementPlan(baseConfig({ mode: 'STANDARD' }));
    const inv = fullInventories(2, {
      fundamentals: { available: 0, requiredCount: 2, freshnessApplicable: false },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('FUNDAMENTALS_INSUFFICIENT');
  });

  it('flag override news:false → NOT_APPLICABLE (no NEWS blocker)', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({
        mode: 'ADVANCED',
        intelligence: { news: false, sentiment: false },
      }),
    );
    expect(plan.intelligence.news.mode).toBe('NOT_APPLICABLE');
    const inv = fullInventories(2, {
      news: emptyInventory(0),
      sentiment: emptyInventory(0),
      corporateEvents: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-08-01T00:00:00.000Z',
        freshnessApplicable: true,
      },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.intelligence.news.mode).toBe('NOT_APPLICABLE');
    expect(result.blockers).not.toContain('NEWS_INSUFFICIENT');
  });

  it('sentiment N/A when no news (requiredCount 0) even if mode REQUIRED', () => {
    const plan = resolveDataRequirementPlan(baseConfig({ mode: 'ADVANCED' }));
    const inv = fullInventories(2, {
      news: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-08-20T00:00:00.000Z',
        freshnessApplicable: true,
      },
      sentiment: { available: 0, requiredCount: 0, freshnessApplicable: false },
      corporateEvents: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-08-01T00:00:00.000Z',
        freshnessApplicable: true,
      },
    });
    // Force sentiment mode REQUIRED with empty denom via inventory
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.intelligence.sentiment.coverage).toBe('COMPLETE');
  });

  it('SENTIMENT_UNAVAILABLE blocks when required and news exists without scores', () => {
    const plan = resolveDataRequirementPlan(baseConfig({ mode: 'ADVANCED' }));
    const inv = fullInventories(2, {
      news: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-08-20T00:00:00.000Z',
        freshnessApplicable: true,
      },
      sentiment: {
        available: 0,
        requiredCount: 2,
        freshnessApplicable: false,
        inventoryReasons: ['SENTIMENT_UNAVAILABLE'],
      },
      corporateEvents: {
        available: 2,
        requiredCount: 2,
        latestTimestamp: '2026-08-01T00:00:00.000Z',
        freshnessApplicable: true,
      },
    });
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('SENTIMENT_UNAVAILABLE');
  });

  it('mutated mismatched plan blocks with IDENTITY_MISMATCH', () => {
    const plan: DataRequirementPlan = resolveDataRequirementPlan(baseConfig());
    plan.universe.mismatched = 3;
    plan.universe.resolved = plan.universe.resolved.slice(0, 1);
    const result = runCombinedBatchPreflight({
      plan,
      inventories: fullInventories(1),
    });
    expect(result.canRun).toBe(false);
    expect(result.blockers).toContain('UNIVERSE_IDENTITY_INCOMPLETE');
    expect(result.blockers).toContain('IDENTITY_MISMATCH');
  });

  it('coverage denom uses RESOLVED only', () => {
    const plan = resolveDataRequirementPlan(
      baseConfig({ customSymbols: ['RELIANCE', 'Bad Name Corp', 'TCS'] }),
    );
    expect(plan.universe.resolved.length).toBe(2);
    const inv = fullInventories(2);
    const result = runCombinedBatchPreflight({ plan, inventories: inv });
    expect(result.marketData.requiredCount).toBe(2);
    expect(result.universe.requested).toBe(3);
    expect(result.universe.unresolved).toBe(1);
  });

  it('NIFTY50 smoke: plan → evaluator yields truthful canRun (not forced PASS)', () => {
    const plan = resolveDataRequirementPlan({
      universeType: 'NIFTY50',
      analysisPeriod: { value: 3, unit: 'M' },
      resolution: '1D',
      predictionHorizon: { value: 1, unit: 'M' },
      mode: 'STANDARD',
      asOf: '2026-09-01T12:00:00.000Z',
    });
    expect(plan.universe.resolved.length).toBe(50);
    expect(plan.historical.minimumBarsPerInstrument).toBeGreaterThan(200);

    // Sparse MD → BLOCK with MARKET_DATA_INSUFFICIENT (truthful, not forced PASS)
    const sparse = fullInventories(50, {
      marketData: {
        available: 12,
        requiredCount: 50,
        latestTimestamp: '2026-09-01T11:55:00.000Z',
        freshnessApplicable: true,
      },
      historical: { available: 12, requiredCount: 50, freshnessApplicable: false },
      fundamentals: { available: 10, requiredCount: 50, freshnessApplicable: false },
    });
    const blocked = runCombinedBatchPreflight({ plan, inventories: sparse });
    expect(blocked.canRun).toBe(false);
    expect(blocked.blockers).toContain('MARKET_DATA_INSUFFICIENT');
    expect(blocked.universe.resolved).toBe(50);

    // Full inventories → PASS for STANDARD (optional news warns)
    const full = fullInventories(50);
    const passed = runCombinedBatchPreflight({ plan, inventories: full });
    expect(passed.canRun).toBe(true);
    expect(passed.requirementPlan?.universeType).toBe('NIFTY50');
  });
});
