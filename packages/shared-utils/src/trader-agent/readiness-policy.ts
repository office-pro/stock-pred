/**
 * readiness-policy.v1 — STRICT_ALL (default, unchanged) and ELIGIBLE_SUBSET.
 * Pure decision logic. Never touches Risk / Portfolio / Policy / Gate, execution
 * authorization, or ranking; per-instrument thresholds come from the unchanged
 * DataRequirementPlan.
 */

import {
  READINESS_POLICY_VERSION,
  type CombinedBatchPreflightV2,
  type DataRequirementPlan,
  type InstrumentReadinessEligibility,
  type InstrumentReadinessState,
  type IntelligenceBatchResults,
  type MiCapabilityRequirement,
  type MiPreflightReasonCode,
  type ReadinessEligibilitySummary,
  type ReadinessPolicy,
  type ReadinessPolicyErrorBody,
  type ReadinessPolicyErrorCode,
} from '@stockpred/shared-types';
import {
  classifyFreshness,
  evaluateCombinedPreflightLegs,
  type CapabilityInventory,
  type CombinedPreflightInventories,
  type CombinedPreflightLegKey,
  type CombinedPreflightLegs,
} from './mi-combined-preflight';

/** Historical read failures above this share of the universe block as an inventory failure. */
export const ELIGIBLE_SUBSET_MAX_HISTORICAL_FETCH_FAILURE_PCT = 2;

export class ReadinessPolicyError extends Error {
  constructor(
    readonly code: ReadinessPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadinessPolicyError';
  }

  toBody(): ReadinessPolicyErrorBody {
    return { code: this.code, message: this.message };
  }
}

/**
 * HTTP 400 body for a readiness-policy validation failure.
 * Undefined for any other error, which callers must rethrow unchanged (not a client error).
 */
export function readinessPolicyErrorBody(err: unknown): ReadinessPolicyErrorBody | undefined {
  return err instanceof ReadinessPolicyError ? err.toBody() : undefined;
}

/**
 * ES-10 — coerce a stored snapshot field. Missing/null → undefined (legacy OK).
 * Invalid or unsupported values are dropped so a bad policy never poisons snapshot load.
 */
export function coerceStoredReadinessPolicy(raw: unknown): ReadinessPolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  try {
    return normalizeReadinessPolicy(raw);
  } catch {
    return undefined;
  }
}

/**
 * Attach a validated policy to an MI snapshot document.
 * When policy is absent, leave the snapshot unchanged (never strip a stored policy).
 */
export function withMiSnapshotReadinessPolicy<T extends object>(
  snapshot: T,
  policy: ReadinessPolicy | undefined,
): T & { readinessPolicy?: ReadinessPolicy } {
  if (!policy) return snapshot;
  return { ...snapshot, readinessPolicy: policy };
}

/**
 * Validate a client-supplied policy. Absent → undefined (STRICT_ALL behavior).
 * Throws ReadinessPolicyError for unknown ids/versions or ELIGIBLE_SUBSET without minimums.
 */
export function normalizeReadinessPolicy(raw: unknown): ReadinessPolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_INVALID',
      'Readiness policy must be an object',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== READINESS_POLICY_VERSION) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_UNKNOWN_VERSION',
      `Unsupported readiness policy version: expected ${READINESS_POLICY_VERSION}, got ${String(r.version)}`,
    );
  }
  if (r.id === 'STRICT_ALL') {
    if (r.minimums !== undefined) {
      throw new ReadinessPolicyError(
        'READINESS_POLICY_INVALID',
        'STRICT_ALL does not accept minimums',
      );
    }
    return { id: 'STRICT_ALL', version: READINESS_POLICY_VERSION };
  }
  if (r.id !== 'ELIGIBLE_SUBSET') {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_UNKNOWN_ID',
      `Unknown readiness policy: ${String(r.id)}`,
    );
  }
  const m = r.minimums;
  if (m == null || typeof m !== 'object' || Array.isArray(m)) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_MINIMUMS_REQUIRED',
      'ELIGIBLE_SUBSET requires minimums (minEligibleCount, minEligibleFraction)',
    );
  }
  const { minEligibleCount, minEligibleFraction } = m as Record<string, unknown>;
  if (
    typeof minEligibleCount !== 'number' ||
    !Number.isInteger(minEligibleCount) ||
    minEligibleCount < 1
  ) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_INVALID',
      'minEligibleCount must be an integer >= 1',
    );
  }
  if (
    typeof minEligibleFraction !== 'number' ||
    !Number.isFinite(minEligibleFraction) ||
    minEligibleFraction <= 0 ||
    minEligibleFraction > 1
  ) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_INVALID',
      'minEligibleFraction must be in (0, 1]',
    );
  }
  return {
    id: 'ELIGIBLE_SUBSET',
    version: READINESS_POLICY_VERSION,
    minimums: { minEligibleCount, minEligibleFraction },
  };
}

