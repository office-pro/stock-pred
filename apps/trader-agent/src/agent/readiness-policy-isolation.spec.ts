/**
 * ES-15 — readiness-policy.v1 isolation at the trader-agent boundary.
 * Legacy create is unchanged without a policy; ELIGIBLE_SUBSET adds only frozen
 * eligibility; no readiness path reaches Decision → Risk → Portfolio → DecisionPolicy →
 * Gate → Execution; failures never become a successful empty batch.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { BadRequestException, HttpException } from '@nestjs/common';
import type {
  CombinedBatchPreflightV2,
  IntelligenceBatch,
  IntelligenceBatchResults,
  PreflightBlockedErrorBody,
  ReadinessEligibilitySummary,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import type { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { IntelligenceBatchService } from './intelligence-batch.service';
import type { MiCombinedPreflightService } from './mi-combined-preflight.service';
import type { MiBatchSnapshotService } from './mi-batch-snapshot.service';

jest.mock('@stockpred/database', () => ({
  canonicalInstrumentExists: jest.fn(() => true),
  resolveGatedCanonicalUniverse: jest.fn(() => ({ supported: false })),
  resolveNseAllMembership: jest.fn(() => {
    throw new Error('not needed');
  }),
}));

jest.mock('./intelligence-batch-store', () => ({
  writeIntelligenceBatch: jest.fn(),
  listIntelligenceBatches: jest.fn(() => []),
  readIntelligenceBatch: jest.fn(),
  readIntelligenceBatchResults: jest.fn(),
  recoverInterruptedBatches: jest.fn(() => []),
  writeIntelligenceBatchResults: jest.fn(),
  writeIntelligenceBatchResearchReport: jest.fn(),
  writeBatchDataSnapshot: jest.fn(),
  readBatchDataSnapshot: jest.fn(),
  readIntelligenceBatchResearchReport: jest.fn(),
  readLatestIntelligenceBatchResearchReport: jest.fn(),
  findPriorSameUniverseResearchReport: jest.fn(),
  writeMarketIntelligenceBatchSnapshot: jest.fn(),
  readMarketIntelligenceBatchSnapshot: jest.fn(),
  writeAdvancedIntelligenceSnapshot: jest.fn(),
  readAdvancedIntelligenceSnapshot: jest.fn(),
}));

jest.mock('./focus-universe-store', () => ({ writeFocusUniverseBatch: jest.fn() }));

import {
  readIntelligenceBatch,
  writeIntelligenceBatch,
  writeIntelligenceBatchResults,
} from './intelligence-batch-store';

const STRICT_ALL: ReadinessPolicy = { id: 'STRICT_ALL', version: 'readiness-policy.v1' };
const ELIGIBLE_SUBSET: ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
};

/** Agent methods that belong to the authorization / execution chain or operator controls. */
const FORBIDDEN_AGENT_METHOD =
  /evaluateTrade|evaluateRisk|evaluatePortfolio|applyDecisionPolicy|gate|order|execut|approv|submit|place|kill|arm|setMode|decisionMode|tradingEnabled|broker/i;

function leg(available: number, requiredCount: number) {
  return {
    mode: 'REQUIRED' as const,
    available,
    requiredCount,
    coverage: available >= requiredCount ? ('COMPLETE' as const) : ('PARTIAL' as const),
    freshness: 'UNKNOWN' as const,
  };
}

function preflight(overrides: Partial<CombinedBatchPreflightV2> = {}): CombinedBatchPreflightV2 {
  const optional = { ...leg(0, 50), mode: 'OPTIONAL' as const };
  return {
    canRun: true,
    blockers: [],
    warnings: [],
    universe: { requested: 50, resolved: 50, unresolved: 0, mismatched: 0 },
    marketData: leg(50, 50),
    historical: leg(50, 50),
    intelligence: {
      fundamentals: leg(50, 50),
      news: optional,
      sentiment: optional,
      corporateEvents: optional,
      macro: optional,
      social: { ...optional, mode: 'NOT_APPLICABLE' },
    },
    generatedAt: '2026-09-01T00:00:00.000Z',
    asOf: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function eligibility(eligible: number): ReadinessEligibilitySummary {
  return {
    policy: ELIGIBLE_SUBSET,
    universeTotal: 50,
    eligible,
    analyzedNotPromotable: 0,
    ineligible: 50 - eligible,
    ineligibleByReason: eligible < 50 ? { QUOTE_STALE: 50 - eligible } : {},
    instruments: [],
  };
}

/** AgentService stand-in that records every method the batch service touches. */
function recordingAgent(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const called: string[] = [];
  const agent = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return (...args: unknown[]) => {
          called.push(prop);
          return overrides[prop]?.(...args);
        };
      },
    },
  ) as unknown as AgentService;
  return { agent, called };
}

