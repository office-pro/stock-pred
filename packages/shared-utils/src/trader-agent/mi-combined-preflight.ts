/**
 * MI-3 Combined Batch Preflight evaluator (PASS / BLOCK).
 * Pure decision logic — no I/O. Coverage denoms = RESOLVED only.
 */

import type {
  CombinedBatchPreflightV2,
  DataRequirementPlan,
  MiCapabilityRequirement,
  MiCoverageState,
  MiFreshnessPolicy,
  MiFreshnessState,
  MiPreflightReasonCode,
  MiReadinessResult,
  MiReadinessSampleIssue,
} from '@stockpred/shared-types';

/** Dual PIT: publishedAt AND availableAt must both be <= asOf; missing either → ineligible. */
export function isPitEligibleDual(
  publishedAt: string | Date | null | undefined,
  availableAt: string | Date | null | undefined,
  asOf: string | Date,
): boolean {
  if (publishedAt == null || availableAt == null) return false;
  const p = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(String(publishedAt));
  const a = availableAt instanceof Date ? availableAt.getTime() : Date.parse(String(availableAt));
  const o = asOf instanceof Date ? asOf.getTime() : Date.parse(String(asOf));
  if (!Number.isFinite(p) || !Number.isFinite(a) || !Number.isFinite(o)) return false;
  return p <= o && a <= o;
}

export function classifyFreshness(input: {
  policy: MiFreshnessPolicy;
  asOf: string;
  latestTimestamp?: string | null;
  windowStartMs?: number;
}): MiFreshnessState {
  const { policy, asOf, latestTimestamp } = input;
  if (!latestTimestamp) return 'UNKNOWN';
  const ts = Date.parse(latestTimestamp);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(ts) || !Number.isFinite(asOfMs)) return 'UNKNOWN';
  if (ts > asOfMs) return 'STALE'; // look-ahead treated as invalid

  if (policy.mode === 'LATEST_AVAILABLE') {
    return 'CURRENT';
  }

  if (policy.mode === 'WINDOWED') {
    const maxAge = policy.maxAgeMs ?? 30 * 86_400_000;
    const windowStart = input.windowStartMs ?? asOfMs - maxAge;
    if (ts < windowStart) return 'STALE';
    return 'CURRENT';
  }

  // STRICT
  const maxAge = policy.maxAgeMs ?? 15 * 60 * 1000;
  const age = asOfMs - ts;
  if (age < 0) return 'STALE';
  if (age <= maxAge) return 'CURRENT';
  if (age <= maxAge * 4) return 'DELAYED';
  return 'STALE';
}

function coverageOf(available: number, requiredCount: number): MiCoverageState {
  if (requiredCount <= 0) return 'COMPLETE';
  if (available >= requiredCount) return 'COMPLETE';
  if (available <= 0) return 'MISSING';
  return 'PARTIAL';
}

export interface CapabilityInventory {
  available: number;
  /** Denominator for coverage (RESOLVED applicable instruments). */
  requiredCount: number;
  latestTimestamp?: string | null;
  sampleIssues?: MiReadinessSampleIssue[];
  /** Extra reason codes from inventory (e.g. SENTIMENT_UNAVAILABLE, PIT_DATA_EXCLUDED). */
  inventoryReasons?: MiPreflightReasonCode[];
  /** When true, freshness is evaluated; when false/unknown inventory, freshness=UNKNOWN. */
  freshnessApplicable?: boolean;
  /**
   * Per-instrument outcome keyed by uppercase symbol. Consulted only by ELIGIBLE_SUBSET;
   * STRICT_ALL output never depends on it.
   */
  perInstrument?: Record<string, InstrumentCapabilityOutcome>;
  /** The inventory read itself failed; an empty result is not evidence of missing data. */
  readFailed?: boolean;
}

export interface InstrumentCapabilityOutcome {
  ok: boolean;
  /** Per-instrument reason when !ok (e.g. QUOTE_MISSING, NO_HISTORY, HISTORICAL_FETCH_FAILED). */
  reason?: string;
  /** Observation time used for per-instrument freshness (quotes). */
  timestamp?: string | null;
}

/** Inventory read failures are surfaced top-level so a failed read is not mistaken for zero coverage. */
const INVENTORY_FAILURE_CODES: ReadonlySet<MiPreflightReasonCode> = new Set([
  'QUOTE_INVENTORY_UNAVAILABLE',
]);