/**
 * Combined preflight under a readiness policy.
 * No policy → byte-identical STRICT_ALL output.
 */
export function runReadinessPreflight(input: {
  plan: DataRequirementPlan;
  inventories: CombinedPreflightInventories;
  readinessPolicy?: ReadinessPolicy;
  generatedAt?: string;
}): CombinedBatchPreflightV2 {
  const legs = evaluateCombinedPreflightLegs(input);
  const policy = input.readinessPolicy;
  if (!policy) return legs.strict;
  if (policy.id === 'STRICT_ALL') return { ...legs.strict, readinessPolicy: policy };
  return applyEligibleSubset({
    plan: input.plan,
    inventories: input.inventories,
    legs,
    policy,
  });
}

function historicalFailuresExceeded(failures: number, universeTotal: number): boolean {
  return failures * 100 > universeTotal * ELIGIBLE_SUBSET_MAX_HISTORICAL_FETCH_FAILURE_PCT;
}

function quoteIsFresh(
  requirement: MiCapabilityRequirement,
  asOf: string,
  timestamp: string | null | undefined,
): boolean {
  const freshness = classifyFreshness({
    policy: requirement.freshness,
    asOf,
    latestTimestamp: timestamp ?? null,
  });
  if (requirement.freshness.mode === 'STRICT') return freshness === 'CURRENT';
  return freshness !== 'STALE';
}

function reasonFamily(reason: string): string {
  const idx = reason.indexOf(':');
  return idx === -1 ? reason : reason.slice(0, idx);
}

interface PerInstrumentLegDef {
  key: Extract<CombinedPreflightLegKey, 'marketData' | 'historical' | 'fundamentals'>;
  requirement: MiCapabilityRequirement;
  inventory: CapabilityInventory;
  readFailedCode: MiPreflightReasonCode;
}

