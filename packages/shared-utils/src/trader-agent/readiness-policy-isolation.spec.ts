/**
 * ES-15 — readiness-policy.v1 isolation boundaries.
 * ELIGIBLE_SUBSET may change only readiness-based instrument eligibility and batch
 * outcomes. It never adds a recommendation or order-authorization path and never
 * touches Decision → Risk → Portfolio → DecisionPolicy → Gate → Execution.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type {
  AgentAnalysis,
  BatchPreflightConfiguration,
  CombinedBatchPreflightV2,
  IntelligenceBatchResultRow,
  ReadinessEligibilitySummary,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
} from './index';
import {
  naInventory,
  runCombinedBatchPreflight,
  type CapabilityInventory,
  type CombinedPreflightInventories,
} from './mi-combined-preflight';
import { resolveDataRequirementPlan } from './mi-data-requirement-plan';
import * as readinessModule from './readiness-policy';
import {
  applyFrozenReadinessToTasks,
  buildReadinessResultsSection,
  normalizeReadinessPolicy,
  readinessDataCompleteness,
  runReadinessPreflight,
} from './readiness-policy';
import {
  applyRecommendationEligibility,
  evaluateBatchRecommendationEligibility,
} from './batch-recommendation-eligibility';
import { buildBatchResearchReport, isBestOpportunityRow } from './batch-research-report';
import {
  buildPreflightBlockedErrorBody,
  mapCreateRequestToBatchPreflightConfiguration,
} from './mi-create-preflight-map';

const AS_OF = '2026-09-01T12:00:00.000Z';
const FRESH = '2026-09-01T11:55:00.000Z';
const STALE = '2026-08-29T10:00:00.000Z';

const STRICT_ALL: ReadinessPolicy = { id: 'STRICT_ALL', version: 'readiness-policy.v1' };
const ELIGIBLE_SUBSET: ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.8 },
};

const SYMBOLS = Array.from({ length: 20 }, (_, i) => `ISO${String(i + 1).padStart(2, '0')}`);

const config: BatchPreflightConfiguration = {
  universeType: 'CUSTOM',
  customSymbols: SYMBOLS,
  analysisPeriod: { value: 3, unit: 'M' },
  resolution: '1D',
  predictionHorizon: { value: 1, unit: 'M' },
  mode: 'STANDARD',
  asOf: AS_OF,
};
const plan = resolveDataRequirementPlan(config);
const MIN_BARS = plan.historical.minimumBarsPerInstrument;

interface Spec {
  quote?: 'ok' | 'missing' | 'stale';
  bars?: number | 'fail';
  fundamentals?: boolean;
}

interface Failures {
  quote?: boolean;
  historical?: boolean;
  fundamentals?: boolean;
}

function inventories(
  specOf: (symbol: string, index: number) => Spec,
  failed: Failures = {},
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
    const bars = s.bars ?? MIN_BARS;
    if (bars === 'fail') hist[sym] = { ok: false, reason: 'HISTORICAL_FETCH_FAILED' };
    else if (bars >= MIN_BARS) {
      hist[sym] = { ok: true };
      histAvail += 1;
    } else {
      hist[sym] = {
        ok: false,
        reason: bars === 0 ? 'NO_HISTORY' : `INSUFFICIENT_HISTORY:${bars}<${MIN_BARS}`,
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
      available: failed.quote ? 0 : mdAvail,
      requiredCount: n,
      latestTimestamp: failed.quote ? null : latest,
      freshnessApplicable: !failed.quote && latest != null,
      perInstrument: md,
      ...(failed.quote
        ? { inventoryReasons: ['QUOTE_INVENTORY_UNAVAILABLE' as const], readFailed: true }
        : {}),
    },
    historical: {
      available: failed.historical ? 0 : histAvail,
      requiredCount: n,
      freshnessApplicable: false,
      perInstrument: hist,
      ...(failed.historical ? { readFailed: true } : {}),
    },
    fundamentals: {
      available: failed.fundamentals ? 0 : fundAvail,
      requiredCount: n,
      latestTimestamp: '2026-08-01T00:00:00.000Z',
      freshnessApplicable: true,
      perInstrument: fund,
      ...(failed.fundamentals ? { readFailed: true } : {}),
    },
    news: { available: 0, requiredCount: n, freshnessApplicable: false },
    sentiment: { available: 0, requiredCount: 0, freshnessApplicable: false },
    corporateEvents: { available: 0, requiredCount: n, freshnessApplicable: false },
    macro: { available: 0, requiredCount: 1, freshnessApplicable: false },
    social: naInventory(),
  };
}

/** ISO01: no quote + no history. ISO02: short history. ISO03: fundamentals incomplete. */
function gapSpec(sym: string): Spec {
  if (sym === 'ISO01') return { quote: 'missing', bars: 0 };
  if (sym === 'ISO02') return { bars: 10 };
  if (sym === 'ISO03') return { fundamentals: false };
  return {};
}

