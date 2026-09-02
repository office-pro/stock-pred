/**
 * P7.4 — Regime drift breaker (pure compute).
 * Uses frozen decision-time regime; outcome regime via optional resolver.
 */
import {
  DEFAULT_P7_REGIME_BREAKER_CONFIG,
  DEFAULT_P7_SAMPLE_FLOORS,
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type DecisionOutcomeRecord,
  type P7BreakerSubState,
  type P7RecoveryState,
  type P7RegimeBreakerConfig,
  type P7RegimeBreakerResult,
  type P7RegimeMetrics,
  type P7RegimeObservability,
  type P7SampleFloors,
  type TiRegimeCompatibility,
} from '@stockpred/shared-types';
import {
  extractActualDecisionOutcomePairs,
  p7Mean,
  splitHistLivePairs,
} from './p7-ledger-outcomes';

export type ResolveOutcomeRegime = (
  decision: DecisionLedgerEntry,
  outcome: DecisionOutcomeRecord,
) => string | null | undefined;

function decisionRegime(decision: DecisionLedgerEntry): string | null {
  return decision.intelligenceSnapshot?.marketContext?.regimeCombo ?? null;
}

function regimeCompatibility(decision: DecisionLedgerEntry): TiRegimeCompatibility | null {
  return decision.intelligenceSnapshot?.regimeCompatibility?.compatibility ?? null;
}

export function isRegimeMismatch(input: {
  decision: DecisionLedgerEntry;
  outcomeRegime: string | null | undefined;
  netR: number;
}): boolean | null {
  const decisionCombo = decisionRegime(input.decision);
  const compat = regimeCompatibility(input.decision);

  if (input.outcomeRegime == null || input.outcomeRegime === '') {
    if ((compat === 'UNFAVORABLE' || compat === 'UNKNOWN') && input.netR < 0) {
      return true;
    }
    return null;
  }

  if (decisionCombo != null && decisionCombo !== input.outcomeRegime) return true;
  if ((compat === 'UNFAVORABLE' || compat === 'UNKNOWN') && input.netR < 0) return true;
  return false;
}

export interface BuildP7RegimeMetricsInput {
  records: DecisionLedgerRecord[];
  floors?: Partial<P7SampleFloors>;
  soakRunId?: string | null;
  resolveOutcomeRegime?: ResolveOutcomeRegime;
}

export function buildP7RegimeMetrics(input: BuildP7RegimeMetricsInput): P7RegimeMetrics {
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const pairs = extractActualDecisionOutcomePairs(input.records);
  const { live } = splitHistLivePairs(pairs, floors, input.soakRunId);

  let mismatchCount = 0;
  let unknownOutcomeRegimeCount = 0;
  let evaluatedCount = 0;

  for (const pair of live) {
    const outcomeRegime = input.resolveOutcomeRegime?.(pair.decision, pair.outcome) ?? null;
    const mismatch = isRegimeMismatch({
      decision: pair.decision,
      outcomeRegime,
      netR: pair.netR,
    });
    if (mismatch == null) {
      unknownOutcomeRegimeCount += 1;
      continue;
    }
    evaluatedCount += 1;
    if (mismatch) mismatchCount += 1;
  }

  const regimeMismatchRate = evaluatedCount > 0 ? mismatchCount / evaluatedCount : null;
  const liveAvgR = p7Mean(live.map((p) => p.netR));
  const latestLiveClosedAt = live.length > 0 ? live[live.length - 1]!.closedAt : null;

  return {
    regimeMismatchRate,
    liveAvgR,
    observability: 'UNKNOWN',
    decisionCount: live.length,
    mismatchCount,
    unknownOutcomeRegimeCount,
    latestLiveClosedAt,
  };
}

