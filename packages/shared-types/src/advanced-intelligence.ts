/**
 * MI-7.1 — Advanced Derived Intelligence contracts.
 * Engines (MI-7.2+) fill section payloads; observe-only — never Risk/Portfolio/Policy/Gate/Order.
 */

import type { InstrumentRef } from './instrument';
import type {
  TiCatalystDirection,
  TiCatalystStrength,
  TiCatalystType,
  TiEventRisk,
} from './trade-intelligence';

export const ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION = 'advanced-intelligence-snapshot.v1' as const;

/**
 * Backend-owned section availability — never coerce missing → 0 / neutral / false.
 * Additive tokens UNKNOWN / DATA_INCOMPLETE align with existing TI / intelligence vocab.
 */
export type AdvancedSectionStatus =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'DATA_INCOMPLETE';

/**
 * Provenance for a derived section.
 * `sourceSnapshotId` is a provenance reference to frozen MI/data sources
 * (e.g. marketIntelligenceSnapshotId or dataSnapshotVersion) — not a new MD snapshot identity.
 */
export interface AdvancedSectionProvenance {
  featureVersion: string;
  /** Provenance ref only — not a competing BatchDataSnapshot snapshotId. */
  sourceSnapshotId?: string;
  /** Additional lineage refs (MI/MD identities contributing to this section). */
  sourceSnapshotIds?: string[];
  asOf: string;
  calculatedAt: string;
  method: string;
  inputsUsed: string[];
  evidenceIds: string[];
  status: AdvancedSectionStatus;
  reason?: string;
}

/** Typed evidence pointer into frozen MI/data artifacts. */
export interface AdvancedEvidenceRef {
  evidenceId: string;
  kind?: string;
  sourceSnapshotId?: string;
  note?: string;
}

export interface AdvancedIntelligenceSection<TPayload = unknown> {
  status: AdvancedSectionStatus;
  provenance: AdvancedSectionProvenance;
  evidence?: AdvancedEvidenceRef[];
  /** Engine payload when AVAILABLE/PARTIAL — undefined when UNAVAILABLE/NOT_APPLICABLE/etc. */
  payload?: TPayload;
}

/** MI-7.2 — structured catalyst list (no BUY/SELL/TRADE scores). */
export interface AdvancedCatalystItem {
  type: TiCatalystType;
  direction: TiCatalystDirection;
  /** Materiality / strength — not a trade score. */
  materiality: TiCatalystStrength;
  eventDate?: string;
  publishedAt: string;
  availableAt: string;
  confidence: 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';
  evidenceIds: string[];
  title?: string;
}

export interface AdvancedCatalystPayload {
  catalysts: AdvancedCatalystItem[];
  eventRisk: TiEventRisk;
}

/** MI-7.3 — observed regime classification (not P(price rises)). */
export type AdvancedRegimeState = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'TRANSITION' | 'UNKNOWN';

export interface AdvancedRegimePayload {
  state: AdvancedRegimeState;
  /** Classification confidence — never interpret as directional win probability. */
  confidence: number | null;
  persistence: 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';
  evidence: string[];
  asOf: string;
  /** Explicit: this is regime classification, not a prediction. */
  semantics: 'OBSERVED_REGIME_CLASSIFICATION';
}

/** MI-7.4 — historical analogues. */
export interface AdvancedAnalogueMatch {
  date: string | null;
  historicalIndex: number;
  similarity: number;
  outcome5D?: number | null;
  outcome20D?: number | null;
  outcome60D?: number | null;
  evidenceIds: string[];
}

export interface AdvancedAnaloguePayload {
  matches: AdvancedAnalogueMatch[];
  summary: {
    sampleSize: number;
    distribution?: { mean5D?: number | null; mean20D?: number | null; mean60D?: number | null };
  };
}

/** MI-7.5 — relationships (statistical only). */
export interface AdvancedRelationshipPair {
  kind: string;
  left: string;
  right: string;
  status: AdvancedSectionStatus;
  reason?: string;
  pearson?: number | null;
  beta?: number | null;
  sampleSize: number;
  windowDays: number;
  note: string;
}

export interface AdvancedRelationshipPayload {
  pairs: AdvancedRelationshipPair[];
}

/** MI-7.6 — global impact drivers (no undefined globalImpactScore). */
export interface AdvancedGlobalImpactDriver {
  source: string;
  direction: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  impact: 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';
  evidenceIds: string[];
}

export interface AdvancedGlobalImpactPayload {
  drivers: AdvancedGlobalImpactDriver[];
  affectedAssets?: string[];
  affectedRegions?: string[];
  asOf: string;
}

export interface AdvancedInstrumentIntelligence {
  instrument: InstrumentRef;
  catalyst: AdvancedIntelligenceSection<AdvancedCatalystPayload>;
  bullRun: AdvancedIntelligenceSection<AdvancedRegimePayload>;
  analogues: AdvancedIntelligenceSection<AdvancedAnaloguePayload>;
  relationships: AdvancedIntelligenceSection<AdvancedRelationshipPayload>;
  globalImpact: AdvancedIntelligenceSection<AdvancedGlobalImpactPayload>;
  evidence: AdvancedEvidenceRef[];
}

export interface AdvancedIntelligenceCoverage {
  catalystAvailable: number;
  bullRunAvailable: number;
  analoguesAvailable: number;
  relationshipsAvailable: number;
  globalImpactAvailable: number;
  eligible: number;
}

export interface AdvancedIntelligenceSourceMetadata {
  featureVersion: string;
  dataSnapshotVersion: string;
  marketIntelligenceSnapshotId: string;
  /** Deterministic hash of canonical content (excludes runtime-only ids when configured). */
  contentHash?: string;
  notes?: string[];
}

/**
 * Batch-level derived intelligence snapshot (MI-7).
 * Canonical identities: batchId, dataSnapshotVersion, marketIntelligenceSnapshotId, snapshotId.
 */
export interface AdvancedIntelligenceSnapshot {
  schemaVersion: typeof ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION;
  snapshotId: string;
  batchId: string;
  /** Canonical BatchDataSnapshot linkage — never invent MD snapshotId. */
  dataSnapshotVersion: string;
  marketIntelligenceSnapshotId: string;
  asOf: string;
  featureVersion: string;
  instruments: InstrumentRef[];
  bySymbol: Record<string, AdvancedInstrumentIntelligence>;
  coverage: AdvancedIntelligenceCoverage;
  sourceMetadata: AdvancedIntelligenceSourceMetadata;
  generatedAt: string;
}
