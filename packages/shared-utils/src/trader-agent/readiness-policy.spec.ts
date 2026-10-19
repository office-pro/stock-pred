import type {
  BatchPreflightConfiguration,
  ReadinessEligibilitySummary,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import {
  naInventory,
  runCombinedBatchPreflight,
  type CapabilityInventory,
  type CombinedPreflightInventories,
} from './mi-combined-preflight';
import { resolveDataRequirementPlan } from './mi-data-requirement-plan';
import {
  applyFrozenReadinessToTasks,
  buildReadinessResultsSection,
  coerceStoredReadinessPolicy,
  normalizeReadinessPolicy,
  readinessDataCompleteness,
  readinessPolicyErrorBody,
  runReadinessPreflight,
  withMiSnapshotReadinessPolicy,
} from './readiness-policy';
import {
  applyRecommendationEligibility,
  evaluateBatchRecommendationEligibility,
} from './batch-recommendation-eligibility';
import { buildPreflightBlockedErrorBody } from './mi-create-preflight-map';

const AS_OF = '2026-09-01T12:00:00.000Z';
const FRESH = '2026-09-01T11:55:00.000Z';
const STALE = '2026-08-29T10:00:00.000Z';

const ELIGIBLE_SUBSET: ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
};

const SYMBOLS = Array.from({ length: 500 }, (_, i) => `SYM${String(i + 1).padStart(3, '0')}`);

function config(overrides: Partial<BatchPreflightConfiguration> = {}): BatchPreflightConfiguration {
  return {
    universeType: 'CUSTOM',
    customSymbols: SYMBOLS,
    analysisPeriod: { value: 3, unit: 'M' },
    resolution: '1D',
    predictionHorizon: { value: 1, unit: 'M' },
    mode: 'STANDARD',
    asOf: AS_OF,
    ...overrides,
  };
}

interface Spec {
  quote?: 'ok' | 'missing' | 'stale';
  /** Bar count, or 'fail' for a per-symbol read failure. */
  bars?: number | 'fail';
  fundamentals?: boolean;
}

/** Inventories whose counts and per-instrument outcomes agree, as the preflight service builds them. */
function inventories(
  minBars: number,
  specOf: (symbol: string, index: number) => Spec,
  extra: {
    quoteReadFailed?: boolean;
    historicalReadFailed?: boolean;
    fundamentalsReadFailed?: boolean;
  } = {},
): CombinedPreflightInventories {
  const md: NonNullable<CapabilityInventory['perInstrument']> = {};
  const hist: NonNullable<CapabilityInventory['perInstrument']> = {};
  const fund: NonNullable<CapabilityInventory['perInstrument']> = {};
  let mdAvail = 0;
  let histAvail = 0;
  let fundAvail = 0;
  let latest: string | null = null;
  SYMBOLS.forEach((sym, i) => {
    const s = specOf(sym, i);
    const quote = s.quote ?? 'ok';
    if (quote === 'missing') {
      md[sym] = { ok: false, reason: 'QUOTE_MISSING' };
    } else {
      const ts = quote === 'stale' ? STALE : FRESH;
      md[sym] = { ok: true, timestamp: ts };
      mdAvail += 1;
      if (!latest || ts > latest) latest = ts;
    }
    const bars = s.bars ?? minBars;
    if (bars === 'fail') hist[sym] = { ok: false, reason: 'HISTORICAL_FETCH_FAILED' };
    else if (bars >= minBars) {
      hist[sym] = { ok: true };
      histAvail += 1;
    } else {
      hist[sym] = {
        ok: false,
        reason: bars === 0 ? 'NO_HISTORY' : `INSUFFICIENT_HISTORY:${bars}<${minBars}`,
      };
    }
    if (s.fundamentals ?? true) {
      fund[sym] = { ok: true };
      fundAvail += 1;
    } else {
      fund[sym] = { ok: false, reason: 'FUNDAMENTALS_INCOMPLETE' };
    }
  });
  const n = SYMBOLS.length;
  return {
    marketData: {
      available: mdAvail,
      requiredCount: n,
      latestTimestamp: latest,
      freshnessApplicable: latest != null,
      perInstrument: md,
      ...(extra.quoteReadFailed
        ? { inventoryReasons: ['QUOTE_INVENTORY_UNAVAILABLE' as const], readFailed: true }
        : {}),
    },
    historical: {
      available: histAvail,
      requiredCount: n,
      freshnessApplicable: false,
      perInstrument: hist,
      ...(extra.historicalReadFailed ? { readFailed: true } : {}),
    },
    fundamentals: {
      available: fundAvail,
      requiredCount: n,
      latestTimestamp: '2026-08-01T00:00:00.000Z',
      freshnessApplicable: true,
      perInstrument: fund,
      ...(extra.fundamentalsReadFailed ? { readFailed: true } : {}),
    },
    news: { available: 0, requiredCount: n, freshnessApplicable: false },
    sentiment: { available: 0, requiredCount: 0, freshnessApplicable: false },
    corporateEvents: { available: 0, requiredCount: n, freshnessApplicable: false },
    macro: { available: 0, requiredCount: 1, freshnessApplicable: false },
    social: naInventory(),
  };
}

