/**
 * P7 Advanced Safety Breakers — shared types.
 * Stop/restrict only; never authorization inputs.
 */
import type { DecisionReasonCode } from './agent';

export type P7BreakerId =
  | 'daily_auto_count'
  | 'auto_pnl_drawdown'
  | 'veto_streak'
  | 'quote_stale'
  | 'broker_disconnect'
  | 'score_anomaly'
  | 'slippage_anomaly'
  | 'quality_drift'
  | 'ev_drift'
  | 'calibration_drift'
  | 'regime_drift'
  | 'execution_drift';

export interface P7BreakerTrip {
  breakerId: P7BreakerId;
  reasonCode: DecisionReasonCode;
  reason: string;
}

/** Per-breaker evaluation sub-state (P7.5 aggregate builds on these). */
export type P7BreakerSubState = 'INSUFFICIENT' | 'UNKNOWN' | 'CLEAR' | 'DEGRADED' | 'STOP';

export type P7AggregateState =
  | 'INSUFFICIENT'
  | 'UNKNOWN'
  | 'CLEAR'
  | 'RESTRICT'
  | 'STOP'
  | 'SEVERE_STOP';

export type P7Enforcement = 'NONE' | 'RESTRICT_AUTONOMOUS' | 'FORCE_APPROVAL';

/** P7 sample floors — separate from P5 evidence unlock floors. */
export interface P7SampleFloors {
  minActualOutcomesPerWindow: number;
  minQualityBandSamples: number;
  minCalibrationBuckets: number;
  minRegimeDecisions: number;
  liveWindowDecisions: number;
}

export const DEFAULT_P7_SAMPLE_FLOORS: P7SampleFloors = {
  minActualOutcomesPerWindow: 10,
  minQualityBandSamples: 8,
  minCalibrationBuckets: 5,
  minRegimeDecisions: 15,
  liveWindowDecisions: 20,
};

/** Quality drift breaker config (trip semantics preserved from circuit-breakers). */
export interface P7QualityBreakerConfig {
  qualityDriftMinScore: number;
  qualityDriftHistMinAvgR: number;
  qualityDriftLiveMaxAvgR: number;
  qualityDriftLiveWarnAvgR: number;
  recoveryEvaluations: number;
  maxEvidenceAgeMs: number;
}

export const DEFAULT_P7_QUALITY_BREAKER_CONFIG: P7QualityBreakerConfig = {
  qualityDriftMinScore: 80,
  qualityDriftHistMinAvgR: 0.4,
  qualityDriftLiveMaxAvgR: 0,
  qualityDriftLiveWarnAvgR: -0.1,
  recoveryEvaluations: 3,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export interface P7EvBreakerConfig {
  maxEvDeteriorationR: number;
  maxEvDeteriorationWarnR: number;
  recoveryEvaluations: number;
  maxEvidenceAgeMs: number;
}

export const DEFAULT_P7_EV_BREAKER_CONFIG: P7EvBreakerConfig = {
  maxEvDeteriorationR: 0.5,
  maxEvDeteriorationWarnR: 0.25,
  recoveryEvaluations: 3,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export interface P7CalibrationBreakerConfig {
  maxCalibrationDrift: number;
  maxCalibrationDriftWarn: number;
  recoveryEvaluations: number;
  maxEvidenceAgeMs: number;
}

export const DEFAULT_P7_CALIBRATION_BREAKER_CONFIG: P7CalibrationBreakerConfig = {
  maxCalibrationDrift: 0.25,
  maxCalibrationDriftWarn: 0.12,
  recoveryEvaluations: 3,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export interface P7RegimeBreakerConfig {
  maxRegimeMismatchRate: number;
  maxRegimeMismatchWarn: number;
  recoveryEvaluations: number;
  maxEvidenceAgeMs: number;
}

export const DEFAULT_P7_REGIME_BREAKER_CONFIG: P7RegimeBreakerConfig = {
  maxRegimeMismatchRate: 0.6,
  maxRegimeMismatchWarn: 0.35,
  recoveryEvaluations: 3,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export interface P7QualityBandSample {
  decisionId: string;
  qualityScore: number;
  netR: number;
  closedAt: number;
  soakRunId?: string;
}

export interface P7QualityMetrics {
  qualityBandScore: number | null;
  qualityHistAvgR: number | null;
  qualityLiveAvgR: number | null;
  liveSampleCount: number;
  histSampleCount: number;
  latestLiveClosedAt: number | null;
}

export interface P7EvMetrics {
  evHistAvgR: number | null;
  evLiveAvgR: number | null;
  deterioration: number | null;
  liveSampleCount: number;
  histSampleCount: number;
  latestLiveClosedAt: number | null;
}

export interface P7CalibrationMetrics {
  calibrationDrift: number | null;
  calibrationErrorHist: number | null;
  calibrationErrorLive: number | null;
  liveBucketCount: number;
  histBucketCount: number;
  latestLiveClosedAt: number | null;
}

export type P7RegimeObservability = 'UNKNOWN' | 'NORMAL' | 'DRIFT' | 'SEVERE_DRIFT';

export interface P7RegimeMetrics {
  regimeMismatchRate: number | null;
  liveAvgR: number | null;
  observability: P7RegimeObservability;
  decisionCount: number;
  mismatchCount: number;
  unknownOutcomeRegimeCount: number;
  latestLiveClosedAt: number | null;
}

export interface P7RecoveryState {
  consecutiveClearEvaluations: number;
}

/** @deprecated use P7RecoveryState */
export type P7QualityRecoveryState = P7RecoveryState;

export interface P7QualityBreakerResult {
  breakerId: 'quality_drift';
  subState: P7BreakerSubState;
  metrics: P7QualityMetrics;
  recovery: P7RecoveryState;
  reason: string;
}

export interface P7EvBreakerResult {
  breakerId: 'ev_drift';
  subState: P7BreakerSubState;
  metrics: P7EvMetrics;
  recovery: P7RecoveryState;
  reason: string;
}

export interface P7CalibrationBreakerResult {
  breakerId: 'calibration_drift';
  subState: P7BreakerSubState;
  metrics: P7CalibrationMetrics;
  recovery: P7RecoveryState;
  reason: string;
}

export interface P7RegimeBreakerResult {
  breakerId: 'regime_drift';
  subState: P7BreakerSubState;
  metrics: P7RegimeMetrics;
  recovery: P7RecoveryState;
  reason: string;
}

export type P7AdvancedBreakerId =
  | 'quality_drift'
  | 'ev_drift'
  | 'calibration_drift'
  | 'regime_drift';

export interface P7BreakerEvidence {
  sampleCounts: Record<string, number>;
  windows: Record<string, string>;
  generatedAt: string;
}

export interface P7BreakerSystemReport {
  aggregate: P7AggregateState;
  subStates: Partial<Record<P7BreakerId, P7BreakerSubState>>;
  activeTrips: P7BreakerTrip[];
  enforcement: P7Enforcement;
  evidence: P7BreakerEvidence;
  insufficientBreakers: P7AdvancedBreakerId[];
}

export type P7ValidationVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface P7ValidationCheck {
  id: string;
  label: string;
  verdict: P7ValidationVerdict;
  detail: string;
}

export interface P7ValidationReport {
  schemaVersion: 'p7-validation-report.v1';
  generatedAt: string;
  checks: P7ValidationCheck[];
  verdict: P7ValidationVerdict;
}
