/**
 * P7.1 — Quality drift breaker (pure compute).
 * Observes ACTUAL outcome evidence only; never authorizes.
 */
import {
  DEFAULT_P7_QUALITY_BREAKER_CONFIG,
  DEFAULT_P7_SAMPLE_FLOORS,
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type P7BreakerSubState,
  type P7QualityBandSample,
  type P7QualityBreakerConfig,
  type P7QualityBreakerResult,
  type P7QualityMetrics,
  type P7QualityRecoveryState,
  type P7SampleFloors,
} from '@stockpred/shared-types';
import { p7Mean, p7Median, resolveNetRFromOutcome } from './p7-ledger-outcomes';

/** Decision-time quality score: intelligenceSnapshot.tradeQuality.overallScore preferred. */
export function resolveDecisionQualityScore(decision: DecisionLedgerEntry): number | null {
  const ti = decision.intelligenceSnapshot?.tradeQuality?.overallScore;
  if (ti != null && Number.isFinite(ti)) return ti;
  const score = decision.analysisSnapshot?.score;
  if (score != null && Number.isFinite(score)) return score;
  return null;
}

/** Extract ACTUAL decision/outcome pairs with quality scores from ledger records. */
export function extractP7QualityBandSamples(
  records: DecisionLedgerRecord[],
  minQualityScore: number,
): P7QualityBandSample[] {
  const decisions = new Map(
    records.filter(isDecisionLedgerEntry).map((d) => [d.decisionId, d] as const),
  );
  const samples: P7QualityBandSample[] = [];
  for (const row of records) {
    if (!isDecisionOutcomeRecord(row)) continue;
    if ((row.outcomeKind ?? 'ACTUAL') !== 'ACTUAL') continue;
    const decision = decisions.get(row.decisionId);
    if (!decision) continue;
    const qualityScore = resolveDecisionQualityScore(decision);
    if (qualityScore == null || qualityScore < minQualityScore) continue;
    const netR = resolveNetRFromOutcome(row);
    if (netR == null) continue;
    samples.push({
      decisionId: row.decisionId,
      qualityScore,
      netR,
      closedAt: row.closedAt ?? row.timestamp,
      soakRunId: row.soakRunId ?? decision.soakRunId,
    });
  }
  return samples.sort((a, b) => a.closedAt - b.closedAt);
}

export interface BuildP7QualityMetricsInput {
  records: DecisionLedgerRecord[];
  config?: Partial<P7QualityBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  /** When set, only this soak run contributes to hist baseline. */
  soakRunId?: string | null;
  /** Optional walk-forward hist avgR override when soak samples absent. */
  walkForwardHistAvgR?: number | null;
  now?: number;
}

export function buildP7QualityMetrics(input: BuildP7QualityMetricsInput): P7QualityMetrics {
  const config = { ...DEFAULT_P7_QUALITY_BREAKER_CONFIG, ...input.config };
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const samples = extractP7QualityBandSamples(input.records, config.qualityDriftMinScore);

  const histSamples =
    input.soakRunId != null
      ? samples.filter((s) => s.soakRunId === input.soakRunId)
      : samples.filter((s) => s.soakRunId != null && s.soakRunId !== '');

  const liveCandidates = samples.filter((s) => !s.soakRunId);
  const liveSamples = liveCandidates.slice(-floors.liveWindowDecisions);

  const histFromLedger = p7Mean(histSamples.map((s) => s.netR));
  const qualityHistAvgR =
    histFromLedger ??
    (input.walkForwardHistAvgR != null && Number.isFinite(input.walkForwardHistAvgR)
      ? input.walkForwardHistAvgR
      : null);

  const qualityLiveAvgR = p7Mean(liveSamples.map((s) => s.netR));
  const qualityBandScore = p7Median(liveSamples.map((s) => s.qualityScore));
  const latestLiveClosedAt =
    liveSamples.length > 0 ? liveSamples[liveSamples.length - 1]!.closedAt : null;

  return {
    qualityBandScore,
    qualityHistAvgR,
    qualityLiveAvgR,
    liveSampleCount: liveSamples.length,
    histSampleCount: histSamples.length,
    latestLiveClosedAt,
  };
}