const SCENARIOS: Array<[string, CombinedPreflightInventories]> = [
  ['all clean', inventories(() => ({}))],
  ['per-instrument gaps', inventories(gapSpec)],
  ['every quote stale', inventories(() => ({ quote: 'stale' }))],
  ['quote inventory unreadable', inventories(() => ({}), { quote: true })],
  ['historical inventory unreadable', inventories(() => ({}), { historical: true })],
  ['fundamentals inventory unreadable', inventories(() => ({}), { fundamentals: true })],
];

function run(inv: CombinedPreflightInventories, readinessPolicy?: ReadinessPolicy) {
  return runReadinessPreflight({ plan, inventories: inv, readinessPolicy, generatedAt: AS_OF });
}

function strictOf(inv: CombinedPreflightInventories) {
  return runCombinedBatchPreflight({ plan, inventories: inv, generatedAt: AS_OF });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Keys of CombinedBatchPreflightV2 that a readiness policy is allowed to set. */
const POLICY_OWNED_KEYS = [
  'canRun',
  'blockers',
  'warnings',
  'readinessPolicy',
  'strictAll',
  'eligibility',
] as const;

function withoutPolicyOwnedKeys(r: CombinedBatchPreflightV2): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r };
  for (const k of POLICY_OWNED_KEYS) delete out[k];
  return out;
}

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const AUTHORIZATION_VOCABULARY = /order|execut|authori[sz]|approv|risk|portfolio|gate|rank|score/i;

describe('ES-15.1 legacy isolation: no policy / STRICT_ALL', () => {
  it.each(SCENARIOS)(
    '%s: no policy → byte-identical to runCombinedBatchPreflight',
    (_name, inv) => {
      const strict = strictOf(inv);
      const viaPolicy = run(inv);
      expect(viaPolicy).toEqual(strict);
      expect(JSON.stringify(viaPolicy)).toBe(JSON.stringify(strict));
    },
  );

  it.each(SCENARIOS)('%s: explicit STRICT_ALL adds only readinessPolicy', (_name, inv) => {
    const { readinessPolicy, ...rest } = run(inv, STRICT_ALL);
    expect(readinessPolicy).toEqual(STRICT_ALL);
    expect(rest).toEqual(strictOf(inv));
  });

  it.each(SCENARIOS)(
    '%s: perInstrument / readFailed never change the STRICT_ALL verdict',
    (_name, inv) => {
      const stripped = Object.fromEntries(
        Object.entries(inv).map(([k, v]) => {
          const { perInstrument: _p, readFailed: _r, ...legacy } = v as CapabilityInventory;
          return [k, legacy];
        }),
      ) as unknown as CombinedPreflightInventories;
      expect(strictOf(inv)).toEqual(strictOf(stripped));
      expect(run(inv)).toEqual(strictOf(stripped));
    },
  );

  it('STRICT_ALL still blocks per-instrument gaps that ELIGIBLE_SUBSET would admit', () => {
    const inv = inventories(gapSpec);
    expect(run(inv).canRun).toBe(false);
    expect(run(inv, STRICT_ALL).canRun).toBe(false);
    expect(run(inv, ELIGIBLE_SUBSET).canRun).toBe(true);
  });

  it('create mapping and blocked body carry no readiness fields without a policy', () => {
    const cfg = mapCreateRequestToBatchPreflightConfiguration({
      universeType: 'CUSTOM',
      resolvedSymbols: SYMBOLS,
    });
    expect(cfg).not.toHaveProperty('readinessPolicy');
    const body = buildPreflightBlockedErrorBody(run(inventories(gapSpec)));
    expect(Object.keys(body).sort()).toEqual(['blockers', 'code', 'combinedPreflight', 'message']);
    expect(normalizeReadinessPolicy(undefined)).toBeUndefined();
  });

  it('generate/finalize helpers are no-ops without an ELIGIBLE_SUBSET summary', () => {
    const tasks = SYMBOLS.map((symbol) => ({ symbol, status: 'PENDING' }));
    expect(applyFrozenReadinessToTasks(tasks, undefined, 1)).toBe(tasks);
    expect(applyFrozenReadinessToTasks(tasks, null, 1)).toBe(tasks);
    for (const dc of ['COMPLETE', 'PARTIAL', 'DATA_INCOMPLETE', 'UNKNOWN', null, undefined]) {
      expect(readinessDataCompleteness(undefined, dc)).toBe(dc);
    }
    expect(buildReadinessResultsSection({ tasks })).toEqual({});
    expect(buildReadinessResultsSection({ policy: STRICT_ALL, tasks })).toEqual({});
  });
});