function observabilityClass(
  rate: number | null,
  liveAvgR: number | null,
  config: P7RegimeBreakerConfig,
): P7RegimeObservability {
  if (rate == null) return 'UNKNOWN';
  if (rate >= config.maxRegimeMismatchRate && liveAvgR != null && liveAvgR < 0) {
    return 'SEVERE_DRIFT';
  }
  if (rate >= config.maxRegimeMismatchWarn) return 'DRIFT';
  return 'NORMAL';
}

export interface EvaluateP7RegimeBreakerInput {
  metrics: P7RegimeMetrics;
  config?: Partial<P7RegimeBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  recovery?: P7RecoveryState;
  now?: number;
}

export function evaluateP7RegimeBreaker(
  input: EvaluateP7RegimeBreakerInput,
): P7RegimeBreakerResult {
  const config = { ...DEFAULT_P7_REGIME_BREAKER_CONFIG, ...input.config };
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const now = input.now ?? Date.now();
  const recovery = input.recovery ?? { consecutiveClearEvaluations: 0 };
  const metrics = {
    ...input.metrics,
    observability: observabilityClass(
      input.metrics.regimeMismatchRate,
      input.metrics.liveAvgR,
      config,
    ),
  };

  if (metrics.decisionCount < floors.minRegimeDecisions) {
    return {
      breakerId: 'regime_drift',
      subState: 'INSUFFICIENT',
      metrics,
      recovery,
      reason: 'Regime decision sample floor unmet',
    };
  }

  if (
    metrics.latestLiveClosedAt != null &&
    now - metrics.latestLiveClosedAt > config.maxEvidenceAgeMs
  ) {
    return {
      breakerId: 'regime_drift',
      subState: 'UNKNOWN',
      metrics,
      recovery,
      reason: 'Live regime evidence stale beyond maxEvidenceAgeMs',
    };
  }

  if (metrics.regimeMismatchRate == null) {
    return {
      breakerId: 'regime_drift',
      subState: 'UNKNOWN',
      metrics,
      recovery,
      reason: 'Outcome regime unavailable for evaluated decisions',
    };
  }

  let subState: P7BreakerSubState = 'CLEAR';
  if (metrics.regimeMismatchRate >= config.maxRegimeMismatchRate) subState = 'STOP';
  else if (metrics.regimeMismatchRate >= config.maxRegimeMismatchWarn) subState = 'DEGRADED';

  if (subState === 'STOP' || subState === 'DEGRADED') {
    const recovered =
      metrics.regimeMismatchRate < config.maxRegimeMismatchWarn &&
      recovery.consecutiveClearEvaluations + 1 >= config.recoveryEvaluations;
    if (recovered) subState = 'CLEAR';
  }

  const nextRecovery =
    subState === 'CLEAR'
      ? {
          consecutiveClearEvaluations:
            metrics.regimeMismatchRate != null &&
            metrics.regimeMismatchRate >= config.maxRegimeMismatchWarn
              ? recovery.consecutiveClearEvaluations + 1
              : 0,
        }
      : { consecutiveClearEvaluations: 0 };

  const reason =
    subState === 'STOP'
      ? `Regime mismatch rate ${(metrics.regimeMismatchRate! * 100).toFixed(0)}% >= ${(config.maxRegimeMismatchRate * 100).toFixed(0)}%`
      : subState === 'DEGRADED'
        ? `Regime mismatch rate ${(metrics.regimeMismatchRate! * 100).toFixed(0)}% in warn band`
        : 'Regime drift clear';

  return {
    breakerId: 'regime_drift',
    subState,
    metrics,
    recovery: nextRecovery,
    reason,
  };
}

export function runP7RegimeBreaker(
  input: BuildP7RegimeMetricsInput & {
    recovery?: P7RecoveryState;
    now?: number;
    config?: Partial<P7RegimeBreakerConfig>;
  },
): P7RegimeBreakerResult {
  const metrics = buildP7RegimeMetrics(input);
  return evaluateP7RegimeBreaker({
    metrics,
    config: input.config,
    floors: input.floors,
    recovery: input.recovery,
    now: input.now,
  });
}
