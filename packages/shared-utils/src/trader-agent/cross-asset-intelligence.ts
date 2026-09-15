/**
 * B14 Cross-asset intelligence — uses existing macro series only.
 */
import type { CrossAssetRelationship } from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  beta,
  closesFromCandles,
  pearson,
  provenance,
  returnsFromCloses,
  stabilityFromAbsCorr,
} from './b9-b17-helpers';
import { assessRelationship } from './relationship-intelligence-engine';

export function assessCrossAssetRelationship(
  leftId: string,
  assetId: string,
  leftCloses: number[],
  assetCloses: number[],
  windowDays = 60,
  now: Date = new Date(),
): CrossAssetRelationship {
  const rel = assessRelationship(
    leftId,
    assetId,
    leftCloses,
    assetCloses,
    'STOCK_ASSET',
    windowDays,
    now,
  );
  if (rel.status !== 'AVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: rel.reason ?? 'INSUFFICIENT_HISTORY',
      left: leftId,
      asset: assetId,
      sampleSize: rel.sampleSize,
      windowDays,
      provenance: provenance(
        'cross-asset-intelligence',
        {
          modelVersion: 'cross-asset.v1',
          featureVersion: B9_B17_FEATURE_VERSION,
          sampleSize: rel.sampleSize,
        },
        now,
      ),
    };
  }
  return {
    status: 'AVAILABLE',
    left: leftId,
    asset: assetId,
    pearson: rel.pearson ?? null,
    beta: rel.beta ?? null,
    sampleSize: rel.sampleSize,
    windowDays,
    provenance: provenance(
      'cross-asset-intelligence',
      {
        modelVersion: 'cross-asset.v1',
        featureVersion: B9_B17_FEATURE_VERSION,
        sampleSize: rel.sampleSize,
      },
      now,
    ),
  };
}

export function assessCrossAssetFromCandles(
  leftId: string,
  assetId: string,
  leftCandles: Array<{ close?: number }>,
  assetCandles: Array<{ close?: number }>,
  windowDays = 60,
  now?: Date,
): CrossAssetRelationship {
  return assessCrossAssetRelationship(
    leftId,
    assetId,
    closesFromCandles(leftCandles),
    closesFromCandles(assetCandles),
    windowDays,
    now,
  );
}

export function summarizeCrossAssetStability(
  pearsonCoeff: number | null,
  sampleSize: number,
): ReturnType<typeof stabilityFromAbsCorr> {
  return stabilityFromAbsCorr(pearsonCoeff != null ? Math.abs(pearsonCoeff) : null, sampleSize);
}

export { pearson, beta, returnsFromCloses };