describe('ES-15.2 eligibility isolation', () => {
  it.each(SCENARIOS)(
    '%s: ELIGIBLE_SUBSET changes only canRun / blockers / warnings / policy / eligibility',
    (_name, inv) => {
      const subset = run(inv, ELIGIBLE_SUBSET);
      expect(withoutPolicyOwnedKeys(subset)).toEqual(withoutPolicyOwnedKeys(strictOf(inv)));
    },
  );

  it.each(SCENARIOS)('%s: inputs are not mutated', (_name, inv) => {
    const frozenInv = deepFreeze(structuredClone(inv));
    const frozenPlan = deepFreeze(structuredClone(plan));
    expect(() =>
      runReadinessPreflight({
        plan: frozenPlan,
        inventories: frozenInv,
        readinessPolicy: ELIGIBLE_SUBSET,
        generatedAt: AS_OF,
      }),
    ).not.toThrow();
    expect(frozenInv).toEqual(inv);
  });

  it('output vocabulary carries no authorization, ranking, or score fields', () => {
    const subset = run(inventories(gapSpec), ELIGIBLE_SUBSET);
    const added = {
      readinessPolicy: subset.readinessPolicy,
      strictAll: subset.strictAll,
      eligibility: subset.eligibility,
    };
    const keys = [...allKeys(added)];
    expect(keys.filter((k) => AUTHORIZATION_VOCABULARY.test(k))).toEqual([]);
    const states = new Set(subset.eligibility!.instruments.map((i) => i.state));
    expect([...states].sort()).toEqual(['ANALYZED_NOT_PROMOTABLE', 'ELIGIBLE', 'INELIGIBLE']);
  });

  it('module exports are limited to the readiness contract', () => {
    expect(Object.keys(readinessModule).sort()).toEqual(
      [
        'ELIGIBLE_SUBSET_MAX_HISTORICAL_FETCH_FAILURE_PCT',
        'READINESS_INELIGIBLE_TASK_ERROR_PREFIX',
        'ReadinessPolicyError',
        'applyFrozenReadinessToTasks',
        'buildReadinessResultsSection',
        'coerceStoredReadinessPolicy',
        'normalizeReadinessPolicy',
        'readinessDataCompleteness',
        'readinessPolicyErrorBody',
        'readinessStateBySymbol',
        'runReadinessPreflight',
        'withMiSnapshotReadinessPolicy',
      ].sort(),
    );
  });

  it('readiness never upgrades evidence: only ANALYZED_NOT_PROMOTABLE changes dataCompleteness', () => {
    for (const dc of ['COMPLETE', 'PARTIAL', 'DATA_INCOMPLETE', 'UNKNOWN', null, undefined]) {
      expect(readinessDataCompleteness('ELIGIBLE', dc)).toBe(dc);
      expect(readinessDataCompleteness('INELIGIBLE', dc)).toBe(dc);
      expect(readinessDataCompleteness('ANALYZED_NOT_PROMOTABLE', dc)).toBe('DATA_INCOMPLETE');
    }
  });

  it('ELIGIBLE rows get exactly the legacy recommendation result', () => {
    for (const recommendation of ['APPROVE', 'WAIT', 'WATCH', 'NO_TRADE', 'REJECT', null]) {
      for (const dc of ['COMPLETE', 'PARTIAL', 'DATA_INCOMPLETE', 'UNKNOWN', null]) {
        const legacy = applyRecommendationEligibility({
          recommendation,
          eligibility: evaluateBatchRecommendationEligibility({ dataCompleteness: dc }),
        });
        const eligible = applyRecommendationEligibility({
          recommendation,
          eligibility: evaluateBatchRecommendationEligibility({
            dataCompleteness: readinessDataCompleteness('ELIGIBLE', dc),
          }),
        });
        expect(eligible).toEqual(legacy);
      }
    }
  });
});

