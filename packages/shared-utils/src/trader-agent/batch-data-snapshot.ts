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
  const batchMacro = batch?.macro;
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
            ...(row.derivatives.sourceInstrument
              ? { sourceInstrument: row.derivatives.sourceInstrument }
              : {}),
            ...(row.derivatives.contractType ? { contractType: row.derivatives.contractType } : {}),
            ...(row.derivatives.oiTrend ? { oiTrend: row.derivatives.oiTrend } : {}),
            ...(row.derivatives.fundingExtreme != null
              ? { fundingExtreme: row.derivatives.fundingExtreme }
              : {}),
            ...(row.derivatives.basisExpansion != null
              ? { basisExpansion: row.derivatives.basisExpansion }
              : {}),
            ...(row.derivatives.basisCompression != null
              ? { basisCompression: row.derivatives.basisCompression }
              : {}),
            ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
          },
        }
      : {}),
    ...(row.positioning ? { positioning: row.positioning } : {}),
    ...(row.news ? { news: row.news } : {}),
    ...(row.sentiment !== undefined ? { sentiment: row.sentiment } : {}),
    ...(row.onchain ? { onchain: row.onchain } : {}),
    ...(row.social ? { social: row.social } : {}),
    ...(batchMacro
      ? {
          macro: {
            source: 'SOURCE_REPORTED' as const,
            seriesId: batchMacro.series[0]?.seriesId,
            asOf: batchMacro.asOf ?? batchMacro.series[0]?.asOf,
            reasonCode: batchMacro.reasonCode,
            requestedCount: batchMacro.requestedCount,
            requestedSeries: batchMacro.requestedSeries,
            series: batchMacro.series,
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
