/**
 * T2.1 WAIT Intelligence — advisory only.
 * Explains why to wait; never authorizes, resizes, or bypasses Gate.
 */

export type WaitReevaluateTrigger = 'PRICE' | 'TIME' | 'EVENT' | 'UNAVAILABLE';

export interface WaitInvalidation {
  conditions: string[];
  reasonCodes: string[];
}

export interface WaitReevaluateWhen {
  trigger: WaitReevaluateTrigger;
  priceLevel?: number;
  timeAt?: number;
  /** Only when catalyst event already exists in TI snapshot. */
  eventRef?: string;
  unavailableReason?: string;
}

/** T2.1 advisory envelope — decision is always WAIT. */
export interface WaitRecommendation {
  decision: 'WAIT';
  reasonCodes: string[];
  summary: string;
  /** Recommended reassessment time — not authoritative TTL (see waitExpiresAt). */
  expiryAt: number;
  invalidation: WaitInvalidation;
  reevaluateWhen: WaitReevaluateWhen;
  /** Display-only delta since prior evaluation. */
  evidenceDelta?: string[];
}

/** Minimal digest for evidenceDelta without storing full prior snapshot. */
export interface WaitIntelligenceDigest {
  regimeCombo?: string;
  expectedValueR?: number;
  rsBucket?: string;
  regimeCompatibility?: string;
  eventRisk?: string;
}
