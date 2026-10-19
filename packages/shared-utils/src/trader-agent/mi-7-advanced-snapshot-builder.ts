/**
 * MI-7.7 — Aggregate AdvancedIntelligenceSnapshot from frozen MD + MI.
 * contentHash for deterministic content equality (excludes runtime snapshotId when hashing).
 */
import { createHash } from 'crypto';
import type {
  AdvancedIntelligenceSnapshot,
  AdvancedInstrumentIntelligence,
  BatchDataSnapshot,
  InstrumentRef,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import { ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import {
  ADVANCED_INTELLIGENCE_FEATURE_VERSION,
  buildEmptyAdvancedIntelligenceSnapshot,
  isAdvancedSectionPresent,
  validateAdvancedSnapshotLinkage,
} from './mi-advanced-contract';
import { assessAdvancedCatalystSection } from './mi-7-catalyst-engine';
import { assessAdvancedRegimeSection } from './mi-7-regime-engine';
import { assessAdvancedAnalogueSection } from './mi-7-analogue-engine';
import { assessAdvancedRelationshipSection } from './mi-7-relationship-engine';
import { assessAdvancedGlobalImpactSection } from './mi-7-global-impact-engine';
import { closesFromCandles } from './b9-b17-helpers';

export const MI_7_BUILDER_METHOD = 'mi-7-advanced-snapshot-builder.v1';

/** Canonical content for hashing — excludes runtime-only snapshotId / wall-clock generatedAt. */
export function canonicalAdvancedContent(snapshot: AdvancedIntelligenceSnapshot): unknown {
  return {
    schemaVersion: snapshot.schemaVersion,
    batchId: snapshot.batchId,
    dataSnapshotVersion: snapshot.dataSnapshotVersion,
    marketIntelligenceSnapshotId: snapshot.marketIntelligenceSnapshotId,
    asOf: snapshot.asOf,
    featureVersion: snapshot.featureVersion,
    instruments: snapshot.instruments,
    bySymbol: snapshot.bySymbol,
    coverage: snapshot.coverage,
    sourceMetadata: {
      featureVersion: snapshot.sourceMetadata.featureVersion,
      dataSnapshotVersion: snapshot.sourceMetadata.dataSnapshotVersion,
      marketIntelligenceSnapshotId: snapshot.sourceMetadata.marketIntelligenceSnapshotId,
      notes: snapshot.sourceMetadata.notes,
    },
  };
}

export function hashAdvancedContent(snapshot: AdvancedIntelligenceSnapshot): string {
  const canonical = JSON.stringify(canonicalAdvancedContent(snapshot));
  return createHash('sha256').update(canonical).digest('hex');
}

function countPresent(
  bySymbol: Record<string, AdvancedInstrumentIntelligence>,
  key: keyof Pick<
    AdvancedInstrumentIntelligence,
    'catalyst' | 'bullRun' | 'analogues' | 'relationships' | 'globalImpact'
  >,
): number {
  let n = 0;
  for (const row of Object.values(bySymbol)) {
    if (isAdvancedSectionPresent(row[key].status)) n += 1;
  }
  return n;
}

export function buildAdvancedIntelligenceSnapshot(input: {
  snapshotId: string;
  batchId: string;
  dataSnapshot: BatchDataSnapshot;
  miSnapshot: MarketIntelligenceBatchSnapshot;
  instruments?: InstrumentRef[];
  /** Fixed clock for determinism (defaults to miSnapshot.asOf). */
  asOf?: string;
  generatedAt?: string;
  relationshipBenchmarkCloses?: number[];
  relationshipBenchmarkId?: string;
}): AdvancedIntelligenceSnapshot {
  const asOf = input.asOf ?? input.miSnapshot.asOf;
  const generatedAt = input.generatedAt ?? asOf;
  const instruments =
    input.instruments ??
    input.miSnapshot.instruments ??
    input.dataSnapshot.instruments.map((r) => r.instrumentRef);

  const empty = buildEmptyAdvancedIntelligenceSnapshot({
    snapshotId: input.snapshotId,
    batchId: input.batchId,
    dataSnapshotVersion: input.dataSnapshot.dataSnapshotVersion,
    marketIntelligenceSnapshotId: input.miSnapshot.snapshotId,
    asOf,
    instruments,
    featureVersion: ADVANCED_INTELLIGENCE_FEATURE_VERSION,
    generatedAt,
  });

  const bySymbol: Record<string, AdvancedInstrumentIntelligence> = {};
  const rowsBySym = new Map(
    input.dataSnapshot.instruments.map((r) => [r.instrumentRef.symbol.toUpperCase(), r]),
  );

  for (const instrument of instruments) {
    const sym = instrument.symbol.trim().toUpperCase();
    const row = rowsBySym.get(sym);
    const closes = closesFromCandles(row?.candles ?? []);
    const volumes = (row?.candles ?? [])
      .map((c) => (typeof c.volume === 'number' ? c.volume : undefined))
      .filter((v): v is number => v != null);

    const catalyst = assessAdvancedCatalystSection({
      instrument,
      miSnapshot: input.miSnapshot,
      asOf,
      calculatedAt: asOf,
    });
    const bullRun = assessAdvancedRegimeSection({
      instrument,
      row,
      dataSnapshot: input.dataSnapshot,
      asOf,
      calculatedAt: asOf,
      sourceSnapshotId: input.dataSnapshot.dataSnapshotVersion,
    });
    const analogues = assessAdvancedAnalogueSection({
      instrument,
      closes,
      volumes: volumes.length === closes.length ? volumes : undefined,
      asOf,
      calculatedAt: asOf,
      sourceSnapshotId: input.dataSnapshot.dataSnapshotVersion,
    });
    const counterparts =
      input.relationshipBenchmarkCloses && input.relationshipBenchmarkId
        ? [
            {
              id: input.relationshipBenchmarkId,
              closes: input.relationshipBenchmarkCloses,
              kind: 'STOCK_INDEX' as const,
            },
          ]
        : [];
    const relationships = assessAdvancedRelationshipSection({
      instrument,
      selfCloses: closes,
      counterparts,
      asOf,
      calculatedAt: asOf,
      sourceSnapshotId: input.dataSnapshot.dataSnapshotVersion,
    });
    const globalImpact = assessAdvancedGlobalImpactSection({
      instrument,
      miSnapshot: input.miSnapshot,
      asOf,
      calculatedAt: asOf,
    });

    bySymbol[sym] = {
      instrument,
      catalyst,
      bullRun,
      analogues,
      relationships,
      globalImpact,
      evidence: [
        ...(catalyst.evidence ?? []),
        ...(bullRun.evidence ?? []),
        ...(analogues.evidence ?? []),
        ...(globalImpact.evidence ?? []),
      ],
    };
  }

  const snap: AdvancedIntelligenceSnapshot = {
    ...empty,
    bySymbol,
    coverage: {
      catalystAvailable: countPresent(bySymbol, 'catalyst'),
      bullRunAvailable: countPresent(bySymbol, 'bullRun'),
      analoguesAvailable: countPresent(bySymbol, 'analogues'),
      relationshipsAvailable: countPresent(bySymbol, 'relationships'),
      globalImpactAvailable: countPresent(bySymbol, 'globalImpact'),
      eligible: instruments.length,
    },
    sourceMetadata: {
      featureVersion: ADVANCED_INTELLIGENCE_FEATURE_VERSION,
      dataSnapshotVersion: input.dataSnapshot.dataSnapshotVersion,
      marketIntelligenceSnapshotId: input.miSnapshot.snapshotId,
      notes: [MI_7_BUILDER_METHOD, 'engines=catalyst,regime,analogue,relationship,global'],
    },
    schemaVersion: ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION,
  };

  const contentHash = hashAdvancedContent(snap);
  snap.sourceMetadata = { ...snap.sourceMetadata, contentHash };

  const linkage = validateAdvancedSnapshotLinkage(snap);
  if (!linkage.ok) {
    throw new Error(`ADVANCED_SNAPSHOT_LINKAGE:${linkage.reason}`);
  }
  return snap;
}
