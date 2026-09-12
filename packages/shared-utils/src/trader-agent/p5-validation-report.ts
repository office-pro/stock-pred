/**
 * P5 Validation Report builder — measurement artifact only.
 * GO = ARM eligibility; never auto-arms. INCONCLUSIVE ≠ NO-GO.
 * Never feeds Risk / Portfolio / Policy / Gate.
 */

import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
  P5OutcomeDistribution,
  P5OutcomeKind,
  P5SampleFloors,
  P5ValidationReport,
  P5ValidationVerdict,
} from '@stockpred/shared-types';
import {
  DEFAULT_P5_SAMPLE_FLOORS,
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
} from '@stockpred/shared-types';
import { computeOutcomeDistribution, type P5OutcomeSample } from './p5-outcome-stats';

export interface BuildP5ValidationReportInput {
  records: DecisionLedgerRecord[];
  floors?: P5SampleFloors;
  safetyPass?: boolean;
  /** Conservative default false — empty windows never become GO. */
  evidenceSupportsReadiness?: boolean;
  generatedAt?: string;
  candidates?: number;
}

function outcomeKindOf(o: DecisionOutcomeRecord): P5OutcomeKind {
  return o.outcomeKind ?? 'ACTUAL';
}

function toSample(o: DecisionOutcomeRecord): P5OutcomeSample {
  return {
    netR: o.netR,
    realizedR: o.realizedR,
    grossR: o.grossR,
    fees: o.fees,
    slippage: o.slippage,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Mechanical verdict (locked):
 * floors unmet → INCONCLUSIVE
 * else safety fails → NO-GO
 * else evidence supports readiness → GO
 * else → NO-GO
 */
export function resolveP5Verdict(input: {
  floorsMet: boolean;
  safetyPass: boolean;
  evidenceSupportsReadiness: boolean;
}): { verdict: P5ValidationVerdict; reason: string; armEligibility: 'ELIGIBLE' | 'BLOCKED' } {
  if (!input.floorsMet) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: 'Sample floors not met — insufficient observations (not a NO-GO on intelligence)',
      armEligibility: 'BLOCKED',
    };
  }
  if (!input.safetyPass) {
    return {
      verdict: 'NO-GO',
      reason: 'Sample floors met but safety evidence failed',
      armEligibility: 'BLOCKED',
    };
  }
  if (input.evidenceSupportsReadiness) {
    return {
      verdict: 'GO',
      reason:
        'Sample floors met, safety pass, evidence supports readiness — ARM may become available',
      armEligibility: 'ELIGIBLE',
    };
  }
  return {
    verdict: 'NO-GO',
    reason: 'Sample floors met but evidence does not support readiness',
    armEligibility: 'BLOCKED',
  };
}

