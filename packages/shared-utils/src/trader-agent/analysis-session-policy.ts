/**
 * Slice G — analysis-session.v1
 * Orthogonal to readiness-policy.v1. Never authorizes trades.
 * OFF_SESSION_ANALYSIS must be explicit; CURRENT_MARKET never silently downgrades.
 */

import type {
  AnalysisActionability,
  AnalysisQuoteDataStatus,
  AnalysisQuoteProvenance,
  AnalysisSessionContract,
  CombinedBatchPreflightV2,
  MiFreshnessPolicy,
  MiPreflightReasonCode,
} from '@stockpred/shared-types';
import { ANALYSIS_SESSION_VERSION } from '@stockpred/shared-types';
import { isNseRegularSession } from '../market-hours';

export const DEFAULT_ANALYSIS_SESSION: AnalysisSessionContract = {
  id: 'CURRENT_MARKET',
  version: ANALYSIS_SESSION_VERSION,
};

export class AnalysisSessionError extends Error {
  readonly code:
    | 'ANALYSIS_SESSION_INVALID'
    | 'ANALYSIS_SESSION_UNKNOWN_VERSION'
    | 'ANALYSIS_SESSION_UNKNOWN_ID';

  constructor(code: AnalysisSessionError['code'], message: string) {
    super(message);
    this.name = 'AnalysisSessionError';
    this.code = code;
  }
}

/** Normalize request field. Undefined/null → CURRENT_MARKET (default). */
export function normalizeAnalysisSession(raw: unknown): AnalysisSessionContract {
  if (raw == null) return { ...DEFAULT_ANALYSIS_SESSION };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AnalysisSessionError('ANALYSIS_SESSION_INVALID', 'analysisSession must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== ANALYSIS_SESSION_VERSION) {
    throw new AnalysisSessionError(
      'ANALYSIS_SESSION_UNKNOWN_VERSION',
      `Unsupported analysis session version: expected ${ANALYSIS_SESSION_VERSION}, got ${String(r.version)}`,
    );
  }
  const id = r.id;
  if (id !== 'CURRENT_MARKET' && id !== 'OFF_SESSION_ANALYSIS') {
    throw new AnalysisSessionError(
      'ANALYSIS_SESSION_UNKNOWN_ID',
      `Unknown analysisSession.id: ${String(id)}`,
    );
  }
  return { id, version: ANALYSIS_SESSION_VERSION };
}

/** Coerce stored JSON; invalid → CURRENT_MARKET (never invent OFF_SESSION). */
export function coerceStoredAnalysisSession(raw: unknown): AnalysisSessionContract {
  try {
    return normalizeAnalysisSession(raw);
  } catch {
    return { ...DEFAULT_ANALYSIS_SESSION };
  }
}

export function isOffSessionAnalysis(session: AnalysisSessionContract | undefined): boolean {
  return (session ?? DEFAULT_ANALYSIS_SESSION).id === 'OFF_SESSION_ANALYSIS';
}

/**
 * Quote freshness policy for the data-requirement plan.
 * Venue closed → LATEST_AVAILABLE (research on prior tip; timestamps unchanged).
 * Venue open → STRICT 15m (CURRENT_MARKET always; OFF_SESSION too — no laundering).
 */
/**
 * Hard integrity outages that still prevent research analyze.
 * Partial STRICT coverage (e.g. 499/500) is NOT a research outage — generate skips gaps.
 * Quote age / STALE is handled separately (only blocks when venue is open).
 */
const OFF_SESSION_OUTAGE_BLOCKERS: ReadonlySet<MiPreflightReasonCode> = new Set([
  'UNIVERSE_IDENTITY_INCOMPLETE',
  'IDENTITY_UNRESOLVED',
  'IDENTITY_MISMATCH',
  'QUOTE_INVENTORY_UNAVAILABLE',
  'HISTORICAL_INVENTORY_UNAVAILABLE',
  'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
]);

export function quoteFreshnessPolicyForAnalysisSession(input: {
  analysisSession: AnalysisSessionContract;
  venueSessionOpen: boolean;
  strictMaxAgeMs?: number;
}): MiFreshnessPolicy {
  const maxAge = input.strictMaxAgeMs ?? 15 * 60 * 1000;
  if (!input.venueSessionOpen) {
    return { mode: 'LATEST_AVAILABLE' };
  }
  return { mode: 'STRICT', maxAgeMs: maxAge };
}

