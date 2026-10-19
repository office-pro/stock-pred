/**
 * MI-7.6 — Global impact from frozen MI/macro only.
 * No undefined globalImpactScore. Missing sources → UNAVAILABLE.
 */
import type {
  AdvancedGlobalImpactDriver,
  AdvancedGlobalImpactPayload,
  AdvancedIntelligenceSection,
  InstrumentRef,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import { emptySectionProvenance, unavailableSection } from './mi-advanced-contract';

export const MI_7_GLOBAL_FEATURE_VERSION = 'mi-7-global-impact.v1';
export const MI_7_GLOBAL_METHOD = 'frozen-mi-macro-global.v1';

export function assessAdvancedGlobalImpactSection(input: {
  instrument: InstrumentRef;
  miSnapshot: MarketIntelligenceBatchSnapshot;
  asOf?: string;
  calculatedAt?: string;
}): AdvancedIntelligenceSection<AdvancedGlobalImpactPayload> {
  const asOf = input.asOf ?? input.miSnapshot.asOf;
  const calculatedAt = input.calculatedAt ?? asOf;
  const sourceId = input.miSnapshot.snapshotId;
  const drivers: AdvancedGlobalImpactDriver[] = [];

  const macro = input.miSnapshot.macro;
  if (macro?.available && macro.availableAt) {
    const availMs = Date.parse(macro.availableAt);
    const asOfMs = Date.parse(asOf);
    if (Number.isFinite(availMs) && Number.isFinite(asOfMs) && availMs <= asOfMs) {
      drivers.push({
        source: 'macro',
        direction: 'UNKNOWN',
        impact: 'LOW',
        evidenceIds: [`macro-${macro.availableAt}`],
      });
    }
  }

  // No qualifying global sources in frozen snapshot → UNAVAILABLE (intentional)
  if (drivers.length === 0) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_GLOBAL_METHOD,
      reason: 'NO_QUALIFYING_GLOBAL_SOURCE_DATA',
      status: 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedGlobalImpactPayload>;
  }

  drivers.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  const payload: AdvancedGlobalImpactPayload = {
    drivers,
    asOf,
  };

  return {
    status: 'AVAILABLE',
    provenance: emptySectionProvenance({
      asOf,
      calculatedAt,
      method: MI_7_GLOBAL_METHOD,
      featureVersion: MI_7_GLOBAL_FEATURE_VERSION,
      sourceSnapshotId: sourceId,
      sourceSnapshotIds: [sourceId],
      status: 'AVAILABLE',
      inputsUsed: ['mi.macro'],
      evidenceIds: drivers.flatMap((d) => d.evidenceIds).sort(),
    }),
    payload,
  };
}
