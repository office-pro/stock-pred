/**
 * T2.4 Trade Lifecycle Intelligence — measurement / enrichment only.
 * Materialize-on-read; never authorizes trades or advances state.
 */

import type { DecisionLedgerEntry } from './agent';

export type TradeLifecycleStage =
  | 'IDEA'
  | 'CANDIDATE'
  | 'ELIGIBLE'
  | 'WAIT'
  | 'APPROVE'
  | 'REJECT'
  | 'ENTRY'
  | 'MANAGEMENT'
  | 'EXIT'
  | 'OUTCOME'
  | 'POST_TRADE'
  | 'UNKNOWN';

export interface TradeLifecycleEvent {
  /** STAGE = recorded fact transition; CONTEXT = advisory / informational only. */
  kind: 'STAGE' | 'CONTEXT';
  stage?: TradeLifecycleStage;
  at: string;
  source: string;
  detail?: string;
  /** P5 outcome kind when event is outcome-related (informational for non-ACTUAL). */
  outcomeKind?: import('./p5-measurement').P5OutcomeKind;
}

export interface TradeLifecycleMetrics {
  expectedR?: number | null;
  /** ACTUAL outcomes only. */
  realizedR?: number | null;
  entryQuality?: number | null;
  /** Null unless an explicit exit-time score exists on recorded facts. */
  exitQuality?: number | null;
  /** ACTUAL outcomes only — gross vs net R drag when both exist. */
  executionDrag?: number | null;
  /** Planned horizon from wait expiry metadata — not observed duration. */
  plannedWaitDurationMs?: number | null;
  /** Observed wait duration — null when explicit start/end pair is unavailable. */
  waitDurationMs?: number | null;
  thesisEventCount?: number;
  /** Thesis changes after THESIS_CREATED — excludes initial snapshot event. */
  thesisEvolutionCount?: number;
}

export interface TradeLifecycleSnapshot {
  decisionId: string;
  symbol: string;
  currentStage: TradeLifecycleStage;
  events: TradeLifecycleEvent[];
  metrics: TradeLifecycleMetrics;
  provenance: { engineVersion: string; generatedAt: string };
}

/** API read-model wrapper — never persisted on the immutable ledger row. */
export interface DecisionWithLifecycle {
  decision: DecisionLedgerEntry;
  lifecycleSnapshot: TradeLifecycleSnapshot;
}
