/**
 * T2.3 Exit Intelligence — advisory only.
 * Recommends HOLD / TRIM / EXIT for human consideration; never executes exits.
 */

export type ExitRecommendationAction = 'HOLD' | 'TRIM' | 'EXIT';

export interface ExitEvidenceItem {
  code: string;
  message: string;
  /** Field path, e.g. position.currentPrice or thesis.state */
  source: string;
  /** When true, evidence is historical P5 context — not live position state. */
  historical?: boolean;
}

/**
 * T2.3 advisory envelope.
 * `EXIT` means "human should consider exiting" — not an execution order.
 */
export interface ExitRecommendation {
  action: ExitRecommendationAction;
  /** Always true — never authorizes broker execution. */
  advisory: true;
  reasonCodes: string[];
  summary: string;
  evidence: ExitEvidenceItem[];
  provenance: {
    engineVersion: string;
    generatedAt: string;
    sourceDataTimestamp: string;
  };
}

/** Historical P5 path metrics — context only when temporally valid for the position. */
export interface ExitIntelligenceP5Context {
  decisionId: string;
  maeR?: number | null;
  mfeR?: number | null;
  /** Epoch ms — must be <= recommendation time and tied to this decision. */
  asOf: number;
}
