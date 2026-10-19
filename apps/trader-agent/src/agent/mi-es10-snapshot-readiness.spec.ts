/**
 * ES-10 — readiness policy survives MarketIntelligenceBatchSnapshot persist/retrieve.
 * Observe-only lineage; does not alter Risk / Portfolio / Policy / Gate.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nseEquityInstrumentRef } from '@stockpred/shared-utils';
import type { MarketIntelligenceBatchSnapshot, ReadinessPolicy } from '@stockpred/shared-types';
import {
  readMarketIntelligenceBatchSnapshot,
  writeMarketIntelligenceBatchSnapshot,
  intelligenceBatchesDir,
} from './intelligence-batch-store';
import { MiBatchSnapshotService } from './mi-batch-snapshot.service';

const ELIGIBLE_SUBSET: ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
};

function baseSnapshot(
  batchId: string,
  extra: Partial<MarketIntelligenceBatchSnapshot> = {},
): MarketIntelligenceBatchSnapshot {
  return {
    schemaVersion: 'mi-batch-snapshot.v1',
    snapshotId: `MI-${batchId}`,
    batchId,
    dataSnapshotVersion: 'batch-data-snapshot.v1',
    asOf: '2026-09-01T00:00:00.000Z',
    universeType: 'NIFTY50',
    instruments: [nseEquityInstrumentRef('TCS')],
    bySymbol: {
      TCS: {
        instrument: nseEquityInstrumentRef('TCS'),
        fundamentals: { status: 'UNAVAILABLE', facts: [] },
        news: { status: 'UNAVAILABLE', items: [] },
        corporateEvents: { status: 'UNAVAILABLE', items: [] },
        sentiment: { availability: 'NOT_APPLICABLE' },
      },
    },
    coverage: {
      fundamentalsAvailable: 0,
      newsAvailable: 0,
      sentimentAvailable: 0,
      corporateAvailable: 0,
      technicalAvailable: 0,
      eligible: 1,
    },
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

describe('ES-10 MI snapshot readinessPolicy persist/retrieve', () => {
  const prevRepo = process.env.REPO_ROOT;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mi-es10-'));
    process.env.REPO_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRepo === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepo;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trip preserves ELIGIBLE_SUBSET', () => {
    const snap = baseSnapshot('IBATCH-ES10', { readinessPolicy: ELIGIBLE_SUBSET });
    writeMarketIntelligenceBatchSnapshot(snap);
    const loaded = readMarketIntelligenceBatchSnapshot('IBATCH-ES10');
    expect(loaded?.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    expect(loaded?.snapshotId).toBe('MI-IBATCH-ES10');
  });

  it('legacy snapshot without readinessPolicy loads unchanged', () => {
    const snap = baseSnapshot('IBATCH-LEGACY');
    writeMarketIntelligenceBatchSnapshot(snap);
    const loaded = readMarketIntelligenceBatchSnapshot('IBATCH-LEGACY');
    expect(loaded).toEqual(snap);
    expect(loaded).not.toHaveProperty('readinessPolicy');
  });

  it('invalid / unsupported stored policy is dropped; snapshot still loads', () => {
    const dir = intelligenceBatchesDir();
    mkdirSync(dir, { recursive: true });
    const raw = {
      ...baseSnapshot('IBATCH-BAD'),
      readinessPolicy: {
        id: 'ELIGIBLE_SUBSET',
        version: 'readiness-policy.v9',
        minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
      },
    };
    writeFileSync(join(dir, 'IBATCH-BAD.mi-snapshot.json'), `${JSON.stringify(raw)}\n`, 'utf8');
    const loaded = readMarketIntelligenceBatchSnapshot('IBATCH-BAD');
    expect(loaded).not.toBeNull();
    expect(loaded).not.toHaveProperty('readinessPolicy');
    expect(loaded?.batchId).toBe('IBATCH-BAD');
  });

  it('missing-minimums ELIGIBLE_SUBSET is dropped on read', () => {
    const dir = intelligenceBatchesDir();
    const raw = {
      ...baseSnapshot('IBATCH-MIN'),
      readinessPolicy: { id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v1' },
    };
    writeFileSync(join(dir, 'IBATCH-MIN.mi-snapshot.json'), `${JSON.stringify(raw)}\n`, 'utf8');
    const loaded = readMarketIntelligenceBatchSnapshot('IBATCH-MIN');
    expect(loaded).not.toHaveProperty('readinessPolicy');
  });

  it('cache hit stamps missing policy without rebuilding MI facts', async () => {
    const existing = baseSnapshot('IBATCH-STAMP');
    writeMarketIntelligenceBatchSnapshot(existing);
    const service = new MiBatchSnapshotService();
    const dataSnapshot = {
      schemaVersion: 'batch-data-snapshot.v1' as const,
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      instruments: [
        {
          instrumentRef: nseEquityInstrumentRef('TCS'),
          quote: null,
          candles: [],
          dataStatus: 'PENDING' as const,
        },
      ],
      capabilityCoverage: [],
      frozen: true,
      frozenAt: 1,
    };
    const stamped = await service.buildAndPersist({
      batchId: 'IBATCH-STAMP',
      dataSnapshot: dataSnapshot as never,
      asOf: existing.asOf,
      universeType: 'NIFTY50',
      readinessPolicy: ELIGIBLE_SUBSET,
    });
    expect(stamped.snapshotId).toBe(existing.snapshotId);
    expect(stamped.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    const reloaded = readMarketIntelligenceBatchSnapshot('IBATCH-STAMP');
    expect(reloaded?.readinessPolicy).toEqual(ELIGIBLE_SUBSET);
    expect(reloaded?.snapshotId).toBe(existing.snapshotId);
  });
});
