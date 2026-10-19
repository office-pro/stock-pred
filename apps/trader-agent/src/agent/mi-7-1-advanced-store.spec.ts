/**
 * MI-7.1 — AdvancedIntelligenceSnapshot persist round-trip (contracts only).
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nseEquityInstrumentRef } from '@stockpred/shared-utils';
import { buildEmptyAdvancedIntelligenceSnapshot } from '@stockpred/shared-utils';
import {
  readAdvancedIntelligenceSnapshot,
  writeAdvancedIntelligenceSnapshot,
} from './intelligence-batch-store';

describe('MI-7.1 advanced snapshot store round-trip', () => {
  const prevRepo = process.env.REPO_ROOT;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mi71-adv-'));
    process.env.REPO_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRepo === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = prevRepo;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('write/read preserves canonical identities', () => {
    const snap = buildEmptyAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-RT',
      batchId: 'IBATCH-RT',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      marketIntelligenceSnapshotId: 'MI-RT',
      asOf: '2026-09-26T00:00:00.000Z',
      instruments: [nseEquityInstrumentRef('TCS')],
      generatedAt: '2026-09-26T01:00:00.000Z',
    });
    writeAdvancedIntelligenceSnapshot(snap);
    const loaded = readAdvancedIntelligenceSnapshot('IBATCH-RT');
    expect(loaded).toEqual(snap);
    expect(loaded?.dataSnapshotVersion).toBe('batch-data-snapshot.v1');
    expect(loaded?.marketIntelligenceSnapshotId).toBe('MI-RT');
    expect(loaded?.snapshotId).toBe('ADV-RT');
  });
});