describe('ES-15.3 recommendation integrity: ANALYZED_NOT_PROMOTABLE', () => {
  const RECOMMENDATIONS = [
    'APPROVE',
    'BUY',
    'approve',
    'WAIT',
    'WATCH',
    'NO_TRADE',
    'REJECT',
    null,
  ];
  const COMPLETENESS = ['COMPLETE', 'PARTIAL', 'DATA_INCOMPLETE', 'UNKNOWN', null, undefined];

  it('never yields an actionable APPROVE or Best Opportunity eligibility, for any input', () => {
    for (const recommendation of RECOMMENDATIONS) {
      for (const dc of COMPLETENESS) {
        const rec = applyRecommendationEligibility({
          recommendation,
          reasonCode: 'TRADE_PLAN_APPROVE',
          eligibility: evaluateBatchRecommendationEligibility({
            assetClass: 'EQUITY',
            dataCompleteness: readinessDataCompleteness('ANALYZED_NOT_PROMOTABLE', dc),
          }),
        });
        expect(rec.recommendation).not.toBe('APPROVE');
        expect(rec.bestOpportunityEligible).toBe(false);
      }
    }
  });

  /** Mirrors IntelligenceBatchService.finalizeComplete row assembly. */
  function finalizedRow(
    symbol: string,
    rank: number,
    readinessState: 'ELIGIBLE' | 'ANALYZED_NOT_PROMOTABLE',
  ): IntelligenceBatchResultRow {
    const eligibility = evaluateBatchRecommendationEligibility({
      assetClass: 'EQUITY',
      dataCompleteness: readinessDataCompleteness(readinessState, 'COMPLETE'),
    });
    const rec = applyRecommendationEligibility({
      recommendation: 'APPROVE',
      reasonCode: 'TRADE_PLAN_APPROVE',
      eligibility,
    });
    return {
      rank,
      symbol,
      opportunityId: `opp-${symbol}`,
      dataCompleteness: 'COMPLETE',
      recommendation: rec.recommendation,
      reasonCode: rec.reasonCode,
      reason: rec.reason,
      intelligenceContext: {
        tradePlanRecommendation: 'APPROVE',
        intelligenceLifecycleState: 'OPPORTUNITY',
        opportunityQuality: 'HIGH',
        bestOpportunityEligible: rec.bestOpportunityEligible,
      },
      readinessState,
    };
  }

  it('top-ranked ANALYZED_NOT_PROMOTABLE row is excluded from Best Opportunities; ELIGIBLE control stays', () => {
    const blocked = finalizedRow('ANP', 1, 'ANALYZED_NOT_PROMOTABLE');
    const control = finalizedRow('ELG', 2, 'ELIGIBLE');
    expect(blocked.recommendation).toBe('WATCH');
    expect(isBestOpportunityRow(blocked)).toBe(false);
    expect(isBestOpportunityRow(control)).toBe(true);

    const report = buildBatchResearchReport({
      batchId: 'IBATCH-ES15',
      completedAt: 1,
      universe: 'NIFTY500',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings: [blocked, control],
    });
    expect(report.bestOpportunities.map((o) => o.symbol)).toEqual(['ELG']);
    expect((report.bestPicks ?? []).map((o) => o.symbol)).toEqual(['ELG']);
    expect(report.opportunities?.find((o) => o.symbol === 'ANP')?.isBestPick).toBe(false);
  });
});

