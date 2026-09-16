/**
 * B12 Inverse / Beneficiary — event-based, not permanent inverse labels.
 */
import type {
  BeneficiaryCandidate,
  InverseBeneficiarySnapshot,
  InverseRelationshipClass,
} from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  closesFromCandles,
  provenance,
  returnsFromCloses,
  round4,
  stabilityFromAbsCorr,
} from './b9-b17-helpers';

export interface InverseSeriesInput {
  symbol: string;
  closes: number[];
}

function classify(
  positiveRate: number,
  medianResponse: number,
  corrWithAnchorDown: number | null,
): InverseRelationshipClass {
  if (positiveRate < 0.55 || medianResponse <= 0) return 'NO_STABLE_RELATIONSHIP';
  if (corrWithAnchorDown != null && corrWithAnchorDown <= -0.35 && positiveRate >= 0.65) {
    return 'DIRECT_INVERSE';
  }
  if (positiveRate >= 0.65 && medianResponse > 0.01) return 'CONDITIONAL_INVERSE';
  if (positiveRate >= 0.6) return 'RELATIVE_BENEFICIARY';
  if (medianResponse > 0 && positiveRate >= 0.55) return 'DEFENSIVE';
  return 'UNSTABLE';
}

export function assessInverseBeneficiaries(
  anchorSymbol: string,
  anchorCloses: number[],
  peers: InverseSeriesInput[],
  downsideThresholdPct = -0.05,
  forwardDays = 5,
  now: Date = new Date(),
): InverseBeneficiarySnapshot {
  const prov = provenance(
    'inverse-beneficiary-intelligence',
    {
      modelVersion: 'inverse-beneficiary.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  const anchorR = returnsFromCloses(anchorCloses);
  if (anchorR.length < 40) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      anchorSymbol,
      downsideThresholdPct: downsideThresholdPct * 100,
      beneficiaries: [],
      provenance: prov,
    };
  }

  const eventIdx: number[] = [];
  for (let i = 0; i < anchorR.length - forwardDays; i++) {
    if (anchorR[i] <= downsideThresholdPct) eventIdx.push(i);
  }
  if (eventIdx.length < 5) {
    return {
      status: 'UNAVAILABLE',
      reason: 'NO_COMPARABLE_EVENTS',
      anchorSymbol,
      downsideThresholdPct: downsideThresholdPct * 100,
      beneficiaries: [],
      provenance: { ...prov, sampleSize: eventIdx.length },
    };
  }

  const beneficiaries: BeneficiaryCandidate[] = [];
  for (const peer of peers) {
    if (peer.symbol === anchorSymbol) continue;
    const peerR = returnsFromCloses(peer.closes);
    const responses: number[] = [];
    const downPairsA: number[] = [];
    const downPairsP: number[] = [];
    for (const i of eventIdx) {
      if (i + forwardDays >= peerR.length || i >= peerR.length) continue;
      let fwd = 0;
      for (let k = 1; k <= forwardDays; k++) {
        if (i + k < peerR.length) fwd += peerR[i + k];
      }
      responses.push(fwd);
      downPairsA.push(anchorR[i]);
      downPairsP.push(peerR[i] ?? 0);
    }
    if (responses.length < 5) continue;
    const positive = responses.filter((r) => r > 0).length;
    const positiveRate = round4(positive / responses.length);
    const medianResponse = round4(
      [...responses].sort((a, b) => a - b)[Math.floor(responses.length / 2)],
    );
    // Correlation of same-day moves on event days (not causation).
    let corr: number | null = null;
    if (downPairsA.length >= 8) {
      const meanA = downPairsA.reduce((s, x) => s + x, 0) / downPairsA.length;
      const meanP = downPairsP.reduce((s, x) => s + x, 0) / downPairsP.length;
      let num = 0;
      let denA = 0;
      let denP = 0;
      for (let i = 0; i < downPairsA.length; i++) {
        const da = downPairsA[i] - meanA;
        const dp = downPairsP[i] - meanP;
        num += da * dp;
        denA += da * da;
        denP += dp * dp;
      }
      if (denA > 0 && denP > 0) corr = round4(num / Math.sqrt(denA * denP));
    }
    const classification = classify(positiveRate, medianResponse, corr);
    if (classification === 'NO_STABLE_RELATIONSHIP') continue;
    beneficiaries.push({
      symbol: peer.symbol,
      positiveResponseRate: round4(positiveRate * 100),
      medianResponse,
      sampleSize: responses.length,
      stability: stabilityFromAbsCorr(positiveRate, responses.length),
      classification,
    });
  }

  beneficiaries.sort((a, b) => (b.positiveResponseRate ?? 0) - (a.positiveResponseRate ?? 0));

  return {
    status: beneficiaries.length ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: beneficiaries.length ? undefined : 'NO_COMPARABLE_EVENTS',
    anchorSymbol,
    downsideThresholdPct: downsideThresholdPct * 100,
    beneficiaries: beneficiaries.slice(0, 20),
    provenance: { ...prov, sampleSize: eventIdx.length },
  };
}

export function assessInverseBeneficiariesFromCandles(
  anchorSymbol: string,
  anchorCandles: Array<{ close?: number }>,
  peers: Array<{ symbol: string; candles: Array<{ close?: number }> }>,
  downsideThresholdPct = -0.05,
  forwardDays = 5,
  now?: Date,
): InverseBeneficiarySnapshot {
  return assessInverseBeneficiaries(
    anchorSymbol,
    closesFromCandles(anchorCandles),
    peers.map((p) => ({ symbol: p.symbol, closes: closesFromCandles(p.candles) })),
    downsideThresholdPct,
    forwardDays,
    now,
  );
}
