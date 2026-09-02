/**
 * P7.2 — EV drift breaker (pure compute).
 * Measures performance deterioration — never changes EV model inputs.
 */
import {
  DEFAULT_P7_EV_BREAKER_CONFIG,
  DEFAULT_P7_SAMPLE_FLOORS,
  type DecisionLedgerRecord,
  type P7BreakerSubState,
  type P7EvBreakerConfig,
  type P7EvBreakerResult,
  type P7EvMetrics,
  type P7RecoveryState,
  type P7SampleFloors,
} from '@stockpred/shared-types';
import {
  extractActualDecisionOutcomePairs,
  p7Mean,
  splitHistLivePairs,
} from './p7-ledger-outcomes';

export interface P7EvSample {
  decisionId: string;
  predictedEvR: number;
  netR: number;
  closedAt: number;
  soakRunId?: string;
}

export function extractP7EvSamples(records: DecisionLedgerRecord[]): P7EvSample[] {
  const samples: P7EvSample[] = [];
  for (const pair of extractActualDecisionOutcomePairs(records)) {
    const predictedEvR = pair.decision.intelligenceSnapshot?.expectedValue?.expectedValueR;
    if (predictedEvR == null || !Number.isFinite(predictedEvR)) continue;
    samples.push({
      decisionId: pair.decision.decisionId,
      predictedEvR,
      netR: pair.netR,
      closedAt: pair.closedAt,
      soakRunId: pair.soakRunId,
    });
  }
  return samples;
}

export interface BuildP7EvMetricsInput {
  records: DecisionLedgerRecord[];
  config?: Partial<P7EvBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  soakRunId?: string | null;
  walkForwardHistAvgR?: number | null;
}

export function buildP7EvMetrics(input: BuildP7EvMetricsInput): P7EvMetrics {
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const samples = extractP7EvSamples(input.records);
  const { hist, live } = splitHistLivePairs(samples, floors, input.soakRunId);

  const evHistAvgR =
    p7Mean(hist.map((s) => s.netR)) ??
    (input.walkForwardHistAvgR != null && Number.isFinite(input.walkForwardHistAvgR)
      ? input.walkForwardHistAvgR
      : null);
  const evLiveAvgR = p7Mean(live.map((s) => s.netR));
  const deterioration = evHistAvgR != null && evLiveAvgR != null ? evHistAvgR - evLiveAvgR : null;
  const latestLiveClosedAt = live.length > 0 ? live[live.length - 1]!.closedAt : null;

  return {
    evHistAvgR,
    evLiveAvgR,
    deterioration,
    liveSampleCount: live.length,
    histSampleCount: hist.length,
    latestLiveClosedAt,
  };
}

function classifyDeterioration(
  deterioration: number,
  config: P7EvBreakerConfig,
): 'CLEAR' | 'DEGRADED' | 'STOP' {
  if (deterioration >= config.maxEvDeteriorationR) return 'STOP';
  if (deterioration >= config.maxEvDeteriorationWarnR) return 'DEGRADED';
  return 'CLEAR';
}

export interface EvaluateP7EvBreakerInput {
  metrics: P7EvMetrics;
  config?: Partial<P7EvBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  recovery?: P7RecoveryState;
  now?: number;
}

export function evaluateP7EvBreaker(input: EvaluateP7EvBreakerInput): P7EvBreakerResult {
  const config = { ...DEFAULT_P7_EV_BREAKER_CONFIG, ...input.config };
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const now = input.now ?? Date.now();
  const recovery = input.recovery ?? { consecutiveClearEvaluations: 0 };
  const { metrics } = input;

  if (
    metrics.liveSampleCount < floors.minActualOutcomesPerWindow ||
    metrics.evHistAvgR == null ||
    metrics.deterioration == null
  ) {
    return {
      breakerId: 'ev_drift',
      subState: 'INSUFFICIENT',
      metrics,
      recovery,
      reason: 'EV sample floor unmet or hist baseline missing',
    };
  }

  if (
    metrics.latestLiveClosedAt != null &&
    now - metrics.latestLiveClosedAt > config.maxEvidenceAgeMs
  ) {
    return {
      breakerId: 'ev_drift',
      subState: 'UNKNOWN',
      metrics,
      recovery,
      reason: 'Live EV evidence stale beyond maxEvidenceAgeMs',
    };
  }

  const raw = classifyDeterioration(metrics.deterioration, config);
  let subState: P7BreakerSubState = raw;
  if (raw === 'STOP' || raw === 'DEGRADED') {
    const recovered =
      metrics.deterioration < config.maxEvDeteriorationWarnR &&
      recovery.consecutiveClearEvaluations + 1 >= config.recoveryEvaluations;
    if (recovered) subState = 'CLEAR';
  }

  const nextRecovery =
    subState === 'CLEAR'
      ? {
          consecutiveClearEvaluations:
            raw === 'STOP' || raw === 'DEGRADED' ? recovery.consecutiveClearEvaluations + 1 : 0,
        }
      : { consecutiveClearEvaluations: 0 };

  const reason =
    subState === 'STOP'
      ? `EV deterioration ${metrics.deterioration.toFixed(2)}R >= ${config.maxEvDeteriorationR}R`
      : subState === 'DEGRADED'
        ? `EV deterioration ${metrics.deterioration.toFixed(2)}R in warn band`
        : 'EV drift clear';

  return { breakerId: 'ev_drift', subState, metrics, recovery: nextRecovery, reason };
}

export function runP7EvBreaker(
  input: BuildP7EvMetricsInput & { recovery?: P7RecoveryState; now?: number },
): P7EvBreakerResult {
  const metrics = buildP7EvMetrics(input);
  return evaluateP7EvBreaker({
    metrics,
    config: input.config,
    floors: input.floors,
    recovery: input.recovery,
    now: input.now,
  });
}
