/**
 * MI-7.1 — AdvancedIntelligenceSnapshot contracts (no engines).
 */
import type { AdvancedIntelligenceSnapshot } from '@stockpred/shared-types';
import { ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import {
  ADVANCED_INTELLIGENCE_FEATURE_VERSION,
  buildEmptyAdvancedIntelligenceSnapshot,
  emptyAdvancedInstrumentIntelligence,
  isAdvancedSectionPresent,
  sectionHasFabricatedMissing,
  unavailableSection,
  validateAdvancedSnapshotLinkage,
} from './mi-advanced-contract';

describe('MI-7.1 AdvancedIntelligenceSnapshot contracts', () => {
  const instruments = [nseEquityInstrumentRef('AAA'), nseEquityInstrumentRef('BBB')];

  it('builds empty envelope with canonical identities (no MD snapshotId)', () => {
    const snap = buildEmptyAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-1',
      batchId: 'B1',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      marketIntelligenceSnapshotId: 'MI-1',
      asOf: '2026-09-26T00:00:00.000Z',
      instruments,
      generatedAt: '2026-09-26T01:00:00.000Z',
    });
    expect(snap.schemaVersion).toBe(ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION);
    expect(snap.snapshotId).toBe('ADV-1');
    expect(snap.batchId).toBe('B1');
    expect(snap.dataSnapshotVersion).toBe('batch-data-snapshot.v1');
    expect(snap.marketIntelligenceSnapshotId).toBe('MI-1');
    expect(snap.featureVersion).toBe(ADVANCED_INTELLIGENCE_FEATURE_VERSION);
    expect(Object.keys(snap.bySymbol).sort()).toEqual(['AAA', 'BBB']);
    expect(snap.coverage.eligible).toBe(2);
    expect(snap.coverage.catalystAvailable).toBe(0);
    expect(validateAdvancedSnapshotLinkage(snap)).toEqual({ ok: true });
  });

  it('same inputs produce deterministic empty envelope (fixed generatedAt/snapshotId)', () => {
    const input = {
      snapshotId: 'ADV-DET',
      batchId: 'B-DET',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      marketIntelligenceSnapshotId: 'MI-DET',
      asOf: '2026-09-26T00:00:00.000Z',
      instruments,
      generatedAt: '2026-09-26T01:00:00.000Z',
    };
    const a = buildEmptyAdvancedIntelligenceSnapshot(input);
    const b = buildEmptyAdvancedIntelligenceSnapshot(input);
    expect(a).toEqual(b);
  });

  it('UNAVAILABLE / NOT_APPLICABLE sections never carry fabricated payload', () => {
    const u = unavailableSection({
      asOf: '2026-09-26T00:00:00.000Z',
      sourceSnapshotId: 'MI-1',
    });
    expect(u.status).toBe('UNAVAILABLE');
    expect(u.payload).toBeUndefined();
    expect(isAdvancedSectionPresent(u.status)).toBe(false);
    expect(sectionHasFabricatedMissing(u)).toBe(false);

    const na = unavailableSection({
      asOf: '2026-09-26T00:00:00.000Z',
      status: 'NOT_APPLICABLE',
    });
    expect(na.status).toBe('NOT_APPLICABLE');
    expect(na.payload).toBeUndefined();

    const fabricated: typeof u = {
      ...u,
      payload: { score: 0 },
    };
    expect(sectionHasFabricatedMissing(fabricated)).toBe(true);
  });

  it('sourceSnapshotId on provenance is a ref, not a required MD snapshot identity', () => {
    const row = emptyAdvancedInstrumentIntelligence({
      instrument: instruments[0]!,
      asOf: '2026-09-26T00:00:00.000Z',
      sourceSnapshotId: 'MI-1',
    });
    expect(row.catalyst.provenance.sourceSnapshotId).toBe('MI-1');
    expect(row.bullRun.status).toBe('UNAVAILABLE');
    expect(row.analogues.status).toBe('UNAVAILABLE');
    expect(row.relationships.status).toBe('UNAVAILABLE');
    expect(row.globalImpact.status).toBe('UNAVAILABLE');
  });

  it('validateAdvancedSnapshotLinkage fails without dataSnapshotVersion / MI id', () => {
    const base = buildEmptyAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-1',
      batchId: 'B1',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      marketIntelligenceSnapshotId: 'MI-1',
      asOf: '2026-09-26T00:00:00.000Z',
      instruments,
      generatedAt: '2026-09-26T01:00:00.000Z',
    });
    const badMd: AdvancedIntelligenceSnapshot = {
      ...base,
      dataSnapshotVersion: '',
    };
    expect(validateAdvancedSnapshotLinkage(badMd).ok).toBe(false);
    const badMi: AdvancedIntelligenceSnapshot = {
      ...base,
      marketIntelligenceSnapshotId: '',
    };
    expect(validateAdvancedSnapshotLinkage(badMi).ok).toBe(false);
  });
});
