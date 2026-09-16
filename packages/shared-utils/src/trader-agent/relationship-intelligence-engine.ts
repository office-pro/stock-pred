/**
 * B11 Relationship + lead/lag — statistical only, never causation.
 */
import type {
  LeadLagRelationship,
  RelationshipMetrics,
  RelationshipPairKind,
} from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  alignReturns,
  beta,
  closesFromCandles,
  pearson,
  provenance,
  returnsFromCloses,
  round4,
  spearman,
  stabilityFromAbsCorr,
} from './b9-b17-helpers';

const CAUSATION_NOTE =
  'Statistical association only — not causation. Common factors (index/sector/macro) may drive both series.';

export function assessRelationship(
  leftId: string,
  rightId: string,
  leftCloses: number[],
  rightCloses: number[],
  kind: RelationshipPairKind,
  windowDays = 60,
  now: Date = new Date(),
): RelationshipMetrics {
  const prov = provenance(
    'relationship-intelligence',
    {
      modelVersion: 'relationship.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  const l = returnsFromCloses(leftCloses);
  const r = returnsFromCloses(rightCloses);
  const aligned = alignReturns(l, r);
  const n = Math.min(windowDays, aligned.left.length);
  if (n < 10) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      kind,
      left: leftId,
      right: rightId,
      sampleSize: n,
      windowDays,
      note: CAUSATION_NOTE,
      provenance: prov,
    };
  }
  const xs = aligned.left.slice(-n);
  const ys = aligned.right.slice(-n);
  const p = pearson(xs, ys);
  const s = spearman(xs, ys);
  const b = beta(xs, ys);
  const upX: number[] = [];
  const upY: number[] = [];
  const dnX: number[] = [];
  const dnY: number[] = [];
  for (let i = 0; i < n; i++) {
    if (ys[i] > 0) {
      upX.push(xs[i]);
      upY.push(ys[i]);
    } else if (ys[i] < 0) {
      dnX.push(xs[i]);
      dnY.push(ys[i]);
    }
  }
  const rollingN = Math.min(20, n);
  const rolling = rollingN >= 10 ? pearson(xs.slice(-rollingN), ys.slice(-rollingN)) : null;

  return {
    status: 'AVAILABLE',
    kind,
    left: leftId,
    right: rightId,
    pearson: p,
    spearman: s,
    rollingPearson: rolling,
    upsideCorrelation: pearson(upX, upY),
    downsideCorrelation: pearson(dnX, dnY),
    beta: b,
    conditionalBeta: dnX.length >= 10 ? beta(dnX, dnY) : null,
    stability: stabilityFromAbsCorr(p != null ? Math.abs(p) : null, n),
    sampleSize: n,
    windowDays,
    note: CAUSATION_NOTE,
    provenance: { ...prov, sampleSize: n },
  };
}

export function assessRelationshipFromCandles(
  leftId: string,
  rightId: string,
  leftCandles: Array<{ close?: number }>,
  rightCandles: Array<{ close?: number }>,
  kind: RelationshipPairKind,
  windowDays = 60,
  now?: Date,
): RelationshipMetrics {
  return assessRelationship(
    leftId,
    rightId,
    closesFromCandles(leftCandles),
    closesFromCandles(rightCandles),
    kind,
    windowDays,
    now,
  );
}

export function assessLeadLag(
  leadSymbol: string,
  lagSymbol: string,
  leadCloses: number[],
  lagCloses: number[],
  lagDays: 1 | 2 | 5 | 10,
  marketRegime?: string | null,
  now: Date = new Date(),
): LeadLagRelationship {
  const prov = provenance(
    'lead-lag-intelligence',
    {
      modelVersion: 'lead-lag.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  const leadR = returnsFromCloses(leadCloses);
  const lagR = returnsFromCloses(lagCloses);
  if (leadR.length < lagDays + 15 || lagR.length < lagDays + 15) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      leadSymbol,
      lagSymbol,
      lagDays,
      sampleSize: Math.min(leadR.length, lagR.length),
      marketRegime: marketRegime ?? null,
      note: CAUSATION_NOTE,
      provenance: prov,
    };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.min(leadR.length - lagDays, lagR.length - lagDays);
  for (let i = 0; i < n; i++) {
    xs.push(leadR[i]);
    ys.push(lagR[i + lagDays]);
  }
  const strength = pearson(xs, ys);
  return {
    status: strength == null ? 'UNAVAILABLE' : 'AVAILABLE',
    reason: strength == null ? 'INSUFFICIENT_HISTORY' : undefined,
    leadSymbol,
    lagSymbol,
    lagDays,
    relationshipStrength: strength,
    sampleSize: xs.length,
    stability: stabilityFromAbsCorr(strength != null ? Math.abs(strength) : null, xs.length),
    marketRegime: marketRegime ?? null,
    note: CAUSATION_NOTE,
    provenance: { ...prov, sampleSize: xs.length },
  };
}

export function bestLeadLag(
  aSymbol: string,
  bSymbol: string,
  aCloses: number[],
  bCloses: number[],
  marketRegime?: string | null,
  now?: Date,
): LeadLagRelationship {
  const lags: Array<1 | 2 | 5 | 10> = [1, 2, 5, 10];
  let best: LeadLagRelationship | null = null;
  for (const lag of lags) {
    const ab = assessLeadLag(aSymbol, bSymbol, aCloses, bCloses, lag, marketRegime, now);
    const ba = assessLeadLag(bSymbol, aSymbol, bCloses, aCloses, lag, marketRegime, now);
    for (const cand of [ab, ba]) {
      if (cand.status !== 'AVAILABLE' || cand.relationshipStrength == null) continue;
      if (
        !best ||
        best.relationshipStrength == null ||
        Math.abs(cand.relationshipStrength) > Math.abs(best.relationshipStrength)
      ) {
        best = cand;
      }
    }
  }
  return (
    best ?? {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      leadSymbol: aSymbol,
      lagSymbol: bSymbol,
      lagDays: 1,
      sampleSize: 0,
      marketRegime: marketRegime ?? null,
      note: CAUSATION_NOTE,
      provenance: provenance('lead-lag-intelligence', {}, now),
    }
  );
}

export { round4 };
