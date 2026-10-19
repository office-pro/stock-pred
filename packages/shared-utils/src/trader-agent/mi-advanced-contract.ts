/**
 * MI-7.1 — AdvancedIntelligenceSnapshot contract helpers (no engines).
 * Never fabricates 0 / neutral / false for missing sections.
 */

import type {
  AdvancedEvidenceRef,
  AdvancedInstrumentIntelligence,
  AdvancedIntelligenceSection,
  AdvancedIntelligenceSnapshot,
  AdvancedSectionProvenance,
  AdvancedSectionStatus,
  InstrumentRef,
} from '@stockpred/shared-types';
import { ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION } from '@stockpred/shared-types';

export const ADVANCED_INTELLIGENCE_FEATURE_VERSION = 'advanced-intelligence.v1';

/** Never treat missing as scored / zero / neutral. */
export function isAdvancedSectionPresent(status: AdvancedSectionStatus): boolean {
  return status === 'AVAILABLE' || status === 'PARTIAL';
}

export function isAdvancedSectionAbsent(status: AdvancedSectionStatus): boolean {
  return (
    status === 'UNAVAILABLE' ||
    status === 'NOT_APPLICABLE' ||
    status === 'UNKNOWN' ||
    status === 'DATA_INCOMPLETE'
  );
}

export function emptySectionProvenance(input: {
  asOf: string;
  calculatedAt?: string;
  method?: string;
  status?: AdvancedSectionStatus;
  sourceSnapshotId?: string;
  sourceSnapshotIds?: string[];
  featureVersion?: string;
  reason?: string;
  inputsUsed?: string[];
  evidenceIds?: string[];
}): AdvancedSectionProvenance {
  return {
    featureVersion: input.featureVersion ?? ADVANCED_INTELLIGENCE_FEATURE_VERSION,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceSnapshotIds: input.sourceSnapshotIds,
    asOf: input.asOf,
    calculatedAt: input.calculatedAt ?? input.asOf,
    method: input.method ?? 'UNAVAILABLE_STUB',
    inputsUsed: input.inputsUsed ?? [],
    evidenceIds: input.evidenceIds ?? [],
    status: input.status ?? 'UNAVAILABLE',
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function unavailableSection(input: {
  asOf: string;
  sourceSnapshotId?: string;
  method?: string;
  reason?: string;
  status?: Extract<
    AdvancedSectionStatus,
    'UNAVAILABLE' | 'NOT_APPLICABLE' | 'UNKNOWN' | 'DATA_INCOMPLETE'
  >;
}): AdvancedIntelligenceSection {
  const status = input.status ?? 'UNAVAILABLE';
  const provenance = emptySectionProvenance({
    asOf: input.asOf,
    sourceSnapshotId: input.sourceSnapshotId,
    method: input.method ?? 'UNAVAILABLE_STUB',
    status,
  });
  if (input.reason) provenance.reason = input.reason;
  return { status, provenance };
}

/** Build empty per-symbol stub — all sections UNAVAILABLE until engines (MI-7.2+). */
export function emptyAdvancedInstrumentIntelligence(input: {
  instrument: InstrumentRef;
  asOf: string;
  sourceSnapshotId?: string;
}): AdvancedInstrumentIntelligence {
  const section = <T = unknown>() =>
    unavailableSection({
      asOf: input.asOf,
      sourceSnapshotId: input.sourceSnapshotId,
    }) as AdvancedIntelligenceSection<T>;
  return {
    instrument: input.instrument,
    catalyst: section(),
    bullRun: section(),
    analogues: section(),
    relationships: section(),
    globalImpact: section(),
    evidence: [] as AdvancedEvidenceRef[],
  };
}

/**
 * Empty batch envelope linked to frozen MD + MI identities.
 * Deterministic for same batchId + dataSnapshotVersion + marketIntelligenceSnapshotId + asOf
 * when snapshotId is supplied (tests); callers may inject UUID later.
 */
export function buildEmptyAdvancedIntelligenceSnapshot(input: {
  snapshotId: string;
  batchId: string;
  dataSnapshotVersion: string;
  marketIntelligenceSnapshotId: string;
  asOf: string;
  instruments: InstrumentRef[];
  featureVersion?: string;
  generatedAt?: string;
}): AdvancedIntelligenceSnapshot {
  const featureVersion = input.featureVersion ?? ADVANCED_INTELLIGENCE_FEATURE_VERSION;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceSnapshotId = input.marketIntelligenceSnapshotId;
  const bySymbol: Record<string, AdvancedInstrumentIntelligence> = {};
  for (const instrument of input.instruments) {
    const sym = instrument.symbol.trim().toUpperCase();
    bySymbol[sym] = emptyAdvancedInstrumentIntelligence({
      instrument,
      asOf: input.asOf,
      sourceSnapshotId,
    });
  }
  return {
    schemaVersion: ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION,
    snapshotId: input.snapshotId,
    batchId: input.batchId,
    dataSnapshotVersion: input.dataSnapshotVersion,
    marketIntelligenceSnapshotId: input.marketIntelligenceSnapshotId,
    asOf: input.asOf,
    featureVersion,
    instruments: input.instruments.map((i) => ({ ...i })),
    bySymbol,
    coverage: {
      catalystAvailable: 0,
      bullRunAvailable: 0,
      analoguesAvailable: 0,
      relationshipsAvailable: 0,
      globalImpactAvailable: 0,
      eligible: input.instruments.length,
    },
    sourceMetadata: {
      featureVersion,
      dataSnapshotVersion: input.dataSnapshotVersion,
      marketIntelligenceSnapshotId: input.marketIntelligenceSnapshotId,
      notes: ['MI-7 advanced envelope — engines fill sections when inputs exist'],
    },
    generatedAt,
  };
}

/** Validate canonical identity linkage — no MD snapshotId required. */
export function validateAdvancedSnapshotLinkage(snapshot: AdvancedIntelligenceSnapshot):
  | {
      ok: true;
    }
  | { ok: false; reason: string } {
  if (snapshot.schemaVersion !== ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION) {
    return { ok: false, reason: 'SCHEMA_VERSION_MISMATCH' };
  }
  if (!snapshot.batchId?.trim()) return { ok: false, reason: 'BATCH_ID_MISSING' };
  if (!snapshot.dataSnapshotVersion?.trim()) {
    return { ok: false, reason: 'DATA_SNAPSHOT_VERSION_MISSING' };
  }
  if (!snapshot.marketIntelligenceSnapshotId?.trim()) {
    return { ok: false, reason: 'MI_SNAPSHOT_ID_MISSING' };
  }
  if (!snapshot.snapshotId?.trim()) return { ok: false, reason: 'ADVANCED_SNAPSHOT_ID_MISSING' };
  if (!snapshot.asOf?.trim()) return { ok: false, reason: 'AS_OF_MISSING' };
  return { ok: true };
}

/** Assert section does not fabricate numeric zero / false as presence. */
export function sectionHasFabricatedMissing(section: AdvancedIntelligenceSection): boolean {
  if (isAdvancedSectionAbsent(section.status)) {
    if (section.payload !== undefined) return true;
  }
  return false;
}
