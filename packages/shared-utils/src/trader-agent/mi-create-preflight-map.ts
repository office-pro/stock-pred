/**
 * MI-4: map Intelligence Batch create request → BatchPreflightConfiguration.
 * Execution mode (HISTORICAL/LIVE/HYBRID) is never mapped to miMode.
 * Lock 1: caller must pass the exact resolved membership from create.
 */

import type {
  BatchPreflightConfiguration,
  BatchPreflightDuration,
  CreateIntelligenceBatchRequest,
  MarketIntelligenceUniverseType,
  PreflightBlockedErrorBody,
  CombinedBatchPreflightV2,
} from '@stockpred/shared-types';
import { catalogUniverseToMiType } from './market-intelligence-core';

export function parseAnalysisPeriodToDuration(raw?: string | null): BatchPreflightDuration {
  const token = String(raw ?? '3M')
    .trim()
    .toUpperCase();
  if (token === '1W') return { value: 1, unit: 'W' };
  if (token === '1M') return { value: 1, unit: 'M' };
  if (token === '3M') return { value: 3, unit: 'M' };
  if (token === '6M') return { value: 6, unit: 'M' };
  if (token === '1Y' || token === '12M') return { value: 1, unit: 'Y' };
  const m = token.match(/^(\d+)\s*([DWMY])$/);
  if (m) {
    return { value: Number(m[1]), unit: m[2] as 'D' | 'W' | 'M' | 'Y' };
  }
  return { value: 3, unit: 'M' };
}

export function parseHorizonToDuration(raw?: string | null): BatchPreflightDuration {
  return parseAnalysisPeriodToDuration(raw ?? '1M');
}

/**
 * Build BatchPreflightConfiguration from create fields + exact resolved symbols.
 * `resolvedSymbols` must be the same array used for batch skeleton / runLoop.
 */
export function mapCreateRequestToBatchPreflightConfiguration(input: {
  universeType: MarketIntelligenceUniverseType;
  resolvedSymbols: string[];
  analysisPeriod?: string | null;
  analysisResolution?: string | null;
  predictionHorizon?: string | null;
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  intelligence?: BatchPreflightConfiguration['intelligence'];
  asOf?: string;
  newsLookbackDays?: number;
  readinessPolicy?: BatchPreflightConfiguration['readinessPolicy'];
  analysisSession?: BatchPreflightConfiguration['analysisSession'];
}): BatchPreflightConfiguration {
  const locked = input.resolvedSymbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const config: BatchPreflightConfiguration = {
    universeType: input.universeType,
    lockedMembershipSymbols: locked,
    analysisPeriod: parseAnalysisPeriodToDuration(input.analysisPeriod),
    resolution: String(input.analysisResolution ?? '1D').trim() || '1D',
    predictionHorizon: parseHorizonToDuration(input.predictionHorizon),
    mode: input.miMode ?? 'STANDARD',
    intelligence: input.intelligence,
    asOf: input.asOf,
    newsLookbackDays: input.newsLookbackDays,
  };
  if (input.readinessPolicy) config.readinessPolicy = input.readinessPolicy;
  if (input.analysisSession) config.analysisSession = input.analysisSession;
  // Also set type-specific lists for diagnostics / fallback callers.
  if (input.universeType === 'CUSTOM') {
    config.customSymbols = locked;
  } else if (input.universeType === 'NSE_EQUITY_ALL') {
    config.nseEquityAllSymbols = locked;
  }
  return config;
}

/** Map catalog/create universe id → MI type, or null when unsupported. */
export function miUniverseTypeForCreate(universeId: string): MarketIntelligenceUniverseType | null {
  const t = catalogUniverseToMiType(universeId);
  return t === 'UNSUPPORTED' ? null : t;
}

export function buildPreflightBlockedErrorBody(
  combinedPreflight: CombinedBatchPreflightV2,
): PreflightBlockedErrorBody {
  return {
    code: 'PREFLIGHT_BLOCKED',
    message: 'Batch preflight failed',
    blockers: combinedPreflight.blockers,
    combinedPreflight,
    ...(combinedPreflight.blockers.includes('NO_ELIGIBLE_INSTRUMENTS')
      ? { outcome: 'NO_ELIGIBLE_INSTRUMENTS' as const }
      : {}),
  };
}

/** Convenience: pick miMode/intelligence from create request without touching execution mode. */
export function miFlagsFromCreateRequest(req: CreateIntelligenceBatchRequest): {
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  intelligence?: BatchPreflightConfiguration['intelligence'];
} {
  return {
    miMode: req.miMode,
    intelligence: req.intelligence,
  };
}
