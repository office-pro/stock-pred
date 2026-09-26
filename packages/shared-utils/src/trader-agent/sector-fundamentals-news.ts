/**
 * Sector / fundamentals / news provenance helpers (additive; no invented fills).
 */

import type {
  EntityMappingStatus,
  FundamentalsProvenanceKind,
  SectorClassification,
  UnavailableReasonCode,
} from '@stockpred/shared-types';

/** Historical engines must join sector by effective interval — not today's sector blindly. */
export function sectorAtAsOf(
  rows: SectorClassification[],
  asOfIso: string,
): SectorClassification | null {
  const asOf = asOfIso.slice(0, 10);
  const hit = rows.find((r) => {
    const from = r.effectiveFrom.slice(0, 10);
    const to = (r.effectiveTo ?? '9999-12-31').slice(0, 10);
    return from <= asOf && asOf <= to;
  });
  return hit ?? null;
}

export function fundamentalsField(input: {
  value: number | string | null | undefined;
  kind: FundamentalsProvenanceKind;
  source: string;
  dataAsOf?: string | number | null;
}): {
  value: number | string | null;
  provenanceKind: FundamentalsProvenanceKind;
  source: string;
  dataAsOf: string | number | null;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reasonCode?: UnavailableReasonCode;
} {
  if (input.value == null || input.value === '') {
    return {
      value: null,
      provenanceKind: input.kind,
      source: input.source,
      dataAsOf: input.dataAsOf ?? null,
      status: 'UNAVAILABLE',
      reasonCode: 'DATA_INCOMPLETE',
    };
  }
  return {
    value: input.value,
    provenanceKind: input.kind,
    source: input.source,
    dataAsOf: input.dataAsOf ?? null,
    status: 'AVAILABLE',
  };
}

/** Ambiguous/unmapped news stays unavailable for stock-specific catalyst. */
export function newsCatalystAvailability(mapping: EntityMappingStatus): {
  usableForStockCatalyst: boolean;
  reasonCode?: UnavailableReasonCode;
} {
  if (mapping === 'VALID') return { usableForStockCatalyst: true };
  if (mapping === 'AMBIGUOUS') {
    return { usableForStockCatalyst: false, reasonCode: 'IDENTITY_CONFLICT' };
  }
  return { usableForStockCatalyst: false, reasonCode: 'DATA_INCOMPLETE' };
}

/** Never invent neutral 0 sentiment from missing news. */
export function missingNewsSentiment(): {
  sentiment: null;
  status: 'UNAVAILABLE';
  reasonCode: UnavailableReasonCode;
} {
  return { sentiment: null, status: 'UNAVAILABLE', reasonCode: 'DATA_INCOMPLETE' };
}
