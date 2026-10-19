/**
 * MI-7.5 — Relationship engine from frozen close series.
 * UNAVAILABLE vs DATA_INCOMPLETE vs NOT_APPLICABLE — never correlation=0 for missing.
 */
import type {
  AdvancedIntelligenceSection,
  AdvancedRelationshipPair,
  AdvancedRelationshipPayload,
  InstrumentRef,
  RelationshipPairKind,
} from '@stockpred/shared-types';
import { assessRelationship } from './relationship-intelligence-engine';
import { emptySectionProvenance, unavailableSection } from './mi-advanced-contract';

export const MI_7_RELATIONSHIP_FEATURE_VERSION = 'mi-7-relationship.v1';
export const MI_7_RELATIONSHIP_METHOD = 'frozen-series-relationship.v1';
export const MI_7_RELATIONSHIP_MIN_OVERLAP = 10;

export interface RelationshipSeriesInput {
  id: string;
  closes: number[];
  kind: RelationshipPairKind;
}

function pairKey(left: string, right: string): [string, string] {
  return left <= right ? [left, right] : [right, left];
}

export function assessAdvancedRelationshipSection(input: {
  instrument: InstrumentRef;
  /** Peer / benchmark / sector series available in frozen snapshot. */
  counterparts: RelationshipSeriesInput[];
  selfCloses: number[];
  asOf: string;
  calculatedAt?: string;
  sourceSnapshotId?: string;
}): AdvancedIntelligenceSection<AdvancedRelationshipPayload> {
  const asOf = input.asOf;
  const calculatedAt = input.calculatedAt ?? asOf;
  const sourceId = input.sourceSnapshotId;
  const selfId = input.instrument.symbol.toUpperCase();

  if (!input.selfCloses.length) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_RELATIONSHIP_METHOD,
      reason: 'SELF_SERIES_MISSING',
      status: 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedRelationshipPayload>;
  }

  if (!input.counterparts.length) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_RELATIONSHIP_METHOD,
      reason: 'NO_COUNTERPART_SERIES',
      status: 'NOT_APPLICABLE',
    }) as AdvancedIntelligenceSection<AdvancedRelationshipPayload>;
  }

  // Deterministic pair order
  const counterparts = [...input.counterparts].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const pairs: AdvancedRelationshipPair[] = [];
  for (const c of counterparts) {
    if (!c.closes.length) {
      pairs.push({
        kind: c.kind,
        left: selfId,
        right: c.id.toUpperCase(),
        status: 'UNAVAILABLE',
        reason: 'COUNTERPART_SERIES_MISSING',
        sampleSize: 0,
        windowDays: 60,
        note: 'Statistical association only — not causation.',
      });
      continue;
    }
    if (c.id.toUpperCase() === selfId) {
      pairs.push({
        kind: c.kind,
        left: selfId,
        right: c.id.toUpperCase(),
        status: 'NOT_APPLICABLE',
        reason: 'SELF_PAIR',
        sampleSize: 0,
        windowDays: 60,
        note: 'Statistical association only — not causation.',
      });
      continue;
    }

    const [left, right] = pairKey(selfId, c.id.toUpperCase());
    const leftCloses = left === selfId ? input.selfCloses : c.closes;
    const rightCloses = right === selfId ? input.selfCloses : c.closes;
    // Fixed "now" via asOf for determinism — assessRelationship uses Date for provenance only
    const metrics = assessRelationship(
      left,
      right,
      leftCloses,
      rightCloses,
      c.kind,
      60,
      new Date(asOf),
    );

    if (metrics.status === 'UNAVAILABLE' || metrics.sampleSize < MI_7_RELATIONSHIP_MIN_OVERLAP) {
      pairs.push({
        kind: c.kind,
        left,
        right,
        status: metrics.sampleSize > 0 ? 'DATA_INCOMPLETE' : 'UNAVAILABLE',
        reason: metrics.reason ?? 'INSUFFICIENT_OVERLAP',
        sampleSize: metrics.sampleSize,
        windowDays: metrics.windowDays,
        note: metrics.note,
        // Explicitly omit pearson — never fabricate 0
      });
      continue;
    }

    // Zero-variance: pearson null → DATA_INCOMPLETE, not 0
    if (metrics.pearson == null) {
      pairs.push({
        kind: c.kind,
        left,
        right,
        status: 'DATA_INCOMPLETE',
        reason: 'ZERO_VARIANCE_OR_UNDEFINED_CORR',
        sampleSize: metrics.sampleSize,
        windowDays: metrics.windowDays,
        note: metrics.note,
      });
      continue;
    }

    pairs.push({
      kind: c.kind,
      left,
      right,
      status: 'AVAILABLE',
      pearson: metrics.pearson,
      beta: metrics.beta ?? null,
      sampleSize: metrics.sampleSize,
      windowDays: metrics.windowDays,
      note: metrics.note,
    });
  }

  const available = pairs.filter((p) => p.status === 'AVAILABLE').length;
  if (available === 0) {
    const anyIncomplete = pairs.some((p) => p.status === 'DATA_INCOMPLETE');
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_RELATIONSHIP_METHOD,
      reason: anyIncomplete ? 'INSUFFICIENT_OVERLAP' : 'NO_AVAILABLE_PAIRS',
      status: anyIncomplete ? 'DATA_INCOMPLETE' : 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedRelationshipPayload>;
  }

  const status = available < pairs.length ? 'PARTIAL' : 'AVAILABLE';
  return {
    status,
    provenance: emptySectionProvenance({
      asOf,
      calculatedAt,
      method: MI_7_RELATIONSHIP_METHOD,
      featureVersion: MI_7_RELATIONSHIP_FEATURE_VERSION,
      sourceSnapshotId: sourceId,
      status,
      inputsUsed: ['selfCloses', 'counterparts', `minOverlap=${MI_7_RELATIONSHIP_MIN_OVERLAP}`],
      evidenceIds: pairs
        .filter((p) => p.status === 'AVAILABLE')
        .map((p) => `rel-${p.left}-${p.right}`),
    }),
    payload: { pairs },
  };
}