function evaluateCapability(
  requirement: MiCapabilityRequirement,
  inventory: CapabilityInventory,
  asOf: string,
  insufficientCode: MiPreflightReasonCode,
): {
  result: MiReadinessResult;
  blockers: MiPreflightReasonCode[];
  warnings: MiPreflightReasonCode[];
} {
  const mode = requirement.mode;
  const blockers: MiPreflightReasonCode[] = [];
  const warnings: MiPreflightReasonCode[] = [];

  if (mode === 'NOT_APPLICABLE') {
    return {
      result: {
        mode,
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
        reasonCodes: [],
      },
      blockers,
      warnings,
    };
  }

  const requiredCount = inventory.requiredCount;
  const available = inventory.available;
  const coverage = coverageOf(available, requiredCount);
  const freshness =
    inventory.freshnessApplicable === false
      ? ('UNKNOWN' as MiFreshnessState)
      : classifyFreshness({
          policy: requirement.freshness,
          asOf,
          latestTimestamp: inventory.latestTimestamp,
        });

  const reasonCodes: MiPreflightReasonCode[] = [...(inventory.inventoryReasons ?? [])];
  for (const code of inventory.inventoryReasons ?? []) {
    if (INVENTORY_FAILURE_CODES.has(code)) warnings.push(code);
  }

  if (mode === 'REQUIRED') {
    if (coverage !== 'COMPLETE') {
      blockers.push(insufficientCode);
      reasonCodes.push(insufficientCode);
    }
    if (
      freshness === 'STALE' ||
      (freshness === 'DELAYED' && requirement.freshness.mode === 'STRICT')
    ) {
      // STALE always blocks when required; DELAYED blocks only under STRICT
      if (freshness === 'STALE' || requirement.freshness.mode === 'STRICT') {
        if (freshness === 'STALE' || (freshness === 'DELAYED' && available > 0)) {
          if (freshness === 'STALE') {
            blockers.push('STALE_REQUIRED_DATA');
            reasonCodes.push('STALE_REQUIRED_DATA');
          }
        }
      }
    }
    // For STRICT: DELAYED also blocks as stale-required when maxAge exceeded into DELAYED band?
    // Plan: "When capability is REQUIRED and freshness is STALE/invalid → blocker"
    // DELAYED is "invalid" under STRICT for quotes — treat DELAYED as blocker for STRICT required.
    if (requirement.freshness.mode === 'STRICT' && freshness === 'DELAYED') {
      blockers.push('STALE_REQUIRED_DATA');
      reasonCodes.push('STALE_REQUIRED_DATA');
    }
  } else if (mode === 'OPTIONAL') {
    if (coverage !== 'COMPLETE') {
      warnings.push(insufficientCode);
      reasonCodes.push(insufficientCode);
    }
    if (freshness === 'STALE') {
      warnings.push('STALE_REQUIRED_DATA');
      reasonCodes.push('STALE_REQUIRED_DATA');
    }
  }

  return {
    result: {
      mode,
      available,
      requiredCount,
      coverage,
      freshness,
      sampleIssues: inventory.sampleIssues,
      reasonCodes: [...new Set(reasonCodes)],
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

export interface CombinedPreflightInventories {
  marketData: CapabilityInventory;
  historical: CapabilityInventory;
  fundamentals: CapabilityInventory;
  news: CapabilityInventory;
  sentiment: CapabilityInventory;
  corporateEvents: CapabilityInventory;
  macro: CapabilityInventory;
  social: CapabilityInventory;
}

export type CombinedPreflightLegKey =
  | 'marketData'
  | 'historical'
  | 'fundamentals'
  | 'news'
  | 'sentiment'
  | 'corporateEvents'
  | 'macro'
  | 'social';

export interface CombinedPreflightLegs {
  /** The STRICT_ALL verdict — exactly what runCombinedBatchPreflight returns. */
  strict: CombinedBatchPreflightV2;
  identityBlockers: MiPreflightReasonCode[];
  legBlockers: Record<CombinedPreflightLegKey, MiPreflightReasonCode[]>;
}

/**
 * Evaluate CombinedBatchPreflightV2 from plan + inventories.
 * Universe integrity blocks independently of coverage.
 */
export function runCombinedBatchPreflight(input: {
  plan: DataRequirementPlan;
  inventories: CombinedPreflightInventories;
  generatedAt?: string;
}): CombinedBatchPreflightV2 {
  return evaluateCombinedPreflightLegs(input).strict;
}

/** STRICT_ALL evaluation plus per-leg blockers for readiness policies layered on top. */
export function evaluateCombinedPreflightLegs(input: {
  plan: DataRequirementPlan;
  inventories: CombinedPreflightInventories;
  generatedAt?: string;
}): CombinedPreflightLegs {
  const { plan, inventories } = input;
  const asOf = plan.asOf;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const blockers: MiPreflightReasonCode[] = [];
  const warnings: MiPreflightReasonCode[] = [];

  const universe = {
    requested: plan.universe.requestedCount,
    resolved: plan.universe.resolved.length,
    unresolved: plan.universe.unresolved,
    mismatched: plan.universe.mismatched,
  };

  if (universe.unresolved > 0 || universe.mismatched > 0) {
    blockers.push('UNIVERSE_IDENTITY_INCOMPLETE');
    if (universe.unresolved > 0) blockers.push('IDENTITY_UNRESOLVED');
    if (universe.mismatched > 0) blockers.push('IDENTITY_MISMATCH');
  }
  const identityBlockers = [...blockers];

  const md = evaluateCapability(
    plan.marketData,
    inventories.marketData,
    asOf,
    'MARKET_DATA_INSUFFICIENT',
  );
  const hist = evaluateCapability(
    plan.historical,
    inventories.historical,
    asOf,
    'HISTORICAL_DATA_INSUFFICIENT',
  );
  const fund = evaluateCapability(
    plan.intelligence.fundamentals,
    inventories.fundamentals,
    asOf,
    'FUNDAMENTALS_INSUFFICIENT',
  );
  const news = evaluateCapability(
    plan.intelligence.news,
    inventories.news,
    asOf,
    'NEWS_INSUFFICIENT',
  );
  const sent = evaluateCapability(
    plan.intelligence.sentiment,
    inventories.sentiment,
    asOf,
    'SENTIMENT_UNAVAILABLE',
  );
  const corp = evaluateCapability(
    plan.intelligence.corporateEvents,
    inventories.corporateEvents,
    asOf,
    'CORPORATE_EVENTS_INSUFFICIENT',
  );
  const macro = evaluateCapability(
    plan.intelligence.macro,
    inventories.macro,
    asOf,
    'MACRO_UNAVAILABLE',
  );
  const social = evaluateCapability(
    plan.intelligence.social,
    inventories.social,
    asOf,
    'NEWS_INSUFFICIENT', // social unused; keep code set closed
  );

  for (const part of [md, hist, fund, news, sent, corp, macro, social]) {
    blockers.push(...part.blockers);
    warnings.push(...part.warnings);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)].filter((w) => !uniqueBlockers.includes(w));

  const strict: CombinedBatchPreflightV2 = {
    canRun: uniqueBlockers.length === 0,
    universe,
    marketData: md.result,
    historical: hist.result,
    intelligence: {
      fundamentals: fund.result,
      news: news.result,
      sentiment: sent.result,
      corporateEvents: corp.result,
      macro: macro.result,
      social: social.result,
    },
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    generatedAt,
    asOf,
    requirementPlan: {
      universeType: plan.universe.type,
      universeVersion: plan.universe.version,
      historicalMinBars: plan.historical.minimumBarsPerInstrument,
      historicalStart: plan.historical.start,
      historicalEnd: plan.historical.end,
    },
  };

  return {
    strict,
    identityBlockers,
    legBlockers: {
      marketData: md.blockers,
      historical: hist.blockers,
      fundamentals: fund.blockers,
      news: news.blockers,
      sentiment: sent.blockers,
      corporateEvents: corp.blockers,
      macro: macro.blockers,
      social: social.blockers,
    },
  };
}

export function emptyInventory(requiredCount = 0): CapabilityInventory {
  return { available: 0, requiredCount, freshnessApplicable: false };
}

export function naInventory(): CapabilityInventory {
  return { available: 0, requiredCount: 0, freshnessApplicable: false };
}