export function buildP5ValidationReport(input: BuildP5ValidationReportInput): P5ValidationReport {
  const floors = input.floors ?? DEFAULT_P5_SAMPLE_FLOORS;
  const decisions = input.records.filter(isDecisionLedgerEntry);
  const outcomes = input.records.filter(isDecisionOutcomeRecord);

  const actual = outcomes.filter((o) => outcomeKindOf(o) === 'ACTUAL');
  const counterfactual = outcomes.filter((o) => outcomeKindOf(o) === 'COUNTERFACTUAL');
  const waitMarks = outcomes.filter((o) => outcomeKindOf(o) === 'WAIT_MARK');

  const approve = decisions.filter((d) => d.humanDecision === 'HUMAN_APPROVE').length;
  const wait = decisions.filter((d) => d.humanDecision === 'HUMAN_WAIT').length;
  const reject = decisions.filter((d) => d.humanDecision === 'HUMAN_REJECT').length;
  const reviewed = decisions.filter((d) => d.humanDecision != null).length;

  const decisionById = new Map<string, DecisionLedgerEntry>();
  for (const d of decisions) decisionById.set(d.decisionId, d);

  const bucket = (rows: DecisionOutcomeRecord[]) => {
    const rank1: DecisionOutcomeRecord[] = [];
    const rank2to3: DecisionOutcomeRecord[] = [];
    const rank4Plus: DecisionOutcomeRecord[] = [];
    for (const o of rows) {
      const rank = decisionById.get(o.decisionId)?.rankingContext?.rank;
      if (rank == null) continue;
      if (rank === 1) rank1.push(o);
      else if (rank === 2 || rank === 3) rank2to3.push(o);
      else if (rank >= 4) rank4Plus.push(o);
    }
    return { rank1, rank2to3, rank4Plus };
  };

  const actualRanks = bucket(actual);
  const cfRanks = bucket(counterfactual);

  const qualityVsRealizedRSamples = actual.filter((o) => {
    const d = decisionById.get(o.decisionId);
    const quality = d?.analysisSnapshot?.score;
    return quality != null && (o.netR != null || o.realizedR != null);
  }).length;

  const floorsMet =
    reviewed >= floors.minReviewed &&
    actual.length >= floors.minActualFills &&
    qualityVsRealizedRSamples >= floors.minQualityVsRealizedRSamples;

  const safetyPass = input.safetyPass !== false;
  const evidenceSupportsReadiness = input.evidenceSupportsReadiness === true;

  const { verdict, reason, armEligibility } = resolveP5Verdict({
    floorsMet,
    safetyPass,
    evidenceSupportsReadiness,
  });

  const pathAvail = actual.filter((o) => o.pathMetricsStatus === 'AVAILABLE');
  const pathUnavail = actual.filter(
    (o) => o.pathMetricsStatus === 'UNAVAILABLE' || o.pathMetricsStatus == null,
  );

  const approveActual = actual.filter(
    (o) => decisionById.get(o.decisionId)?.humanDecision === 'HUMAN_APPROVE',
  );
  const rejectCf = counterfactual.filter(
    (o) => decisionById.get(o.decisionId)?.humanDecision === 'HUMAN_REJECT',
  );

  return {
    schemaVersion: 'p5-validation-report.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sample: {
      candidates: input.candidates ?? decisions.length,
      approve,
      wait,
      reject,
      actualFills: actual.length,
      counterfactualCount: counterfactual.length,
      waitMarkCount: waitMarks.length,
      reviewed,
      qualityVsRealizedRSamples,
    },
    ranking: {
      rank1: computeOutcomeDistribution(actualRanks.rank1.map(toSample)),
      rank2to3: computeOutcomeDistribution(actualRanks.rank2to3.map(toSample)),
      rank4Plus: computeOutcomeDistribution(actualRanks.rank4Plus.map(toSample)),
      outcomeKind: 'ACTUAL',
    },
    rankingCounterfactual: {
      rank1: computeOutcomeDistribution(cfRanks.rank1.map(toSample)),
      rank2to3: computeOutcomeDistribution(cfRanks.rank2to3.map(toSample)),
      rank4Plus: computeOutcomeDistribution(cfRanks.rank4Plus.map(toSample)),
      outcomeKind: 'COUNTERFACTUAL',
    },
    intelligence: {
      note: 'Quality/EV vs realized R — observe-only; never auto-rules',
      qualityVsRealizedRSamples,
    },
    execution: {
      actualWithPathMetrics: pathAvail.length,
      actualPathUnavailable: pathUnavail.length,
      avgMaeR: avg(pathAvail.map((o) => o.maeR).filter((v): v is number => v != null)),
      avgMfeR: avg(pathAvail.map((o) => o.mfeR).filter((v): v is number => v != null)),
      avgSlippage: avg(actual.map((o) => o.slippage).filter((v): v is number => v != null)),
      avgNetR: computeOutcomeDistribution(actual.map(toSample)).expectancyNetR,
    },
    human: {
      approveActual: computeOutcomeDistribution(approveActual.map(toSample)),
      rejectCounterfactual: computeOutcomeDistribution(rejectCf.map(toSample)),
      waitMarks: waitMarks.length,
    },
    floors,
    floorsMet,
    safetyPass,
    verdict,
    verdictReason: reason,
    armEligibility,
  };
}

export function emptyP5Distribution(): P5OutcomeDistribution {
  return computeOutcomeDistribution([]);
}