/** Research gate shared by OFF_SESSION and CURRENT_MARKET when the venue is closed. */
function applyResearchAnalyzeGate(
  combined: CombinedBatchPreflightV2,
  venueOpen: boolean,
): {
  blockers: MiPreflightReasonCode[];
  warnings: MiPreflightReasonCode[];
  canAnalyze: boolean;
} {
  const researchBlockers: MiPreflightReasonCode[] = combined.blockers.filter((b) =>
    OFF_SESSION_OUTAGE_BLOCKERS.has(b),
  );
  if (venueOpen && combined.blockers.includes('STALE_REQUIRED_DATA')) {
    researchBlockers.push('STALE_REQUIRED_DATA');
  }
  if ((combined.marketData?.available ?? 0) <= 0) {
    researchBlockers.push('MARKET_DATA_INSUFFICIENT');
  }
  if ((combined.historical?.available ?? 0) <= 0) {
    researchBlockers.push('HISTORICAL_DATA_INSUFFICIENT');
  }
  const uniqueResearch = [...new Set(researchBlockers)];
  const demotedToWarnings = combined.blockers.filter((b) => !uniqueResearch.includes(b));
  return {
    blockers: uniqueResearch,
    warnings: [...new Set([...combined.warnings, ...demotedToWarnings])],
    canAnalyze: uniqueResearch.length === 0,
  };
}

/**
 * Display status from preserved source timestamp — never mutates the timestamp.
 * Closed session + valid tip → OFF_SESSION (even if age >> 15m).
 * Open session + age > maxAge → STALE.
 */
export function resolveAnalysisQuoteProvenance(input: {
  asOfMs: number;
  latestQuoteTimestampMs: number | null | undefined;
  venueSessionOpen: boolean;
  strictMaxAgeMs?: number;
}): AnalysisQuoteProvenance {
  const maxAge = input.strictMaxAgeMs ?? 15 * 60 * 1000;
  const tip = input.latestQuoteTimestampMs;
  if (tip == null || !Number.isFinite(tip) || tip <= 0) {
    return {
      dataStatus: 'UNKNOWN',
      dataAsOfMs: null,
      dataAgeMs: null,
      venueSessionOpen: input.venueSessionOpen,
    };
  }
  const dataAgeMs = Math.max(0, input.asOfMs - tip);
  let dataStatus: AnalysisQuoteDataStatus;
  if (!input.venueSessionOpen) {
    dataStatus = 'OFF_SESSION';
  } else if (dataAgeMs <= maxAge) {
    dataStatus = 'CURRENT';
  } else {
    dataStatus = 'STALE';
  }
  return {
    dataStatus,
    dataAsOfMs: tip,
    dataAgeMs,
    venueSessionOpen: input.venueSessionOpen,
  };
}

export function actionabilityForAnalysisSession(
  session: AnalysisSessionContract,
  opts?: { venueSessionOpen?: boolean },
): AnalysisActionability {
  if (session.id === 'OFF_SESSION_ANALYSIS') return 'NON_ACTIONABLE';
  // CURRENT_MARKET while venue closed is research-only (matches applyAnalysisSessionToPreflight).
  if (opts?.venueSessionOpen === false) return 'NON_ACTIONABLE';
  return 'ACTIONABLE_CANDIDATE';
}

/**
 * Apply analysis-session.v1 onto a readiness preflight verdict.
 * Never renames CURRENT_MARKET → OFF_SESSION.
 * - canAnalyze: research gate (partial coverage OK) — enables intelligence-batch create from UI.
 * - canRun: STRICT readiness only when CURRENT_MARKET + venue open (trade candidate).
 * - OFF_SESSION / venue closed: canRun=false, NON_ACTIONABLE.
 */
export function applyAnalysisSessionToPreflight(input: {
  combined: CombinedBatchPreflightV2;
  analysisSession: AnalysisSessionContract;
  venueSessionOpen?: boolean;
  latestQuoteTimestampMs?: number | null;
  nowMs?: number;
}): CombinedBatchPreflightV2 {
  const session = input.analysisSession;
  const venueOpen = input.venueSessionOpen ?? isNseRegularSession(input.nowMs ?? Date.now());
  const asOfMs = Date.parse(input.combined.asOf) || (input.nowMs ?? Date.now());
  const quoteProvenance = resolveAnalysisQuoteProvenance({
    asOfMs,
    latestQuoteTimestampMs: input.latestQuoteTimestampMs ?? null,
    venueSessionOpen: venueOpen,
  });

  const research = applyResearchAnalyzeGate(input.combined, venueOpen);
  const tradeReady = session.id === 'CURRENT_MARKET' && venueOpen && input.combined.canRun === true;

  return {
    ...input.combined,
    canRun: tradeReady,
    canAnalyze: research.canAnalyze,
    // Surface research blockers for UI Run; keep STRICT codes as warnings when demoted.
    blockers: research.blockers,
    warnings: research.warnings,
    analysisSession: session,
    analysisActionability: tradeReady ? 'ACTIONABLE_CANDIDATE' : 'NON_ACTIONABLE',
    quoteProvenance,
  };
}

export function analysisSessionErrorBody(err: unknown): {
  code: string;
  message: string;
} | null {
  if (err instanceof AnalysisSessionError) {
    return { code: err.code, message: err.message };
  }
  return null;
}