describe('ES-15.4 execution boundary', () => {
  function baseAnalysis(): AgentAnalysis {
    return {
      symbol: 'ISO01',
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
        instrument: 'ISO01',
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
      thesis: 'test',
      counterThesis: 'risk',
      invalidation: 'Close below stop',
      risks: [],
      action: 'Propose long',
      usedCapabilities: ['quotes'],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: Date.now(),
      disclaimer: 'test',
    } as AgentAnalysis;
  }

  function authChain(decision: ReturnType<typeof evaluateTrade>, operatingMode: 'PAPER' | 'LIVE') {
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    });
    const portfolio = evaluatePortfolio({
      decision,
      risk,
      portfolio: emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000),
    });
    const policy = applyDecisionPolicy({
      operatingMode,
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    return { risk, portfolio, policy };
  }

  function exerciseEveryReadinessPath(): void {
    const subset = run(inventories(gapSpec), ELIGIBLE_SUBSET);
    const summary = subset.eligibility as ReadinessEligibilitySummary;
    const tasks = SYMBOLS.map((symbol) => ({ symbol, status: 'PENDING' }));
    const skipped = applyFrozenReadinessToTasks(tasks, summary, 1);
    buildReadinessResultsSection({ policy: ELIGIBLE_SUBSET, summary, tasks: skipped });
    for (const row of summary.instruments) readinessDataCompleteness(row.state, 'COMPLETE');
    run(
      inventories(() => ({ quote: 'stale' })),
      ELIGIBLE_SUBSET,
    );
    run(
      inventories(() => ({}), { historical: true }),
      ELIGIBLE_SUBSET,
    );
  }

  it('Decision / Risk / Portfolio / DecisionPolicy are identical before and after readiness evaluation', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const paperBefore = authChain(decision, 'PAPER');
    const liveBefore = authChain(decision, 'LIVE');
    exerciseEveryReadinessPath();
    const decisionAfter = evaluateTrade({ analysis });
    expect(decisionAfter.intent).toBe(decision.intent);
    expect(decisionAfter.eligibility).toBe(decision.eligibility);
    expect(authChain(decision, 'PAPER')).toEqual(paperBefore);
    expect(authChain(decision, 'LIVE')).toEqual(liveBefore);
    expect(paperBefore.policy.outcome).toBe('AUTO_ACCEPTED');
    expect(liveBefore.policy.outcome).toBe('HUMAN_REQUIRED');
  });

  const SRC_ROOT = join(__dirname, '..');
  const READINESS_IDENTIFIERS =
    /\breadiness(Policy|Eligibility|State|DataCompleteness|StateBySymbol|PolicyError)|ReadinessPolicy|ReadinessEligibility|READINESS_(POLICY|INELIGIBLE)|InstrumentReadiness|applyFrozenReadinessToTasks|buildReadinessResultsSection|runReadinessPreflight|readiness-policy/;

  function productionSources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...productionSources(full));
      else if (/\.ts$/.test(name) && !/\.(spec|test|d)\.ts$/.test(name)) out.push(full);
    }
    return out;
  }

  it('readiness identifiers appear only in the readiness module, its create mapping, and the barrel', () => {
    const referencing = productionSources(SRC_ROOT)
      .filter((file) => READINESS_IDENTIFIERS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_ROOT, file).replace(/\\/g, '/'))
      .sort();
    expect(referencing).toEqual([
      'trader-agent/index.ts',
      'trader-agent/intelligence-batch-results-query.ts',
      'trader-agent/mi-create-preflight-map.ts',
      'trader-agent/readiness-policy.ts',
    ]);
  });

  it('authorization-chain modules do not reference readiness', () => {
    const chain = [
      'decision-engine.ts',
      'risk-engine.ts',
      'portfolio.ts',
      'portfolio-engine.ts',
      'decision-policy.ts',
      'gate-sim.ts',
      'execution-costs.ts',
      'execution-identity.ts',
    ];
    for (const file of chain) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect({ file, references: READINESS_IDENTIFIERS.test(src) }).toEqual({
        file,
        references: false,
      });
    }
  });

  it('readiness module imports only shared-types and the combined preflight', () => {
    const src = readFileSync(join(__dirname, 'readiness-policy.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./mi-combined-preflight', '@stockpred/shared-types']);
  });
});