const plan = resolveDataRequirementPlan(config());
const MIN_BARS = plan.historical.minimumBarsPerInstrument;

/** Today's NIFTY500 gaps: 4 fundamentals-incomplete, 13 recent listings, 1 no quote + no history. */
const NIFTY500_FUND_INCOMPLETE = new Set(['SYM010', 'SYM020', 'SYM030', 'SYM040']);
const NIFTY500_RECENT = new Set(SYMBOLS.slice(100, 113));
const NIFTY500_NO_DATA = 'SYM500';
function nifty500Spec(sym: string): Spec {
  if (sym === NIFTY500_NO_DATA) return { quote: 'missing', bars: 0 };
  if (NIFTY500_RECENT.has(sym)) return { bars: 120 };
  if (NIFTY500_FUND_INCOMPLETE.has(sym)) return { fundamentals: false };
  return {};
}

function run(inv: CombinedPreflightInventories, readinessPolicy?: ReadinessPolicy) {
  return runReadinessPreflight({ plan, inventories: inv, readinessPolicy, generatedAt: AS_OF });
}

describe('readiness-policy.v1 — policy validation', () => {
  it('absent policy → undefined (STRICT_ALL behavior)', () => {
    expect(normalizeReadinessPolicy(undefined)).toBeUndefined();
    expect(normalizeReadinessPolicy(null)).toBeUndefined();
  });

  function rejection(raw: unknown) {
    try {
      normalizeReadinessPolicy(raw);
    } catch (err) {
      const body = readinessPolicyErrorBody(err);
      if (!body) throw new Error('expected a readiness-policy error');
      return body;
    }
    throw new Error('expected rejection');
  }

  it('rejects with a structured { code, message } body; message has no code prefix', () => {
    const version = rejection({
      id: 'ELIGIBLE_SUBSET',
      version: 'readiness-policy.v2',
      minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
    });
    expect(version).toEqual({
      code: 'READINESS_POLICY_UNKNOWN_VERSION',
      message:
        'Unsupported readiness policy version: expected readiness-policy.v1, got readiness-policy.v2',
    });
    expect(rejection({ id: 'SAMPLE', version: 'readiness-policy.v1' }).code).toBe(
      'READINESS_POLICY_UNKNOWN_ID',
    );
    const minimums = rejection({ id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v1' });
    expect(minimums.code).toBe('READINESS_POLICY_MINIMUMS_REQUIRED');
    expect(minimums.message).not.toMatch(/^READINESS_POLICY_/);
    expect(
      rejection({
        id: 'ELIGIBLE_SUBSET',
        version: 'readiness-policy.v1',
        minimums: { minEligibleCount: 0, minEligibleFraction: 0.9 },
      }),
    ).toEqual({
      code: 'READINESS_POLICY_INVALID',
      message: 'minEligibleCount must be an integer >= 1',
    });
    expect(
      rejection({
        id: 'ELIGIBLE_SUBSET',
        version: 'readiness-policy.v1',
        minimums: { minEligibleCount: 1, minEligibleFraction: 1.5 },
      }).code,
    ).toBe('READINESS_POLICY_INVALID');
    expect(rejection('ELIGIBLE_SUBSET').code).toBe('READINESS_POLICY_INVALID');
  });

  it('readinessPolicyErrorBody does not classify non-policy errors', () => {
    expect(readinessPolicyErrorBody(new Error('boom'))).toBeUndefined();
    expect(readinessPolicyErrorBody(new TypeError('x is undefined'))).toBeUndefined();
    expect(readinessPolicyErrorBody('boom')).toBeUndefined();
  });

  it('accepts explicit STRICT_ALL and a valid ELIGIBLE_SUBSET', () => {
    expect(normalizeReadinessPolicy({ id: 'STRICT_ALL', version: 'readiness-policy.v1' })).toEqual({
      id: 'STRICT_ALL',
      version: 'readiness-policy.v1',
    });
    expect(normalizeReadinessPolicy(ELIGIBLE_SUBSET)).toEqual(ELIGIBLE_SUBSET);
  });

  it('ES-10: coerceStoredReadinessPolicy accepts valid, drops invalid, treats missing as absent', () => {
    expect(coerceStoredReadinessPolicy(undefined)).toBeUndefined();
    expect(coerceStoredReadinessPolicy(null)).toBeUndefined();
    expect(coerceStoredReadinessPolicy(ELIGIBLE_SUBSET)).toEqual(ELIGIBLE_SUBSET);
    expect(
      coerceStoredReadinessPolicy({ id: 'STRICT_ALL', version: 'readiness-policy.v1' }),
    ).toEqual({ id: 'STRICT_ALL', version: 'readiness-policy.v1' });
    expect(
      coerceStoredReadinessPolicy({
        id: 'ELIGIBLE_SUBSET',
        version: 'readiness-policy.v9',
        minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
      }),
    ).toBeUndefined();
    expect(
      coerceStoredReadinessPolicy({ id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v1' }),
    ).toBeUndefined();
    expect(coerceStoredReadinessPolicy('STRICT_ALL')).toBeUndefined();
  });

  it('ES-10: withMiSnapshotReadinessPolicy attaches when present and never strips', () => {
    const base = { snapshotId: 'MI-1' };
    expect(withMiSnapshotReadinessPolicy(base, undefined)).toBe(base);
    expect(withMiSnapshotReadinessPolicy(base, ELIGIBLE_SUBSET)).toEqual({
      snapshotId: 'MI-1',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    const already = { snapshotId: 'MI-1', readinessPolicy: ELIGIBLE_SUBSET };
    expect(withMiSnapshotReadinessPolicy(already, undefined)).toBe(already);
  });
});

describe('readiness-policy.v1 — STRICT_ALL unchanged', () => {
  it('ES-01: no policy → output identical to runCombinedBatchPreflight', () => {
    const inv = inventories(MIN_BARS, nifty500Spec);
    const legacy = runCombinedBatchPreflight({ plan, inventories: inv, generatedAt: AS_OF });
    const viaPolicy = run(inv);
    expect(viaPolicy).toEqual(legacy);
    expect(viaPolicy).not.toHaveProperty('eligibility');
    expect(viaPolicy).not.toHaveProperty('strictAll');
    expect(viaPolicy).not.toHaveProperty('readinessPolicy');
  });

  it('ES-02: explicit STRICT_ALL with 486/500 history → BLOCKED HISTORICAL_DATA_INSUFFICIENT', () => {
    const r = run(inventories(MIN_BARS, nifty500Spec), {
      id: 'STRICT_ALL',
      version: 'readiness-policy.v1',
    });
    expect(r.canRun).toBe(false);
    expect(r.blockers).toContain('HISTORICAL_DATA_INSUFFICIENT');
    expect(r.historical.available).toBe(486);
    expect(r.eligibility).toBeUndefined();
  });
});

describe('readiness-policy.v1 — ELIGIBLE_SUBSET', () => {
  it('ES-03: NIFTY500 gaps → 482 ELIGIBLE / 4 ANALYZED_NOT_PROMOTABLE / 14 INELIGIBLE of 500', () => {
    const r = run(inventories(MIN_BARS, nifty500Spec), ELIGIBLE_SUBSET);
    const e = r.eligibility!;
    expect(e.universeTotal).toBe(500);
    expect(e.eligible).toBe(482);
    expect(e.analyzedNotPromotable).toBe(4);
    expect(e.ineligible).toBe(14);
    expect(e.instruments).toHaveLength(500);
    const noData = e.instruments.find((i) => i.symbol === NIFTY500_NO_DATA)!;
    expect(noData.state).toBe('INELIGIBLE');
    expect(noData.reasons).toEqual(expect.arrayContaining(['QUOTE_MISSING', 'NO_HISTORY']));
    const recent = e.instruments.filter((i) => NIFTY500_RECENT.has(i.symbol));
    expect(recent.every((i) => i.state === 'INELIGIBLE')).toBe(true);
    expect(recent[0].reasons).toEqual([`INSUFFICIENT_HISTORY:120<${MIN_BARS}`]);
    expect(e.ineligibleByReason.INSUFFICIENT_HISTORY).toBe(13);
    // Capability rows are unchanged; requiredCount stays the full universe.
    expect(r.historical.available).toBe(486);
    expect(r.historical.requiredCount).toBe(500);
    expect(r.canRun).toBe(true);
  });

  it('ES-04: fundamentals-incomplete symbols → ANALYZED_NOT_PROMOTABLE with FUNDAMENTALS_INCOMPLETE', () => {
    const r = run(inventories(MIN_BARS, nifty500Spec), ELIGIBLE_SUBSET);
    const rows = r.eligibility!.instruments.filter((i) => NIFTY500_FUND_INCOMPLETE.has(i.symbol));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.state).toBe('ANALYZED_NOT_PROMOTABLE');
      expect(row.reasons).toEqual(['FUNDAMENTALS_INCOMPLETE']);
    }
  });

  it('ES-04: ANALYZED_NOT_PROMOTABLE demotes APPROVE → WATCH and is not Best Opportunity eligible', () => {
    const eligibility = evaluateBatchRecommendationEligibility({
      dataCompleteness: readinessDataCompleteness('ANALYZED_NOT_PROMOTABLE', 'COMPLETE'),
    });
    const rec = applyRecommendationEligibility({ recommendation: 'APPROVE', eligibility });
    expect(rec.recommendation).toBe('WATCH');
    expect(rec.bestOpportunityEligible).toBe(false);
    expect(rec.recommendationEligibilityReason).toBe('DATA_INCOMPLETE');

    const eligibleRec = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      eligibility: evaluateBatchRecommendationEligibility({
        dataCompleteness: readinessDataCompleteness('ELIGIBLE', 'COMPLETE'),
      }),
    });
    expect(eligibleRec.recommendation).toBe('APPROVE');
    expect(eligibleRec.bestOpportunityEligible).toBe(true);
  });

  it('ES-05: every quote older than 15 min → all INELIGIBLE QUOTE_STALE; BLOCKED NO_ELIGIBLE_INSTRUMENTS', () => {
    const r = run(
      inventories(MIN_BARS, () => ({ quote: 'stale' })),
      ELIGIBLE_SUBSET,
    );
    expect(r.canRun).toBe(false);
    expect(r.blockers).toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(r.blockers).not.toContain('ELIGIBLE_SUBSET_BELOW_MINIMUM');
    expect(r.eligibility!.eligible).toBe(0);
    expect(r.eligibility!.ineligible).toBe(500);
    expect(r.eligibility!.instruments.every((i) => i.reasons.includes('QUOTE_STALE'))).toBe(true);
  });

  it('ES-06: quote inventory read failure → BLOCKED QUOTE_INVENTORY_UNAVAILABLE; nobody excluded for it', () => {
    const r = run(
      inventories(MIN_BARS, () => ({ quote: 'missing' }), { quoteReadFailed: true }),
      ELIGIBLE_SUBSET,
    );
    expect(r.canRun).toBe(false);
    expect(r.blockers).toContain('QUOTE_INVENTORY_UNAVAILABLE');
    expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(
      r.eligibility!.instruments.some((i) => i.reasons.some((x) => x.startsWith('QUOTE_'))),
    ).toBe(false);
    expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
  });

  describe('inventory outage takes precedence over NO_ELIGIBLE_INSTRUMENTS', () => {
    it('quote outage + zero eligible from history → inventory blocker only; no outcome', () => {
      const r = run(
        inventories(MIN_BARS, () => ({ bars: 0 }), { quoteReadFailed: true }),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain('QUOTE_INVENTORY_UNAVAILABLE');
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(r.eligibility!.eligible).toBe(0);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    });

    it('historical outage + zero eligible from stale quotes → inventory blocker only; no outcome', () => {
      const r = run(
        inventories(MIN_BARS, () => ({ quote: 'stale' }), { historicalReadFailed: true }),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain('HISTORICAL_INVENTORY_UNAVAILABLE');
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(r.eligibility!.eligible).toBe(0);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    });

    it('fundamentals outage + zero eligible from stale quotes → inventory blocker only; no outcome', () => {
      const r = run(
        inventories(MIN_BARS, () => ({ quote: 'stale' }), { fundamentalsReadFailed: true }),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain('FUNDAMENTALS_INVENTORY_UNAVAILABLE');
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(r.eligibility!.eligible).toBe(0);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    });

    it('all three outages → inventory codes only; no NO_ELIGIBLE outcome', () => {
      const r = run(
        inventories(MIN_BARS, () => ({ quote: 'stale', bars: 0, fundamentals: false }), {
          quoteReadFailed: true,
          historicalReadFailed: true,
          fundamentalsReadFailed: true,
        }),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toEqual(
        expect.arrayContaining([
          'QUOTE_INVENTORY_UNAVAILABLE',
          'HISTORICAL_INVENTORY_UNAVAILABLE',
          'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
        ]),
      );
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    });
  });

  describe('ES-07: minimums count only ELIGIBLE, over the full universe', () => {
    it('482/500 = 96.4% ≥ 90% → canRun', () => {
      const r = run(inventories(MIN_BARS, nifty500Spec), ELIGIBLE_SUBSET);
      expect(r.canRun).toBe(true);
      expect(r.blockers).toEqual([]);
      expect(r.eligibility!.eligible / r.eligibility!.universeTotal).toBeCloseTo(0.964, 3);
    });

    it('exactly 450/500 ELIGIBLE → canRun (boundary)', () => {
      const r = run(
        inventories(MIN_BARS, (_s, i) => (i < 50 ? { bars: 10 } : {})),
        ELIGIBLE_SUBSET,
      );
      expect(r.eligibility!.eligible).toBe(450);
      expect(r.canRun).toBe(true);
    });

    it('449 ELIGIBLE + 51 ANALYZED_NOT_PROMOTABLE → BLOCKED (ANALYZED_NOT_PROMOTABLE does not count)', () => {
      const r = run(
        inventories(MIN_BARS, (_s, i) => (i < 51 ? { fundamentals: false } : {})),
        ELIGIBLE_SUBSET,
      );
      expect(r.eligibility!.eligible).toBe(449);
      expect(r.eligibility!.analyzedNotPromotable).toBe(51);
      expect(r.canRun).toBe(false);
      expect(r.blockers).toEqual(['ELIGIBLE_SUBSET_BELOW_MINIMUM']);
    });

    it('eligible below minEligibleCount → BLOCKED', () => {
      const r = run(inventories(MIN_BARS, nifty500Spec), {
        ...ELIGIBLE_SUBSET,
        minimums: { minEligibleCount: 483, minEligibleFraction: 0.9 },
      });
      expect(r.canRun).toBe(false);
      expect(r.blockers).toEqual(['ELIGIBLE_SUBSET_BELOW_MINIMUM']);
    });
  });

  it('ES-08: strictAll carries the STRICT_ALL verdict for the same inputs', () => {
    const inv = inventories(MIN_BARS, nifty500Spec);
    const strict = runCombinedBatchPreflight({ plan, inventories: inv, generatedAt: AS_OF });
    const r = run(inv, ELIGIBLE_SUBSET);
    expect(r.strictAll).toEqual({ canRun: strict.canRun, blockers: strict.blockers });
    expect(r.strictAll!.canRun).toBe(false);
    expect(r.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    // Demoted capability blockers stay visible as warnings.
    expect(r.warnings).toEqual(expect.arrayContaining(['HISTORICAL_DATA_INSUFFICIENT']));
  });

  describe('ES-18: historical read failures above 2% of the universe block', () => {
    it('11 of 500 failures → BLOCKED HISTORICAL_FAILURE_THRESHOLD_EXCEEDED with count and denominator', () => {
      const r = run(
        inventories(MIN_BARS, (_s, i) => (i < 11 ? { bars: 'fail' } : {})),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toEqual(['HISTORICAL_FAILURE_THRESHOLD_EXCEEDED']);
      expect(r.blockers).not.toContain('HISTORICAL_INVENTORY_UNAVAILABLE');
      expect(r.eligibility!.ineligibleByReason.HISTORICAL_FETCH_FAILED).toBe(11);
      expect(r.eligibility!.universeTotal).toBe(500);
      expect(r.eligibility!.eligible).toBe(489);
    });

    it('10 of 500 failures (exactly 2%) → those INELIGIBLE with HISTORICAL_FETCH_FAILED; batch can run', () => {
      const r = run(
        inventories(MIN_BARS, (_s, i) => (i < 10 ? { bars: 'fail' } : {})),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(true);
      expect(r.blockers).toEqual([]);
      const failed = r.eligibility!.instruments.filter((i) => i.state === 'INELIGIBLE');
      expect(failed).toHaveLength(10);
      expect(failed.every((i) => i.reasons.includes('HISTORICAL_FETCH_FAILED'))).toBe(true);
      expect(r.eligibility!.ineligibleByReason.HISTORICAL_FETCH_FAILED).toBe(10);
    });

    it('shared historical inventory unreadable → HISTORICAL_INVENTORY_UNAVAILABLE, not the threshold code', () => {
      const r = run(
        inventories(MIN_BARS, () => ({}), { historicalReadFailed: true }),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toEqual(['HISTORICAL_INVENTORY_UNAVAILABLE']);
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(
        r.eligibility!.instruments.some((i) => i.reasons.includes('HISTORICAL_FETCH_FAILED')),
      ).toBe(false);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    });
  });

  it('shared fundamentals inventory unreadable → FUNDAMENTALS_INVENTORY_UNAVAILABLE; nobody demoted for it', () => {
    const r = run(
      inventories(MIN_BARS, () => ({ fundamentals: false }), { fundamentalsReadFailed: true }),
      ELIGIBLE_SUBSET,
    );
    expect(r.canRun).toBe(false);
    expect(r.blockers).toEqual(['FUNDAMENTALS_INVENTORY_UNAVAILABLE']);
    expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(r.eligibility!.analyzedNotPromotable).toBe(0);
    expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
  });
});

describe('readiness-policy.v1 — create rejection body', () => {
  it('ES-13: NO_ELIGIBLE_INSTRUMENTS rejection carries outcome', () => {
    const r = run(
      inventories(MIN_BARS, () => ({ quote: 'stale' })),
      ELIGIBLE_SUBSET,
    );
    const body = buildPreflightBlockedErrorBody(r);
    expect(body.code).toBe('PREFLIGHT_BLOCKED');
    expect(body.blockers).toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(body.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
  });

  it('other rejections (including STRICT_ALL) carry no outcome', () => {
    const strict = run(inventories(MIN_BARS, nifty500Spec));
    expect(buildPreflightBlockedErrorBody(strict)).not.toHaveProperty('outcome');
    const threshold = run(
      inventories(MIN_BARS, (_s, i) => (i < 11 ? { bars: 'fail' } : {})),
      ELIGIBLE_SUBSET,
    );
    expect(buildPreflightBlockedErrorBody(threshold)).not.toHaveProperty('outcome');
  });
});

describe('readiness-policy.v1 — generate helpers', () => {
  const summary: ReadinessEligibilitySummary = {
    policy: ELIGIBLE_SUBSET,
    universeTotal: 3,
    eligible: 1,
    analyzedNotPromotable: 1,
    ineligible: 1,
    ineligibleByReason: { QUOTE_STALE: 1 },
    instruments: [
      { symbol: 'AAA', state: 'ELIGIBLE', reasons: [] },
      { symbol: 'BBB', state: 'ANALYZED_NOT_PROMOTABLE', reasons: ['FUNDAMENTALS_INCOMPLETE'] },
      { symbol: 'CCC', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
    ],
  };

  it('frozen INELIGIBLE tasks are SKIPPED with reasons; others untouched', () => {
    const tasks = ['AAA', 'BBB', 'CCC'].map((symbol) => ({ symbol, status: 'PENDING' }));
    const out = applyFrozenReadinessToTasks(tasks, summary, 42);
    expect(out[0]).toBe(tasks[0]);
    expect(out[1]).toBe(tasks[1]);
    expect(out[2]).toEqual({
      symbol: 'CCC',
      status: 'SKIPPED',
      completedAt: 42,
      error: 'READINESS_INELIGIBLE:QUOTE_STALE',
    });
    expect(applyFrozenReadinessToTasks(tasks, undefined, 42)).toBe(tasks);
  });

  const skipped = (reason: string) => ({
    status: 'SKIPPED',
    error: `READINESS_INELIGIBLE:${reason}`,
  });

  it('persisted outcome only when every task was skipped as readiness-ineligible; ineligible rows carry no rank/score/recommendation', () => {
    const section = buildReadinessResultsSection({
      policy: ELIGIBLE_SUBSET,
      summary,
      tasks: [skipped('QUOTE_STALE'), skipped('QUOTE_STALE')],
    });
    expect(section.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expect(section.ineligible).toEqual([
      { symbol: 'CCC', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
    ]);
  });

  it('analyzed rows, failed analyses, or data-snapshot skips → no NO_ELIGIBLE_INSTRUMENTS outcome', () => {
    const outcomeFor = (tasks: Array<{ status: string; error?: string }>) =>
      buildReadinessResultsSection({ policy: ELIGIBLE_SUBSET, summary, tasks }).outcome;
    expect(outcomeFor([skipped('QUOTE_STALE'), { status: 'DONE' }])).toBeUndefined();
    expect(
      outcomeFor([skipped('QUOTE_STALE'), { status: 'FAILED', error: 'timeout' }]),
    ).toBeUndefined();
    expect(
      outcomeFor([skipped('QUOTE_STALE'), { status: 'SKIPPED', error: 'IDENTITY_MISMATCH' }]),
    ).toBeUndefined();
    expect(outcomeFor([])).toBeUndefined();
  });

  it('STRICT_ALL / no policy → no readiness fields', () => {
    const tasks = [skipped('QUOTE_STALE')];
    expect(buildReadinessResultsSection({ tasks })).toEqual({});
    expect(
      buildReadinessResultsSection({
        policy: { id: 'STRICT_ALL', version: 'readiness-policy.v1' },
        tasks,
      }),
    ).toEqual({});
  });
});