const noopMiBatch = { buildAndPersist: jest.fn() } as unknown as MiBatchSnapshotService;

function serviceWith(run: jest.Mock, agent: AgentService = recordingAgent().agent) {
  const service = new IntelligenceBatchService(
    agent,
    { run } as unknown as MiCombinedPreflightService,
    noopMiBatch,
  );
  const runLoop = jest
    .spyOn(service as unknown as { runLoop: (id: string) => Promise<void> }, 'runLoop')
    .mockResolvedValue(undefined);
  return { service, runLoop };
}

async function createError(
  service: IntelligenceBatchService,
  req: Parameters<IntelligenceBatchService['create']>[0],
): Promise<unknown> {
  try {
    await service.create(req);
  } catch (err) {
    return err;
  }
  throw new Error('expected create to throw');
}

const NIFTY50 = { universe: 'NIFTY50', analysisPeriod: '3M', mode: 'HISTORICAL' } as const;

function expectNothingPersisted(runLoop: jest.SpyInstance) {
  expect(writeIntelligenceBatch).not.toHaveBeenCalled();
  expect(writeIntelligenceBatchResults).not.toHaveBeenCalled();
  expect(runLoop).not.toHaveBeenCalled();
}

describe('ES-15.1 legacy isolation at create', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('no policy + STRICT_ALL-blocked preflight → legacy 400 body (no readiness fields), nothing persisted', async () => {
    const run = jest.fn(async (_cfg: unknown) =>
      preflight({
        canRun: false,
        blockers: ['HISTORICAL_DATA_INSUFFICIENT'],
        historical: leg(48, 50),
      }),
    );
    const { service, runLoop } = serviceWith(run);
    const err = (await createError(service, { ...NIFTY50 })) as BadRequestException;
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse() as PreflightBlockedErrorBody;
    expect(Object.keys(body).sort()).toEqual(['blockers', 'code', 'combinedPreflight', 'message']);
    expect(body.blockers).toEqual(['HISTORICAL_DATA_INSUFFICIENT']);
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('readinessPolicy');
    expectNothingPersisted(runLoop);
  });

  it('no policy, STRICT_ALL, and ELIGIBLE_SUBSET persist the same batch apart from readiness fields', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    const frozen = eligibility(48);
    const create = async (readinessPolicy?: ReadinessPolicy) => {
      const run = jest.fn(async (_cfg: unknown) =>
        preflight(
          readinessPolicy?.id === 'ELIGIBLE_SUBSET'
            ? { readinessPolicy, eligibility: frozen }
            : readinessPolicy
              ? { readinessPolicy }
              : {},
        ),
      );
      const { service } = serviceWith(run);
      const batch = await service.create({
        ...NIFTY50,
        ...(readinessPolicy ? { readinessPolicy } : {}),
      });
      return { batch, cfg: run.mock.calls[0]?.[0] as Record<string, unknown> };
    };
    const legacy = await create();
    const strict = await create(STRICT_ALL);
    const subset = await create(ELIGIBLE_SUBSET);

    const strip = (b: IntelligenceBatch) => {
      const { readinessPolicy: _p, readinessEligibility: _e, ...rest } = b;
      return JSON.parse(JSON.stringify(rest)) as unknown;
    };
    expect(legacy.batch).not.toHaveProperty('readinessPolicy');
    expect(legacy.batch).not.toHaveProperty('readinessEligibility');
    expect(strict.batch.readinessPolicy).toEqual(STRICT_ALL);
    expect(strict.batch).not.toHaveProperty('readinessEligibility');
    expect(subset.batch.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    expect(subset.batch.readinessEligibility).toEqual(frozen);
    expect(strip(strict.batch)).toEqual(strip(legacy.batch));
    expect(strip(subset.batch)).toEqual(strip(legacy.batch));
    // Membership stays the full universe; every task is still PENDING at create.
    expect(subset.batch.symbols).toEqual(legacy.batch.symbols);
    expect(subset.batch.tasks.every((t) => t.status === 'PENDING')).toBe(true);

    const { readinessPolicy: _sp, ...strictCfg } = strict.cfg;
    const { readinessPolicy: _ep, ...subsetCfg } = subset.cfg;
    expect(legacy.cfg).not.toHaveProperty('readinessPolicy');
    expect(strictCfg).toEqual(legacy.cfg);
    expect(subsetCfg).toEqual(legacy.cfg);
  });
});