function classifyLiveSubState(
  live: number,
  config: P7QualityBreakerConfig,
): 'CLEAR' | 'DEGRADED' | 'STOP' {
  if (live <= config.qualityDriftLiveMaxAvgR) return 'STOP';
  if (live > config.qualityDriftLiveWarnAvgR && live < config.qualityDriftLiveMaxAvgR) {
    return 'DEGRADED';
  }
  return 'CLEAR';
}

export interface EvaluateP7QualityBreakerInput {
  metrics: P7QualityMetrics;
  config?: Partial<P7QualityBreakerConfig>;
  floors?: Partial<P7SampleFloors>;
  recovery?: P7QualityRecoveryState;
  now?: number;
}

export function evaluateP7QualityBreaker(
  input: EvaluateP7QualityBreakerInput,
): P7QualityBreakerResult {
  const config = { ...DEFAULT_P7_QUALITY_BREAKER_CONFIG, ...input.config };
  const floors = { ...DEFAULT_P7_SAMPLE_FLOORS, ...input.floors };
  const now = input.now ?? Date.now();
  const recovery: P7QualityRecoveryState = input.recovery ?? {
    consecutiveClearEvaluations: 0,
  };
  const { metrics } = input;

  if (metrics.liveSampleCount < floors.minQualityBandSamples || metrics.qualityHistAvgR == null) {
    return {
      breakerId: 'quality_drift',
      subState: 'INSUFFICIENT',
      metrics,
      recovery,
      reason: 'Quality band sample floor unmet or hist baseline missing',
    };
  }

  if (
    metrics.latestLiveClosedAt != null &&
    now - metrics.latestLiveClosedAt > config.maxEvidenceAgeMs
  ) {
    return {
      breakerId: 'quality_drift',
      subState: 'UNKNOWN',
      metrics,
      recovery,
      reason: 'Live quality evidence stale beyond maxEvidenceAgeMs',
    };
  }

  if (
    metrics.qualityBandScore == null ||
    metrics.qualityLiveAvgR == null ||
    metrics.qualityBandScore < config.qualityDriftMinScore ||
    metrics.qualityHistAvgR < config.qualityDriftHistMinAvgR
  ) {
    return {
      breakerId: 'quality_drift',
      subState: 'CLEAR',
      metrics,
      recovery: { consecutiveClearEvaluations: 0 },
      reason: 'Quality drift precondition not met — no trip',
    };
  }

  const rawLiveState = classifyLiveSubState(metrics.qualityLiveAvgR, config);
  let subState: P7BreakerSubState = rawLiveState;

  if (rawLiveState === 'STOP' || rawLiveState === 'DEGRADED') {
    const recovered =
      metrics.qualityLiveAvgR > 0 &&
      recovery.consecutiveClearEvaluations + 1 >= config.recoveryEvaluations;
    if (recovered) {
      subState = 'CLEAR';
    }
  }

  const nextRecovery =
    subState === 'CLEAR' && metrics.qualityLiveAvgR > 0
      ? {
          consecutiveClearEvaluations:
            rawLiveState === 'STOP' || rawLiveState === 'DEGRADED'
              ? recovery.consecutiveClearEvaluations + 1
              : 0,
        }
      : { consecutiveClearEvaluations: 0 };

  const reason =
    subState === 'STOP'
      ? `Quality>=${config.qualityDriftMinScore} hist AvgR ${metrics.qualityHistAvgR.toFixed(2)} → live ${metrics.qualityLiveAvgR.toFixed(2)} (trip)`
      : subState === 'DEGRADED'
        ? `Quality live AvgR ${metrics.qualityLiveAvgR.toFixed(2)} in warn band (${config.qualityDriftLiveWarnAvgR}..${config.qualityDriftLiveMaxAvgR})`
        : subState === 'CLEAR'
          ? 'Quality drift clear'
          : subState;

  return {
    breakerId: 'quality_drift',
    subState,
    metrics,
    recovery: nextRecovery,
    reason,
  };
}

/** Convenience: ledger → metrics → evaluation in one call. */
export function runP7QualityBreaker(
  input: BuildP7QualityMetricsInput & {
    recovery?: P7QualityRecoveryState;
  },
): P7QualityBreakerResult {
  const metrics = buildP7QualityMetrics(input);
  return evaluateP7QualityBreaker({
    metrics,
    config: input.config,
    floors: input.floors,
    recovery: input.recovery,
    now: input.now,
  });
}
