/**
 * Batch ML / RS omit diagnostics — observe-only; never invent predictions or NEUTRAL RS.
 */

import type { HorizonPrediction, MLPredictionSnapshot } from '@stockpred/shared-types';
import { isUsableMlForBatch } from './intelligence-batch-context';

export type BatchMlOmitReason =
  | 'COMPACTED'
  | 'NO_RESPONSE'
  | 'NO_MODEL_VERSION'
  | 'UNUSABLE_FRESHNESS'
  | 'UNUSABLE_DRIFT'
  | 'NOT_CALLED'
  | 'FETCH_ERROR'
  | 'CACHE_MISSING'
  | 'INVALID_PAYLOAD'
  | 'EXPIRED';

export type BatchRsOmitReason =
  | 'LABELLED'
  | 'FETCH_NULL'
  | 'RS_NUMBER_NULL'
  | 'SOURCE_MISSING'
  | 'SNAPSHOT_OMITTED'
  | 'NOT_CALLED'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROVIDER_EMPTY'
  | 'CACHE_MISSING'
  | 'INSUFFICIENT_HISTORY'
  | 'VALUE_NULL';

export function diagnoseMlForBatch(input: {
  called: boolean;
  prediction: HorizonPrediction | MLPredictionSnapshot | null | undefined;
  fetchError?: boolean;
}): {
  usable: boolean;
  omitReason: BatchMlOmitReason;
  freshnessStatus?: string;
  driftStatus?: string;
  modelId?: string;
  modelVersion?: string;
  featureVersion?: string;
} {
  if (!input.called) {
    return { usable: false, omitReason: 'NOT_CALLED' };
  }
  if (input.fetchError) {
    return { usable: false, omitReason: 'FETCH_ERROR' };
  }
  const ml = input.prediction;
  if (!ml) {
    return { usable: false, omitReason: 'NO_RESPONSE' };
  }
  const modelVersion = 'modelVersion' in ml ? ml.modelVersion : undefined;
  if (!modelVersion) {
    return {
      usable: false,
      omitReason: 'NO_MODEL_VERSION',
      freshnessStatus: ml.freshnessStatus ? String(ml.freshnessStatus) : undefined,
      driftStatus: ml.driftStatus ? String(ml.driftStatus) : undefined,
      modelId: 'modelId' in ml ? ml.modelId : undefined,
    };
  }
  if (ml.freshnessStatus === 'missing' || ml.freshnessStatus === 'incompatible') {
    return {
      usable: false,
      omitReason: 'UNUSABLE_FRESHNESS',
      freshnessStatus: String(ml.freshnessStatus),
      driftStatus: ml.driftStatus ? String(ml.driftStatus) : undefined,
      modelId: 'modelId' in ml ? ml.modelId : undefined,
      modelVersion,
      featureVersion: 'featureVersion' in ml ? ml.featureVersion : undefined,
    };
  }
  if (ml.driftStatus === 'incompatible') {
    return {
      usable: false,
      omitReason: 'UNUSABLE_DRIFT',
      freshnessStatus: ml.freshnessStatus ? String(ml.freshnessStatus) : undefined,
      driftStatus: String(ml.driftStatus),
      modelId: 'modelId' in ml ? ml.modelId : undefined,
      modelVersion,
      featureVersion: 'featureVersion' in ml ? ml.featureVersion : undefined,
    };
  }
  if (!isUsableMlForBatch(ml)) {
    return {
      usable: false,
      omitReason: 'UNUSABLE_FRESHNESS',
      freshnessStatus: ml.freshnessStatus ? String(ml.freshnessStatus) : undefined,
      driftStatus: ml.driftStatus ? String(ml.driftStatus) : undefined,
      modelId: 'modelId' in ml ? ml.modelId : undefined,
      modelVersion,
      featureVersion: 'featureVersion' in ml ? ml.featureVersion : undefined,
    };
  }
  return {
    usable: true,
    omitReason: 'COMPACTED',
    freshnessStatus: ml.freshnessStatus ? String(ml.freshnessStatus) : undefined,
    driftStatus: ml.driftStatus ? String(ml.driftStatus) : undefined,
    modelId: 'modelId' in ml ? ml.modelId : undefined,
    modelVersion,
    featureVersion: 'featureVersion' in ml ? ml.featureVersion : undefined,
  };
}

export function diagnoseRsForBatch(input: {
  called: boolean;
  fetchNull: boolean;
  quoteRs: number | null | undefined;
  scannerRs: number | null | undefined;
  rsVsNifty50: number | null | undefined;
  source?: string | null;
  snapshotAttached: boolean;
  rsBucket?: string | null;
  /** When known from MDS — distinguishes empty vs insufficient NIFTY history. */
  benchmarkDailyLength?: number | null;
  providerFailed?: boolean;
}): {
  omitReason: BatchRsOmitReason;
  quoteRs: number | null;
  scannerRs: number | null;
  source?: string;
  snapshotAttached: boolean;
  rsBucket?: string;
} {
  const quoteRs = input.quoteRs ?? null;
  const scannerRs = input.scannerRs ?? null;
  if (!input.called) {
    return { omitReason: 'NOT_CALLED', quoteRs, scannerRs, snapshotAttached: false };
  }
  if (input.providerFailed) {
    return { omitReason: 'PROVIDER_REQUEST_FAILED', quoteRs, scannerRs, snapshotAttached: false };
  }
  if (input.fetchNull) {
    return { omitReason: 'FETCH_NULL', quoteRs, scannerRs, snapshotAttached: false };
  }
  if (input.rsBucket) {
    return {
      omitReason: 'LABELLED',
      quoteRs,
      scannerRs,
      source: input.source ?? undefined,
      snapshotAttached: input.snapshotAttached,
      rsBucket: String(input.rsBucket),
    };
  }
  if (input.rsVsNifty50 == null || !Number.isFinite(input.rsVsNifty50)) {
    const bench = input.benchmarkDailyLength;
    let omitReason: BatchRsOmitReason = 'RS_NUMBER_NULL';
    if (bench === 0) omitReason = 'PROVIDER_EMPTY';
    else if (bench != null && bench < 60) omitReason = 'INSUFFICIENT_HISTORY';
    else if (bench == null && quoteRs == null && scannerRs == null) omitReason = 'VALUE_NULL';
    return {
      omitReason,
      quoteRs,
      scannerRs,
      source: input.source ?? undefined,
      snapshotAttached: input.snapshotAttached,
    };
  }
  if (input.source === 'MISSING') {
    return {
      omitReason: 'SOURCE_MISSING',
      quoteRs,
      scannerRs,
      source: 'MISSING',
      snapshotAttached: input.snapshotAttached,
    };
  }
  if (!input.snapshotAttached) {
    return {
      omitReason: 'SNAPSHOT_OMITTED',
      quoteRs,
      scannerRs,
      source: input.source ?? undefined,
      snapshotAttached: false,
    };
  }
  return {
    omitReason: 'SNAPSHOT_OMITTED',
    quoteRs,
    scannerRs,
    source: input.source ?? undefined,
    snapshotAttached: input.snapshotAttached,
  };
}

export function rollupOmitReasons<T extends string>(reasons: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) {
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}
