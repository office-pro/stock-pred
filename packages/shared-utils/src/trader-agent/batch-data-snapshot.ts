/**
 * Attach frozen BatchInstrumentData onto IntelligenceSnapshot.
 * Observe-only — never passed into Risk / Portfolio / Policy / Gate.
 */

import type {
  BatchDataSnapshot,
  BatchInstrumentData,
  IntelligenceSnapshot,
} from '@stockpred/shared-types';
import { sanitizeFundamentalPayload } from '@stockpred/shared-types';

export function attachBatchInstrumentToIntelligenceSnapshot(
  snapshot: IntelligenceSnapshot,
  row: BatchInstrumentData | undefined,
  batch?: Pick<BatchDataSnapshot, 'macro'>,
): IntelligenceSnapshot {
  if (!row) return snapshot;
  const fundamental = sanitizeFundamentalPayload(row.instrumentRef.assetClass, row.fundamentals);
  const macroPoint = batch?.macro?.series?.[0];
  return {
    ...snapshot,
    ...(fundamental ? { fundamental } : {}),
    ...(row.derivatives
      ? {
          derivatives: {
            source: row.derivatives.source,
            ...(row.derivatives.markPrice != null ? { markPrice: row.derivatives.markPrice } : {}),
            ...(row.derivatives.indexPrice != null
              ? { indexPrice: row.derivatives.indexPrice }
              : {}),
            ...(row.derivatives.openInterest != null
              ? { openInterest: row.derivatives.openInterest }
              : {}),
            ...(row.derivatives.lastFundingRate != null
              ? { lastFundingRate: row.derivatives.lastFundingRate }
              : {}),
            ...(row.derivatives.basis != null ? { basis: row.derivatives.basis } : {}),
            ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
          },
        }
      : {}),
    ...(row.positioning ? { positioning: row.positioning } : {}),
    ...(row.news ? { news: row.news } : {}),
    ...(row.sentiment !== undefined ? { sentiment: row.sentiment } : {}),
    ...(macroPoint
      ? {
          macro: {
            source: 'SOURCE_REPORTED' as const,
            seriesId: macroPoint.seriesId,
            asOf: batch?.macro?.asOf ?? macroPoint.asOf,
            reasonCode: batch?.macro?.reasonCode,
          },
        }
      : {}),
    dataQuality: {
      dataStatus: row.dataStatus,
      dataAgeMs: row.dataAgeMs,
      reasons: row.reasonCode ? [row.reasonCode] : undefined,
    },
  };
}
