/**
 * Shared ledger outcome helpers for P7 breakers.
 */
import {
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type DecisionOutcomeRecord,
  type ProbabilitySource,
} from '@stockpred/shared-types';

/** Resolve net R from an outcome record — never invents. */
export function resolveNetRFromOutcome(o: DecisionOutcomeRecord): number | null {
  if (o.netR != null && Number.isFinite(o.netR)) return o.netR;
  if (o.realizedR != null && Number.isFinite(o.realizedR)) return o.realizedR;
  if (o.grossR != null && Number.isFinite(o.grossR)) return o.grossR;
  return null;
}

export interface P7DecisionOutcomePair {
  decision: DecisionLedgerEntry;
  outcome: DecisionOutcomeRecord;
  netR: number;
  closedAt: number;
  soakRunId?: string;
}

export function extractActualDecisionOutcomePairs(
  records: DecisionLedgerRecord[],
): P7DecisionOutcomePair[] {
  const decisions = new Map(
    records.filter(isDecisionLedgerEntry).map((d) => [d.decisionId, d] as const),
  );
  const pairs: P7DecisionOutcomePair[] = [];
  for (const row of records) {
    if (!isDecisionOutcomeRecord(row)) continue;
    if ((row.outcomeKind ?? 'ACTUAL') !== 'ACTUAL') continue;
    const decision = decisions.get(row.decisionId);
    if (!decision) continue;
    const netR = resolveNetRFromOutcome(row);
    if (netR == null) continue;
    pairs.push({
      decision,
      outcome: row,
      netR,
      closedAt: row.closedAt ?? row.timestamp,
      soakRunId: row.soakRunId ?? decision.soakRunId,
    });
  }
  return pairs.sort((a, b) => a.closedAt - b.closedAt);
}

export function p7Mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function p7Median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function splitHistLivePairs<T extends { closedAt: number; soakRunId?: string }>(
  pairs: T[],
  floors: { liveWindowDecisions: number },
  soakRunId?: string | null,
): { hist: T[]; live: T[] } {
  const hist =
    soakRunId != null
      ? pairs.filter((p) => p.soakRunId === soakRunId)
      : pairs.filter((p) => p.soakRunId != null && p.soakRunId !== '');
  const live = pairs.filter((p) => !p.soakRunId).slice(-floors.liveWindowDecisions);
  return { hist, live };
}

/** Canonical probability target from decision-time intelligence snapshot. */
export function resolveDecisionProbabilityTarget(decision: DecisionLedgerEntry): {
  probabilityTarget: number | null;
  probabilitySource: ProbabilitySource | null;
} {
  const ev = decision.intelligenceSnapshot?.expectedValue;
  const probabilityTarget = ev?.probabilityTarget;
  const probabilitySource = ev?.probabilitySource ?? null;
  if (probabilityTarget == null || !Number.isFinite(probabilityTarget)) {
    return { probabilityTarget: null, probabilitySource };
  }
  return { probabilityTarget, probabilitySource };
}

export function isCalibrationEligible(
  probabilityTarget: number | null,
  probabilitySource: ProbabilitySource | null,
): boolean {
  if (probabilityTarget == null) return false;
  if (probabilitySource === 'CALIBRATED' || probabilitySource === 'RAW_MODEL') return true;
  if (probabilitySource === 'HEURISTIC') return true;
  return false;
}