describe('ES-15.5 failure isolation', () => {
  it.each([
    ['quote', { quote: true }, 'QUOTE_INVENTORY_UNAVAILABLE', 'QUOTE_'],
    [
      'historical',
      { historical: true },
      'HISTORICAL_INVENTORY_UNAVAILABLE',
      'HISTORICAL_FETCH_FAILED',
    ],
    ['fundamentals', { fundamentals: true }, 'FUNDAMENTALS_INVENTORY_UNAVAILABLE', 'FUNDAMENTALS_'],
  ] as const)(
    'shared %s inventory failure blocks; no instrument is excluded for it; not a NO_ELIGIBLE outcome',
    (_leg, failed, code, reasonPrefix) => {
      const r = run(
        inventories(() => ({}), failed),
        ELIGIBLE_SUBSET,
      );
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain(code);
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(
        r.eligibility!.instruments.some((i) => i.reasons.some((x) => x.startsWith(reasonPrefix))),
      ).toBe(false);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    },
  );

  it('all three shared inventories unreadable → each code reported; still blocked; no NO_ELIGIBLE', () => {
    const r = run(
      inventories(() => ({ quote: 'stale', bars: 0 }), {
        quote: true,
        historical: true,
        fundamentals: true,
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

  it.each([
    ['quote', { quote: true } as const, () => ({ bars: 0 }), 'QUOTE_INVENTORY_UNAVAILABLE'],
    [
      'historical',
      { historical: true } as const,
      () => ({ quote: 'stale' as const }),
      'HISTORICAL_INVENTORY_UNAVAILABLE',
    ],
    [
      'fundamentals',
      { fundamentals: true } as const,
      () => ({ quote: 'stale' as const }),
      'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
    ],
  ])(
    '%s outage + zero eligible from other legs → inventory precedence; no outcome',
    (_leg, failed, spec, code) => {
      const r = run(inventories(spec, failed), ELIGIBLE_SUBSET);
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain(code);
      expect(r.blockers).not.toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(r.eligibility!.eligible).toBe(0);
      expect(buildPreflightBlockedErrorBody(r)).not.toHaveProperty('outcome');
    },
  );

  it('zero ELIGIBLE always blocks, even with the loosest valid minimums', () => {
    const loosest: ReadinessPolicy = {
      ...ELIGIBLE_SUBSET,
      minimums: { minEligibleCount: 1, minEligibleFraction: Number.MIN_VALUE },
    };
    expect(normalizeReadinessPolicy(loosest)).toEqual(loosest);
    for (const spec of [
      () => ({ quote: 'stale' as const }),
      () => ({ bars: 0 }),
      () => ({ fundamentals: false }),
    ]) {
      const r = run(inventories(spec), loosest);
      expect(r.eligibility!.eligible).toBe(0);
      expect(r.canRun).toBe(false);
      expect(r.blockers).toContain('NO_ELIGIBLE_INSTRUMENTS');
      expect(buildPreflightBlockedErrorBody(r).outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    }
  });

  it('a persisted results section is never an empty success unless every task was readiness-skipped', () => {
    const summary = run(inventories(gapSpec), ELIGIBLE_SUBSET).eligibility!;
    const section = (tasks: Array<{ status: string; error?: string }>) =>
      buildReadinessResultsSection({ policy: ELIGIBLE_SUBSET, summary, tasks });
    expect(section([]).outcome).toBeUndefined();
    expect(section([{ status: 'FAILED', error: 'boom' }]).outcome).toBeUndefined();
    expect(section([{ status: 'SKIPPED', error: 'READINESS_INELIGIBLE' }]).outcome).toBeUndefined();
    expect(section([{ status: 'SKIPPED', error: 'NOT_READY' }]).outcome).toBeUndefined();
    expect(section([{ status: 'CANCELLED' }]).outcome).toBeUndefined();
  });

  it('policy validation never swallows internal errors as client errors', () => {
    const internal = new TypeError('internal failure');
    const hostile = {
      id: 'ELIGIBLE_SUBSET',
      get version(): string {
        throw internal;
      },
    };
    expect(() => normalizeReadinessPolicy(hostile)).toThrow(internal);
    expect(readinessModule.readinessPolicyErrorBody(internal)).toBeUndefined();
  });
});
