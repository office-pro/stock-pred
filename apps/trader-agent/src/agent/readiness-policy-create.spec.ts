/**
 * readiness-policy.v1 — create gate, frozen eligibility, and finalize outcome.
 * Does not alter Risk / Portfolio / Policy / Gate.
 */

import { BadRequestException } from '@nestjs/common';
import type {
  CombinedBatchPreflightV2,
  IntelligenceBatch,
  IntelligenceBatchResults,
  PreflightBlockedErrorBody,
  ReadinessEligibilitySummary,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import type { AgentService } from './agent.service';
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

const ELIGIBLE_SUBSET: ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
};

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

const noopMiBatch = { buildAndPersist: jest.fn() } as unknown as MiBatchSnapshotService;

function serviceWith(run: jest.Mock) {
  const service = new IntelligenceBatchService(
    {} as AgentService,
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
): Promise<BadRequestException> {
  try {
    await service.create(req);
  } catch (err) {
    return err as BadRequestException;
  }
  throw new Error('expected create to throw');
}

describe('readiness-policy.v1 create gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no policy: STRICT_ALL path unchanged — no policy sent to preflight or persisted', async () => {
    const run = jest.fn(async (_cfg: unknown) => preflight());
    const { service } = serviceWith(run);
    const batch = await service.create({
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
    });
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('readinessPolicy');
    expect(batch).not.toHaveProperty('readinessPolicy');
    expect(batch).not.toHaveProperty('readinessEligibility');
  });

  it('invalid policy → 400 before preflight', async () => {
    const run = jest.fn();
    const { service, runLoop } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: { id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v1' },
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'READINESS_POLICY_MINIMUMS_REQUIRED',
      message: 'ELIGIBLE_SUBSET requires minimums (minEligibleCount, minEligibleFraction)',
    });
    expect(run).not.toHaveBeenCalled();
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('ELIGIBLE_SUBSET on a universe without Combined Preflight → 400', async () => {
    const run = jest.fn();
    const { service } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY150',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'READINESS_POLICY_UNSUPPORTED_UNIVERSE',
      message: 'ELIGIBLE_SUBSET requires a Combined Preflight universe; NIFTY150 is not supported',
    });
    expect(run).not.toHaveBeenCalled();
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
  });

  it('unknown policy version → 400 { code: READINESS_POLICY_UNKNOWN_VERSION }', async () => {
    const run = jest.fn();
    const { service } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: { ...ELIGIBLE_SUBSET, version: 'readiness-policy.v0' as never },
    });
    expect(err.getStatus()).toBe(400);
    expect((err.getResponse() as { code: string }).code).toBe('READINESS_POLICY_UNKNOWN_VERSION');
    expect(run).not.toHaveBeenCalled();
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
  });

  it('internal failure during normalization is rethrown unchanged, not a 400', async () => {
    const run = jest.fn();
    const { service, runLoop } = serviceWith(run);
    const internal = new TypeError('internal failure');
    const readinessPolicy = {
      id: 'ELIGIBLE_SUBSET',
      get version(): string {
        throw internal;
      },
    };
    const err: unknown = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: readinessPolicy as never,
    });
    expect(err).toBe(internal);
    expect(err).not.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('ES-05: preflight BLOCKED with NO_ELIGIBLE_INSTRUMENTS → create rejected, nothing persisted', async () => {
    const run = jest.fn(async (_cfg: unknown) =>
      preflight({
        canRun: false,
        blockers: ['NO_ELIGIBLE_INSTRUMENTS'],
        readinessPolicy: ELIGIBLE_SUBSET,
        eligibility: eligibility(0),
      }),
    );
    const { service, runLoop } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    const body = err.getResponse() as PreflightBlockedErrorBody;
    expect(body.code).toBe('PREFLIGHT_BLOCKED');
    expect(body.blockers).toEqual(['NO_ELIGIBLE_INSTRUMENTS']);
    expect(body.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expect(run.mock.calls[0]?.[0]).toMatchObject({ readinessPolicy: ELIGIBLE_SUBSET });
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('ES-13 race: eligible at preflight, zero ELIGIBLE at create → rejected with outcome, nothing persisted', async () => {
    const run = jest.fn(async () =>
      preflight({ readinessPolicy: ELIGIBLE_SUBSET, eligibility: eligibility(0) }),
    );
    const { service, runLoop } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    const body = err.getResponse() as PreflightBlockedErrorBody;
    expect(body.blockers).toContain('NO_ELIGIBLE_INSTRUMENTS');
    expect(body.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expect(body.combinedPreflight.canRun).toBe(false);
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
    expect(writeIntelligenceBatchResults).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it('ES-18: HISTORICAL_FAILURE_THRESHOLD_EXCEEDED blocks create without a NO_ELIGIBLE outcome', async () => {
    const run = jest.fn(async () =>
      preflight({
        canRun: false,
        blockers: ['HISTORICAL_FAILURE_THRESHOLD_EXCEEDED'],
        readinessPolicy: ELIGIBLE_SUBSET,
        eligibility: eligibility(39),
      }),
    );
    const { service } = serviceWith(run);
    const err = await createError(service, {
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    const body = err.getResponse() as PreflightBlockedErrorBody;
    expect(body.blockers).toEqual(['HISTORICAL_FAILURE_THRESHOLD_EXCEEDED']);
    expect(body).not.toHaveProperty('outcome');
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
  });

  it('PASS: policy and frozen eligibility persisted; membership stays the full universe', async () => {
    const frozen = eligibility(48);
    const run = jest.fn(async () =>
      preflight({ readinessPolicy: ELIGIBLE_SUBSET, eligibility: frozen }),
    );
    const { service, runLoop } = serviceWith(run);
    const batch = await service.create({
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    expect(batch.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    expect(batch.readinessEligibility).toEqual(frozen);
    expect(batch.symbols).toHaveLength(50);
    expect(batch.tasks).toHaveLength(50);
    expect(runLoop).toHaveBeenCalledWith(batch.batchId);
  });
});

describe('readiness-policy.v1 finalize (persisted batch, terminal outcome)', () => {
  beforeEach(() => jest.clearAllMocks());

  function finalizeHarness(
    tasks: Array<{ symbol: string; status: string; error?: string }>,
    summary: ReadinessEligibilitySummary,
  ) {
    const batch = {
      schemaVersion: 'intelligence-batch.v1',
      batchId: 'IBATCH-ES13',
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
        totalEligible: 2,
        total: 2,
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

    const agent = {
      resetBatchMdsCircuit: jest.fn(),
      refreshMlPredictionsForIntelligenceBatch: jest.fn(async () => ({ loaded: 0 })),
      fetchTiMarketContextForIntelligenceBatch: jest.fn(async () => null),
      analyzeForIntelligenceBatch: jest.fn(),
    } as unknown as AgentService;
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
    return { agent, finalize };
  }

  it('every task skipped as readiness-ineligible → rankings [] and outcome NO_ELIGIBLE_INSTRUMENTS', async () => {
    const summary: ReadinessEligibilitySummary = {
      ...eligibility(0),
      universeTotal: 2,
      ineligible: 2,
      ineligibleByReason: { QUOTE_STALE: 2 },
      instruments: [
        { symbol: 'AAA', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
        { symbol: 'BBB', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
      ],
    };
    const { agent, finalize } = finalizeHarness(
      [
        { symbol: 'AAA', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
        { symbol: 'BBB', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
      ],
      summary,
    );
    await finalize();

    expect(writeIntelligenceBatchResults).toHaveBeenCalledTimes(1);
    const results = (writeIntelligenceBatchResults as jest.Mock).mock
      .calls[0][0] as IntelligenceBatchResults;
    expect(results.rankings).toEqual([]);
    expect(results.outcome).toBe('NO_ELIGIBLE_INSTRUMENTS');
    expect(results.ineligible).toEqual([
      { symbol: 'AAA', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
      { symbol: 'BBB', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
    ]);
    expect(agent.analyzeForIntelligenceBatch).not.toHaveBeenCalled();
    const finalWrite = (writeIntelligenceBatch as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as IntelligenceBatch;
    expect(finalWrite.status).toBe('COMPLETED');
    expect(finalWrite.resultsArtifactId).toBe('IBATCH-ES13.results');
  });

  it('failed analysis keeps FAILED; never labelled NO_ELIGIBLE_INSTRUMENTS', async () => {
    const summary: ReadinessEligibilitySummary = {
      ...eligibility(1),
      universeTotal: 2,
      ineligible: 1,
      ineligibleByReason: { QUOTE_STALE: 1 },
      instruments: [
        { symbol: 'AAA', state: 'ELIGIBLE', reasons: [] },
        { symbol: 'BBB', state: 'INELIGIBLE', reasons: ['QUOTE_STALE'] },
      ],
    };
    const { finalize } = finalizeHarness(
      [
        { symbol: 'AAA', status: 'FAILED', error: 'analysis timeout' },
        { symbol: 'BBB', status: 'SKIPPED', error: 'READINESS_INELIGIBLE:QUOTE_STALE' },
      ],
      summary,
    );
    await finalize();

    expect(writeIntelligenceBatchResults).not.toHaveBeenCalled();
    const finalWrite = (writeIntelligenceBatch as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as IntelligenceBatch;
    expect(finalWrite.status).toBe('FAILED');
    expect(finalWrite.resultsArtifactId).toBeUndefined();
  });
});
