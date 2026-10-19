/**
 * MI-4: create() Combined Preflight gate — BLOCK before persist / runLoop.
 */

import { BadRequestException } from '@nestjs/common';
import type { CombinedBatchPreflightV2, PreflightBlockedErrorBody } from '@stockpred/shared-types';
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

import { writeIntelligenceBatch } from './intelligence-batch-store';

function blockedPreflight(): CombinedBatchPreflightV2 {
  return {
    canRun: false,
    blockers: ['MARKET_DATA_INSUFFICIENT', 'FUNDAMENTALS_INSUFFICIENT'],
    warnings: [],
    universe: { requested: 50, resolved: 50, unresolved: 0, mismatched: 0 },
    marketData: {
      mode: 'REQUIRED',
      available: 12,
      requiredCount: 50,
      coverage: 'PARTIAL',
      freshness: 'UNKNOWN',
    },
    historical: {
      mode: 'REQUIRED',
      available: 12,
      requiredCount: 50,
      coverage: 'PARTIAL',
      freshness: 'UNKNOWN',
    },
    intelligence: {
      fundamentals: {
        mode: 'REQUIRED',
        available: 0,
        requiredCount: 50,
        coverage: 'MISSING',
        freshness: 'UNKNOWN',
      },
      news: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 50,
        coverage: 'MISSING',
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
        requiredCount: 50,
        coverage: 'MISSING',
        freshness: 'UNKNOWN',
      },
      macro: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 1,
        coverage: 'MISSING',
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
    generatedAt: '2026-09-01T00:00:00.000Z',
    asOf: '2026-09-01T00:00:00.000Z',
  };
}

describe('MI-4 IntelligenceBatchService.create preflight gate', () => {
  const noopMiBatch = {
    buildAndPersist: jest.fn(),
  } as unknown as MiBatchSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('BLOCK: throws PREFLIGHT_BLOCKED, does not write batch or start runLoop', async () => {
    const run = jest.fn(async (_cfg: unknown) => blockedPreflight());
    const mi = { run } as unknown as MiCombinedPreflightService;
    const service = new IntelligenceBatchService({} as AgentService, mi, noopMiBatch);
    const runLoopSpy = jest
      .spyOn(service as unknown as { runLoop: (id: string) => Promise<void> }, 'runLoop')
      .mockResolvedValue(undefined);

    let caught: BadRequestException | undefined;
    try {
      await service.create({
        universe: 'NIFTY50',
        analysisPeriod: '3M',
        analysisResolution: '1D',
        predictionHorizon: '1M',
        mode: 'HISTORICAL',
        miMode: 'STANDARD',
      });
    } catch (err) {
      caught = err as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const body = caught!.getResponse() as PreflightBlockedErrorBody;
    expect(body.code).toBe('PREFLIGHT_BLOCKED');
    expect(body.blockers).toContain('MARKET_DATA_INSUFFICIENT');
    expect(run).toHaveBeenCalledTimes(1);
    const pfArg = run.mock.calls[0]?.[0] as {
      lockedMembershipSymbols?: string[];
      mode?: string;
    };
    expect(pfArg?.lockedMembershipSymbols).toHaveLength(50);
    expect(pfArg?.mode).toBe('STANDARD'); // miMode — not HISTORICAL
    expect(writeIntelligenceBatch).not.toHaveBeenCalled();
    expect(runLoopSpy).not.toHaveBeenCalled();
  });

  it('PASS: persists QUEUED and invokes runLoop', async () => {
    const pass = { ...blockedPreflight(), canRun: true, blockers: [] };
    const run = jest.fn(async () => pass);
    const mi = { run } as unknown as MiCombinedPreflightService;
    const service = new IntelligenceBatchService({} as AgentService, mi, noopMiBatch);
    const runLoopSpy = jest
      .spyOn(service as unknown as { runLoop: (id: string) => Promise<void> }, 'runLoop')
      .mockResolvedValue(undefined);

    const batch = await service.create({
      universe: 'NIFTY50',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
    });

    expect(batch.status).toBe('QUEUED');
    expect(batch.batchId).toMatch(/^IBATCH-/);
    expect(writeIntelligenceBatch).toHaveBeenCalled();
    expect(runLoopSpy).toHaveBeenCalledWith(batch.batchId);
  });

  it('UNSUPPORTED universe skips Combined Preflight', async () => {
    const run = jest.fn();
    const mi = { run } as unknown as MiCombinedPreflightService;
    // US_ALL will fail gated membership — use NIFTY150 which is MI-unsupported but resolves via nifty snapshot
    // NIFTY150 is in create DTO and resolveIntelligenceUniverse supports it via canonicalNiftySnapshot
    const service = new IntelligenceBatchService({} as AgentService, mi, noopMiBatch);
    const runLoopSpy = jest
      .spyOn(service as unknown as { runLoop: (id: string) => Promise<void> }, 'runLoop')
      .mockResolvedValue(undefined);

    const batch = await service.create({
      universe: 'NIFTY150',
      analysisPeriod: '3M',
      mode: 'HISTORICAL',
    });

    expect(run).not.toHaveBeenCalled();
    expect(batch.status).toBe('QUEUED');
    expect(runLoopSpy).toHaveBeenCalled();
  });
});