describe('ES-15.4 execution boundary', () => {
  const agentDir = __dirname;
  const read = (file: string) => readFileSync(join(agentDir, file), 'utf8');
  const READINESS_IDENTIFIERS =
    /\breadiness(Policy|Eligibility|State|DataCompleteness|StateBySymbol|PolicyError)|ReadinessPolicy|ReadinessEligibility|READINESS_(POLICY|INELIGIBLE)|InstrumentReadiness|applyFrozenReadinessToTasks|buildReadinessResultsSection|runReadinessPreflight|readiness-policy/;
  const AUTH_CHAIN_CALL =
    /\b(evaluateTrade|evaluateRisk|evaluatePortfolio|applyDecisionPolicy|simulateRevalidatingGate|liveCapsGateInput)\s*\(/;

  it('only the controller, batch service, and preflight service reference readiness', () => {
    const referencing = readdirSync(agentDir)
      .filter((f) => f.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(f))
      .filter((f) => READINESS_IDENTIFIERS.test(read(f)))
      .sort();
    expect(referencing).toEqual([
      'agent.controller.ts',
      'intelligence-batch-store.ts',
      'intelligence-batch.service.ts',
      'mi-batch-snapshot.service.ts',
      'mi-combined-preflight.service.ts',
    ]);
  });

  it('AgentService (Decision → Risk → Portfolio → Policy → Gate → Execution) has no readiness reference', () => {
    const src = read('agent.service.ts');
    expect(src).toMatch(AUTH_CHAIN_CALL);
    expect(READINESS_IDENTIFIERS.test(src)).toBe(false);
  });

  it('controller readiness references are confined to imports, the create DTO, and POST multi-asset/preflight', () => {
    const lines = read('agent.controller.ts').split(/\r?\n/);
    const classStart = lines.findIndex((l) => l.startsWith('export class AgentController'));
    const preflightStart = lines.findIndex((l) => l.includes("@Post('multi-asset/preflight')"));
    const preflightEnd = lines.findIndex(
      (l, i) => i > preflightStart && /^\s*@(Post|Get|Put|Patch|Delete)\(/.test(l),
    );
    expect(classStart).toBeGreaterThan(0);
    expect(preflightStart).toBeGreaterThan(classStart);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    const outside = lines
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => READINESS_IDENTIFIERS.test(text))
      .filter(
        ({ line }) =>
          line - 1 > classStart && !(line - 1 > preflightStart && line - 1 < preflightEnd),
      );
    expect(outside).toEqual([]);
  });

  it('batch and preflight services never call the authorization chain', () => {
    for (const file of ['intelligence-batch.service.ts', 'mi-combined-preflight.service.ts']) {
      expect({ file, calls: AUTH_CHAIN_CALL.test(read(file)) }).toEqual({ file, calls: false });
    }
  });

  it('batch service calls no execution / authorization methods on AgentService', () => {
    const called = [
      ...new Set(
        [...read('intelligence-batch.service.ts').matchAll(/this\.agent\.(\w+)/g)].map((m) => m[1]),
      ),
    ];
    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((name) => FORBIDDEN_AGENT_METHOD.test(name))).toEqual([]);
  });

  it('ELIGIBLE_SUBSET create touches no AgentService authorization method', async () => {
    const { agent, called } = recordingAgent();
    const run = jest.fn(async () =>
      preflight({ readinessPolicy: ELIGIBLE_SUBSET, eligibility: eligibility(48) }),
    );
    const { service } = serviceWith(run, agent);
    await service.create({ ...NIFTY50, readinessPolicy: ELIGIBLE_SUBSET });
    expect(called.filter((name) => FORBIDDEN_AGENT_METHOD.test(name))).toEqual([]);
  });
});

