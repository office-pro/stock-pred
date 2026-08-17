/** Unusual-behavior band. Not a finding of market abuse. */
export type ManipulationBand = 'NORMAL' | 'SUSPICIOUS' | 'INVESTIGATE';

export interface ManipulationFlags {
  accumulation: boolean;
  expansion: boolean;
  dump: boolean;
}

/**
 * Per-stock unusual-activity snapshot vs that name's own history and Nifty.
 * Intensities are 0–100 statistical anomaly scores. Probability is optional ML.
 */
export interface ManipulationSnapshot {
  band: ManipulationBand;
  /** Statistical blend 0–100. */
  investigateIntensity: number;
  /** Tabular model P(investigate) 0–1 when artifacts exist; otherwise null. */
  investigateProbability: number | null;
  priceAnomaly: number;
  volumeAnomaly: number;
  volatilityAnomaly: number;
  marketRelativeAnomaly: number;
  evidence: string[];
  flags: ManipulationFlags;
  modelVersion: string;
}

export const MANIPULATION_DISCLAIMER =
  "Unusual vs this stock's history — not a finding of market abuse.";
