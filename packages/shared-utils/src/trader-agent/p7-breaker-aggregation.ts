/**
 * P7.5 — Breaker aggregation and enforcement mapping.
 */
import type {
  P7AdvancedBreakerId,
  P7AggregateState,
  P7BreakerEvidence,
  P7BreakerSubState,
  P7BreakerSystemReport,
  P7Enforcement,
  P7RecoveryState,
  P7SampleFloors,
} from '@stockpred/shared-types';
import { DEFAULT_P7_SAMPLE_FLOORS } from '@stockpred/shared-types';
import type { BreakerConfig, BreakerMetrics, BreakerTrip } from './circuit-breakers';
import { DEFAULT_BREAKER_CONFIG, evaluateBreakers } from './circuit-breakers';
import { buildP7CalibrationMetrics, evaluateP7CalibrationBreaker } from './p7-calibration-breaker';
import { buildP7EvMetrics, evaluateP7EvBreaker } from './p7-ev-breaker';
import { buildP7QualityMetrics, evaluateP7QualityBreaker } from './p7-quality-breaker';
import { buildP7RegimeMetrics, evaluateP7RegimeBreaker } from './p7-regime-breaker';
import type { ResolveOutcomeRegime } from './p7-regime-breaker';
import type { DecisionLedgerRecord } from '@stockpred/shared-types';

const AGGREGATE_RANK: Record<P7AggregateState, number> = {
  INSUFFICIENT: 1,
  UNKNOWN: 2,
  CLEAR: 3,
  RESTRICT: 4,
  STOP: 5,
  SEVERE_STOP: 6,
};

const SUBSTATE_RANK: Record<P7BreakerSubState, number> = {
  INSUFFICIENT: 0,
  UNKNOWN: 1,
  CLEAR: 2,
  DEGRADED: 3,
  STOP: 4,
};

export interface P7RecoveryStore {
  quality: P7RecoveryState;
  ev: P7RecoveryState;
  calibration: P7RecoveryState;
  regime: P7RecoveryState;
}

export function emptyP7RecoveryStore(): P7RecoveryStore {
  return {
    quality: { consecutiveClearEvaluations: 0 },
    ev: { consecutiveClearEvaluations: 0 },
    calibration: { consecutiveClearEvaluations: 0 },
    regime: { consecutiveClearEvaluations: 0 },
  };
}

export interface BuildP7BreakerMetricsInput {
  records: DecisionLedgerRecord[];
  soakRunId?: string | null;
  floors?: Partial<P7SampleFloors>;
  resolveOutcomeRegime?: ResolveOutcomeRegime;
  now?: number;
}

export interface P7BuiltMetrics {
  breakerMetrics: BreakerMetrics;
  recovery: P7RecoveryStore;
  evidence: P7BreakerEvidence;
  advancedSubStates: Record<P7AdvancedBreakerId, P7BreakerSubState>;
}

export function buildP7BreakerMetrics(
  base: BreakerMetrics,
  input: BuildP7BreakerMetricsInput,
  recovery: P7RecoveryStore = emptyP7RecoveryStore(),
): P7BuiltMetrics {
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const qualityMetrics = buildP7QualityMetrics({
    records: input.records,
    soakRunId: input.soakRunId,
    floors,
  });
  const evMetrics = buildP7EvMetrics({
    records: input.records,
    soakRunId: input.soakRunId,
    floors,
  });
  const calibrationMetrics = buildP7CalibrationMetrics({
    records: input.records,
    soakRunId: input.soakRunId,
    floors,
  });
  const regimeMetrics = buildP7RegimeMetrics({
    records: input.records,
    soakRunId: input.soakRunId,
    floors,
    resolveOutcomeRegime: input.resolveOutcomeRegime,
  });

  const qualityEval = evaluateP7QualityBreaker({
    metrics: qualityMetrics,
    floors,
    recovery: recovery.quality,
    now: input.now,
  });
  const evEval = evaluateP7EvBreaker({
    metrics: evMetrics,
    floors,
    recovery: recovery.ev,
    now: input.now,
  });
  const calibrationEval = evaluateP7CalibrationBreaker({
    metrics: calibrationMetrics,
    floors,
    recovery: recovery.calibration,
    now: input.now,
  });
  const regimeEval = evaluateP7RegimeBreaker({
    metrics: regimeMetrics,
    floors,
    recovery: recovery.regime,
    now: input.now,
  });

  const nextRecovery: P7RecoveryStore = {
    quality: qualityEval.recovery,
    ev: evEval.recovery,
    calibration: calibrationEval.recovery,
    regime: regimeEval.recovery,
  };

  const breakerMetrics: BreakerMetrics = {
    ...base,
    qualityBandScore: qualityMetrics.qualityBandScore,
    qualityHistAvgR: qualityMetrics.qualityHistAvgR,
    qualityLiveAvgR: qualityMetrics.qualityLiveAvgR,
    evHistAvgR: evMetrics.evHistAvgR,
    evLiveAvgR: evMetrics.evLiveAvgR,
    calibrationDrift: calibrationMetrics.calibrationDrift,
    regimeMismatchRate: regimeMetrics.regimeMismatchRate,
    executionDeterioration: null,
  };

  const evidence: P7BreakerEvidence = {
    sampleCounts: {
      qualityLive: qualityMetrics.liveSampleCount,
      qualityHist: qualityMetrics.histSampleCount,
      evLive: evMetrics.liveSampleCount,
      evHist: evMetrics.histSampleCount,
      calibrationLiveBuckets: calibrationMetrics.liveBucketCount,
      regimeDecisions: regimeMetrics.decisionCount,
    },
    windows: {
      liveWindow: String(floors.liveWindowDecisions),
      histSource: input.soakRunId ? `soak:${input.soakRunId}` : 'soak-tagged',
    },
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
  };

  return {
    breakerMetrics,
    recovery: nextRecovery,
    evidence,
    advancedSubStates: {
      quality_drift: qualityEval.subState,
      ev_drift: evEval.subState,
      calibration_drift: calibrationEval.subState,
      regime_drift: regimeEval.subState,
    },
  };
}