describe('ES-15.5 failure isolation at create and preflight', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['no policy', undefined],
    ['STRICT_ALL', STRICT_ALL],
    ['ELIGIBLE_SUBSET', ELIGIBLE_SUBSET],
  ] as const)(
    '%s: internal preflight failure is rethrown unchanged; nothing persisted',
    async (_n, policy) => {
      const internal = new Error('prisma connection reset');
      const run = jest.fn(async () => {
        throw internal;
      });
      const { service, runLoop } = serviceWith(run);
      const err = await createError(service, {
        ...NIFTY50,
        ...(policy ? { readinessPolicy: policy } : {}),
      });
      expect(err).toBe(internal);
      expect(err).not.toBeInstanceOf(HttpException);
      expectNothingPersisted(runLoop);
    },
  );

  it.each([
    'QUOTE_INVENTORY_UNAVAILABLE',
    'HISTORICAL_INVENTORY_UNAVAILABLE',
    'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
  ] as const)(
    'shared %s → 400 PREFLIGHT_BLOCKED, no NO_ELIGIBLE outcome, nothing persisted',
    async (code) => {
      const run = jest.fn(async () =>
        preflight({
          canRun: false,
          blockers: [code],
          readinessPolicy: ELIGIBLE_SUBSET,
          eligibility: eligibility(50),
        }),
      );
      const { service, runLoop } = serviceWith(run);
      const err = (await createError(service, {
        ...NIFTY50,
        readinessPolicy: ELIGIBLE_SUBSET,
      })) as BadRequestException;
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse() as PreflightBlockedErrorBody;
      expect(body.code).toBe('PREFLIGHT_BLOCKED');
      expect(body.blockers).toEqual([code]);
      expect(body).not.toHaveProperty('outcome');
      expectNothingPersisted(runLoop);
    },
  );

  it('ELIGIBLE_SUBSET verdict without an eligibility summary → rejected, never an unfiltered batch', async () => {
    const run = jest.fn(async () => preflight({ readinessPolicy: ELIGIBLE_SUBSET }));
    const { service, runLoop } = serviceWith(run);
    const err = (await createError(service, {
      ...NIFTY50,
      readinessPolicy: ELIGIBLE_SUBSET,
    })) as BadRequestException;
    const body = err.getResponse() as PreflightBlockedErrorBody;
    expect(body.blockers).toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(body.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expectNothingPersisted(runLoop);
  });

  it('controller preflight: internal failure propagates unchanged (not a 400)', async () => {
    const internal = new Error('inventory read crashed');
    const controller = Object.create(AgentController.prototype) as AgentController;
    (controller as unknown as { miCombinedPreflight: { run: jest.Mock } }).miCombinedPreflight = {
      run: jest.fn(async () => {
        throw internal;
      }),
    };
    await expect(
      controller.postCombinedBatchPreflight({
        universeType: 'NIFTY50',
        readinessPolicy: ELIGIBLE_SUBSET,
      } as never),
    ).rejects.toBe(internal);
  });
});

