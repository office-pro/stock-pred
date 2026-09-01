/**
 * T2.2 Thesis Intelligence — advisory only.
 * Structures and reassesses trading thesis; never authorizes trades.
 */

export type ThesisState = 'VALID' | 'WEAKENING' | 'INVALIDATED' | 'UNKNOWN';

export type ThesisEvidencePolarity = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNKNOWN';

export interface ThesisEvidenceItem {
  code: string;
  message: string;
  /** TI field path, e.g. crossSectionalRs.rsBucket */
  source: string;
  polarity: ThesisEvidencePolarity;
}

export interface StructuredThesis {
  symbol: string;
  side: 'LONG' | 'SHORT';
  tradeHorizon?: string;
  strategyTag?: string;
  setup: string;
  primaryThesis: string;
  supportingEvidence: ThesisEvidenceItem[];
  /** Explicit thesis-invalid conditions only — not risk stops unless declared. */
  invalidationConditions: string[];
  state: ThesisState;
  provenance: {
    engineVersion: string;
    generatedAt: string;
    sourceDataTimestamp: string;
  };
}

export type ThesisHistoryEventType =
  | 'THESIS_CREATED'
  | 'THESIS_REASSESSED'
  | 'THESIS_WEAKENED'
  | 'THESIS_INVALIDATED';

export interface ThesisHistoryEvent {
  type: ThesisHistoryEventType;
  at: string;
  priorState?: ThesisState;
  newState: ThesisState;
  changes: string[];
}

/** Frozen at decision time — never rewritten. */
export interface ThesisSnapshot {
  initialThesis: StructuredThesis;
  snapshotAt: string;
  intelligenceSchemaVersion?: string;
}