export interface EvaluateP7BreakerSystemInput {
  metrics: BreakerMetrics;
  config?: BreakerConfig;
  advancedSubStates: Record<P7AdvancedBreakerId, P7BreakerSubState>;
  brokerConnected: boolean;
  operatingMode?: 'PAPER' | 'LIVE';
}

function aggregateFromSubStates(
  subStates: Record<P7AdvancedBreakerId, P7BreakerSubState>,
): P7AggregateState {
  const values = Object.values(subStates);
  if (values.some((s) => s === 'STOP')) return 'STOP';
  if (values.some((s) => s === 'DEGRADED')) return 'RESTRICT';
  if (values.every((s) => s === 'CLEAR')) return 'CLEAR';
  if (values.some((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  return 'INSUFFICIENT';
}

function applySevereClass(
  aggregate: P7AggregateState,
  classicTrips: BreakerTrip[],
  metrics: BreakerMetrics,
  config: BreakerConfig,
  advancedSubStates: Record<P7AdvancedBreakerId, P7BreakerSubState>,
): P7AggregateState {
  const severeTrips = classicTrips.filter((t) => {
    if (t.breakerId === 'broker_disconnect') return true;
    if (
      t.breakerId === 'auto_pnl_drawdown' &&
      metrics.autoPnlDrawdownPct >= config.maxAutoPnlDrawdownPct * 2
    ) {
      return true;
    }
    return false;
  });
  const tripleDrift =
    advancedSubStates.quality_drift === 'STOP' &&
    advancedSubStates.ev_drift === 'STOP' &&
    advancedSubStates.calibration_drift === 'STOP';
  if (severeTrips.length > 0 || tripleDrift) return 'SEVERE_STOP';
  return aggregate;
}

export function mapAggregateToEnforcement(aggregate: P7AggregateState): P7Enforcement {
  switch (aggregate) {
    case 'UNKNOWN':
    case 'RESTRICT':
      return 'RESTRICT_AUTONOMOUS';
    case 'STOP':
    case 'SEVERE_STOP':
      return 'FORCE_APPROVAL';
    default:
      return 'NONE';
  }
}

export function evaluateP7BreakerSystem(
  input: EvaluateP7BreakerSystemInput,
): P7BreakerSystemReport {
  const config = input.config ?? DEFAULT_BREAKER_CONFIG;
  const classic = evaluateBreakers(input.metrics, config);
  let aggregate = aggregateFromSubStates(input.advancedSubStates);
  aggregate = applySevereClass(
    aggregate,
    classic.trips,
    input.metrics,
    config,
    input.advancedSubStates,
  );

  if (classic.tripped && aggregate !== 'SEVERE_STOP' && aggregate === 'CLEAR') {
    aggregate = 'STOP';
  }
  if (classic.tripped && aggregate === 'INSUFFICIENT') {
    aggregate = 'STOP';
  }

  const enforcement = mapAggregateToEnforcement(aggregate);
  const insufficientBreakers = (
    Object.entries(input.advancedSubStates) as Array<[P7AdvancedBreakerId, P7BreakerSubState]>
  )
    .filter(([, s]) => s === 'INSUFFICIENT')
    .map(([id]) => id);

  return {
    aggregate,
    subStates: {
      ...input.advancedSubStates,
      daily_auto_count:
        input.metrics.dailyAutoAcceptCount >= config.maxDailyAutoAccepts ? 'STOP' : 'CLEAR',
      broker_disconnect: input.brokerConnected ? 'CLEAR' : 'STOP',
    },
    activeTrips: classic.trips.map((t) => ({
      breakerId: t.breakerId,
      reasonCode: t.reasonCode,
      reason: t.reason,
    })),
    enforcement,
    evidence: {
      sampleCounts: {},
      windows: {},
      generatedAt: new Date().toISOString(),
    },
    insufficientBreakers,
  };
}

export function maxSubState(a: P7BreakerSubState, b: P7BreakerSubState): P7BreakerSubState {
  return SUBSTATE_RANK[a] >= SUBSTATE_RANK[b] ? a : b;
}

export function maxAggregate(a: P7AggregateState, b: P7AggregateState): P7AggregateState {
  return AGGREGATE_RANK[a] >= AGGREGATE_RANK[b] ? a : b;
}