function applyEligibleSubset(input: {
  plan: DataRequirementPlan;
  inventories: CombinedPreflightInventories;
  legs: CombinedPreflightLegs;
  policy: ReadinessPolicy;
}): CombinedBatchPreflightV2 {
  const { plan, inventories, legs, policy } = input;
  const { strict } = legs;
  const minimums = policy.minimums;
  if (!minimums) {
    throw new ReadinessPolicyError(
      'READINESS_POLICY_MINIMUMS_REQUIRED',
      'ELIGIBLE_SUBSET requires minimums (minEligibleCount, minEligibleFraction)',
    );
  }

  const blockers: MiPreflightReasonCode[] = [...legs.identityBlockers];
  const demoted: MiPreflightReasonCode[] = [];

  const legDefs: PerInstrumentLegDef[] = [
    {
      key: 'marketData',
      requirement: plan.marketData,
      inventory: inventories.marketData,
      readFailedCode: 'QUOTE_INVENTORY_UNAVAILABLE',
    },
    {
      key: 'historical',
      requirement: plan.historical,
      inventory: inventories.historical,
      readFailedCode: 'HISTORICAL_INVENTORY_UNAVAILABLE',
    },
    {
      key: 'fundamentals',
      requirement: plan.intelligence.fundamentals,
      inventory: inventories.fundamentals,
      readFailedCode: 'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
    },
  ];

  const attributed = new Set<PerInstrumentLegDef['key']>();
  for (const leg of legDefs) {
    const legBlockers = legs.legBlockers[leg.key];
    if (leg.requirement.mode !== 'REQUIRED') {
      blockers.push(...legBlockers);
      continue;
    }
    const readFailed =
      leg.inventory.readFailed === true ||
      (leg.inventory.inventoryReasons ?? []).includes(leg.readFailedCode);
    if (readFailed) {
      // A failed read never becomes "exclude everyone": block, mark nobody ineligible.
      blockers.push(leg.readFailedCode);
      demoted.push(...legBlockers);
      continue;
    }
    if (!leg.inventory.perInstrument) {
      // Shortfall cannot be attributed per instrument → keep the STRICT_ALL leg verdict.
      blockers.push(...legBlockers);
      continue;
    }
    attributed.add(leg.key);
    demoted.push(...legBlockers);
  }

  // Required capabilities without per-instrument checks keep their STRICT_ALL verdict.
  for (const key of ['news', 'sentiment', 'corporateEvents', 'macro', 'social'] as const) {
    blockers.push(...legs.legBlockers[key]);
  }

  const instruments: InstrumentReadinessEligibility[] = [];
  let historicalFetchFailures = 0;
  for (const ref of plan.universe.resolved) {
    const symbol = ref.symbol.toUpperCase();
    const blocking: string[] = [];
    const notPromotable: string[] = [];

    if (attributed.has('marketData')) {
      const o = inventories.marketData.perInstrument?.[symbol];
      if (!o?.ok) blocking.push(o?.reason ?? 'QUOTE_MISSING');
      else if (!quoteIsFresh(plan.marketData, plan.asOf, o.timestamp)) blocking.push('QUOTE_STALE');
    }
    if (attributed.has('historical')) {
      const o = inventories.historical.perInstrument?.[symbol];
      if (!o?.ok) {
        const reason = o?.reason ?? 'NO_HISTORY';
        if (reason === 'HISTORICAL_FETCH_FAILED') historicalFetchFailures += 1;
        blocking.push(reason);
      }
    }
    if (attributed.has('fundamentals')) {
      const o = inventories.fundamentals.perInstrument?.[symbol];
      if (!o?.ok) notPromotable.push(o?.reason ?? 'FUNDAMENTALS_INCOMPLETE');
    }

    const state: InstrumentReadinessState =
      blocking.length > 0
        ? 'INELIGIBLE'
        : notPromotable.length > 0
          ? 'ANALYZED_NOT_PROMOTABLE'
          : 'ELIGIBLE';
    instruments.push({ symbol, state, reasons: [...blocking, ...notPromotable] });
  }

  const universeTotal = plan.universe.requestedCount;
  let eligible = 0;
  let analyzedNotPromotable = 0;
  let ineligible = 0;
  const ineligibleByReason: Record<string, number> = {};
  for (const row of instruments) {
    if (row.state === 'ELIGIBLE') eligible += 1;
    else if (row.state === 'ANALYZED_NOT_PROMOTABLE') analyzedNotPromotable += 1;
    else {
      ineligible += 1;
      for (const family of new Set(row.reasons.map(reasonFamily))) {
        ineligibleByReason[family] = (ineligibleByReason[family] ?? 0) + 1;
      }
    }
  }

  // Count and denominator are reported via ineligibleByReason.HISTORICAL_FETCH_FAILED / universeTotal.
  if (
    attributed.has('historical') &&
    historicalFailuresExceeded(historicalFetchFailures, universeTotal)
  ) {
    blockers.push('HISTORICAL_FAILURE_THRESHOLD_EXCEEDED');
  }

  // Shared inventory outage → eligibility cannot be trusted; omit eligibility conclusions.
  const inventoryOutage =
    blockers.includes('QUOTE_INVENTORY_UNAVAILABLE') ||
    blockers.includes('HISTORICAL_INVENTORY_UNAVAILABLE') ||
    blockers.includes('FUNDAMENTALS_INVENTORY_UNAVAILABLE');

  // Only ELIGIBLE counts toward the minimums; ANALYZED_NOT_PROMOTABLE does not.
  if (!inventoryOutage) {
    if (eligible === 0) {
      blockers.push('NO_ELIGIBLE_INSTRUMENTS');
    } else if (
      eligible < minimums.minEligibleCount ||
      eligible / universeTotal < minimums.minEligibleFraction
    ) {
      blockers.push('ELIGIBLE_SUBSET_BELOW_MINIMUM');
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set([...strict.warnings, ...demoted])].filter(
    (w) => !uniqueBlockers.includes(w),
  );

  return {
    ...strict,
    canRun: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    readinessPolicy: policy,
    strictAll: { canRun: strict.canRun, blockers: strict.blockers },
    eligibility: {
      policy,
      universeTotal,
      eligible,
      analyzedNotPromotable,
      ineligible,
      ineligibleByReason,
      instruments,
    },
  };
}

export function readinessStateBySymbol(
  summary?: ReadinessEligibilitySummary | null,
): Map<string, InstrumentReadinessEligibility> {
  const out = new Map<string, InstrumentReadinessEligibility>();
  for (const row of summary?.instruments ?? []) out.set(row.symbol.toUpperCase(), row);
  return out;
}

export const READINESS_INELIGIBLE_TASK_ERROR_PREFIX = 'READINESS_INELIGIBLE:';

/** Frozen INELIGIBLE instruments are SKIPPED with their reasons; nothing else changes. */
export function applyFrozenReadinessToTasks<
  T extends { symbol: string; status: string; error?: string; completedAt?: number },
>(tasks: T[], summary: ReadinessEligibilitySummary | null | undefined, now: number): T[] {
  if (!summary) return tasks;
  const bySymbol = readinessStateBySymbol(summary);
  return tasks.map((t) => {
    if (t.status !== 'PENDING') return t;
    const row = bySymbol.get(t.symbol.toUpperCase());
    if (row?.state !== 'INELIGIBLE') return t;
    return {
      ...t,
      status: 'SKIPPED',
      completedAt: now,
      error: `${READINESS_INELIGIBLE_TASK_ERROR_PREFIX}${row.reasons.join(',')}`,
    };
  });
}

/**
 * ANALYZED_NOT_PROMOTABLE feeds DATA_INCOMPLETE into the existing recommendation
 * eligibility contract (APPROVE → WATCH, bestOpportunityEligible: false).
 */
export function readinessDataCompleteness(
  state: InstrumentReadinessState | undefined,
  dataCompleteness: string | null | undefined,
): string | null | undefined {
  return state === 'ANALYZED_NOT_PROMOTABLE' ? 'DATA_INCOMPLETE' : dataCompleteness;
}

/**
 * ELIGIBLE_SUBSET result fields; empty for STRICT_ALL / no policy.
 * `outcome` is set only for a persisted batch whose every task was SKIPPED by frozen
 * readiness ineligibility. Failed analyses and data-snapshot skips keep their own outcome.
 */
export function buildReadinessResultsSection(input: {
  policy?: ReadinessPolicy;
  summary?: ReadinessEligibilitySummary;
  tasks: ReadonlyArray<{ status: string; error?: string }>;
}): Pick<IntelligenceBatchResults, 'readinessPolicy' | 'ineligible' | 'outcome'> {
  if (input.policy?.id !== 'ELIGIBLE_SUBSET' || !input.summary) return {};
  const ineligible = input.summary.instruments
    .filter((row) => row.state === 'INELIGIBLE')
    .map((row) => ({ symbol: row.symbol, state: row.state, reasons: [...row.reasons] }));
  const allSkippedAsIneligible =
    input.tasks.length > 0 &&
    input.tasks.every(
      (t) =>
        t.status === 'SKIPPED' &&
        String(t.error ?? '').startsWith(READINESS_INELIGIBLE_TASK_ERROR_PREFIX),
    );
  return {
    readinessPolicy: input.policy,
    ineligible,
    ...(allSkippedAsIneligible ? { outcome: 'NO_ELIGIBLE_INSTRUMENTS' as const } : {}),
  };
}