describe('ES-15.5 failure isolation at finalize', () => {
  beforeEach(() => jest.clearAllMocks());

  function finalizeHarness(
    tasks: Array<{ symbol: string; status: string; error?: string }>,
    summary: ReadinessEligibilitySummary,
  ) {
    const batch = {
      schemaVersion: 'intelligence-batch.v1',
      batchId: 'IBATCH-ES15',
      universe: 'NIFTY50',
      batchType: 'FULL_ANALYSIS',
      mode: 'HISTORICAL',
      status: 'RUNNING',
      symbols: tasks.map((t) => t.symbol),
      partitions: [],
      tasks: tasks.map((t) => ({ partitionId: 'P0', ...t })),
      checkpoint: {
        completedSymbols: [],
        failedSymbols: [],
        currentSymbol: null,
        partitionId: null,
        lastCheckpointAt: 0,
      },
      progress: {
        processed: 0,
        pending: 0,
        failed: 0,
        totalEligible: tasks.length,
        total: tasks.length,
        percent: 0,
        stages: [],
      },
      featureVersion: 'f',
      modelVersion: 'm',
      createdAt: 0,
      updatedAt: 0,
      readinessPolicy: ELIGIBLE_SUBSET,
      readinessEligibility: summary,
    } as unknown as IntelligenceBatch;
    (readIntelligenceBatch as jest.Mock).mockReturnValue(batch);

    const { agent, called } = recordingAgent();
    const service = new IntelligenceBatchService(
      agent,
      { run: jest.fn() } as unknown as MiCombinedPreflightService,
      noopMiBatch,
    );
    const finalize = () =>
      (
        service as unknown as {
          finalizeComplete: (b: IntelligenceBatch, q: Map<string, unknown>) => Promise<void>;
        }
      ).finalizeComplete(batch, new Map());
    const finalWrite = () =>
      (writeIntelligenceBatch as jest.Mock).mock.calls.at(-1)?.[0] as IntelligenceBatch;
    return { called, finalize, finalWrite };
  }

  const summaryOf = (
    instruments: ReadinessEligibilitySummary['instruments'],
  ): ReadinessEligibilitySummary => {
    const eligible = instruments.filter((i) => i.state === 'ELIGIBLE').length;
    const ineligible = instruments.filter((i) => i.state === 'INELIGIBLE').length;
    return {
      policy: ELIGIBLE_SUBSET,
      universeTotal: instruments.length,
      eligible,
      analyzedNotPromotable: instruments.length - eligible - ineligible,
      ineligible,
      ineligibleByReason: ineligible ? { QUOTE_STALE: ineligible } : {},
      instruments,
    };
  };

  it('every eligible analysis FAILED → batch FAILED, no results doc, no outcome', async () => {
    const { finalize, finalWrite, called } = finalizeHarness(
      [
        { symbol: 'AAA', status: 'FAILED', error: 'analysis timeout' },
        { symbol: 'BBB', status: 'FAILED', error: 'analysis timeout' },
      ],
      summaryOf([
        { symbol: 'AAA', state: 'ELIGIBLE', reasons: [] },
        { symbol: 'BBB', state: 'ANALYZED_NOT_PROMOTABLE', reasons: ['FUNDAMENTALS_INCOMPLETE'] },
      ]),
    );
    await finalize();
    expect(writeIntelligenceBatchResults).not.toHaveBeenCalled();
    expect(finalWrite().status).toBe('FAILED');
    expect(finalWrite().resultsArtifactId).toBeUndefined();
    expect(called.filter((name) => FORBIDDEN_AGENT_METHOD.test(name))).toEqual([]);
  });

  it('readiness skips plus a non-readiness skip → no NO_ELIGIBLE_INSTRUMENTS outcome', async () => {
    const { finalize, finalWrite } = finalizeHarness(
      [
        { symbol: 'AAA', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
        { symbol: 'BBB', status: 'SKIPPED', error: 'IDENTITY_MISMATCH' },
      ],
      summaryOf([
        { symbol: 'AAA', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
        { symbol: 'BBB', state: 'ELIGIBLE', reasons: [] },
      ]),
    );
    await finalize();
    expect(writeIntelligenceBatchResults).toHaveBeenCalledTimes(1);
    const results = (writeIntelligenceBatchResults as jest.Mock).mock
      .calls[0][0] as IntelligenceBatchResults;
    expect(results.outcome).toBeUndefined();
    expect(results.quarantined?.map((r) => r.symbol)).toEqual(['BBB']);
    expect(results.ineligible?.map((r) => r.symbol)).toEqual(['AAA']);
    expect(finalWrite().status).toBe('COMPLETED');
    expect(finalWrite().resultsArtifactId).toBe('IBATCH-ES15.results');
  });

  it('all readiness-skipped terminal outcome touches no AgentService authorization method', async () => {
    const { finalize, finalWrite, called } = finalizeHarness(
      [
        { symbol: 'AAA', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
        { symbol: 'BBB', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
      ],
      summaryOf([
        { symbol: 'AAA', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
        { symbol: 'BBB', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
      ]),
    );
    await finalize();
    const results = (writeIntelligenceBatchResults as jest.Mock).mock
      .calls[0][0] as IntelligenceBatchResults;
    expect(results.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expect(results.rankings).toEqual([]);
    expect(finalWrite().status).toBe('COMPLETED');
    expect(called).not.toContain('analyzeForIntelligenceBatch');
    expect(called.filter((name) => FORBIDDEN_AGENT_METHOD.test(name))).toEqual([]);
  });
});
