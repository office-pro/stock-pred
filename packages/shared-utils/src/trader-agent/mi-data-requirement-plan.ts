/**
 * MI-3: BatchPreflightConfiguration → DataRequirementPlan.
 * Explicit intelligence.* flags override mode defaults.
 */

import type {
  AnalysisPeriod,
  BatchPreflightConfiguration,
  BatchPreflightDuration,
  DataRequirementPlan,
  InstrumentRef,
  MiCapabilityRequirement,
  MiFreshnessPolicy,
  MiRequirementMode,
} from '@stockpred/shared-types';
import { createHash } from 'crypto';
import { sufficientDailyCandleLimit } from './historical-requirement';
import {
  nseEquityInstrumentRef,
  resolveMarketIntelligenceUniverse,
  resolveMiInstrumentIdentity,
} from './market-intelligence-core';

const DEFAULT_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_NEWS_LOOKBACK_DAYS = 30;

function durationToAnalysisPeriod(d: BatchPreflightDuration): AnalysisPeriod {
  const v = Math.max(1, Math.floor(Number(d.value) || 1));
  const u = String(d.unit ?? 'M').toUpperCase();
  if (u === 'Y') return v >= 1 ? '1Y' : '6M';
  if (u === 'W') return '1W';
  if (u === 'D') return v <= 7 ? '1W' : v <= 31 ? '1M' : v <= 93 ? '3M' : v <= 186 ? '6M' : '1Y';
  // Months
  if (v <= 1) return '1M';
  if (v <= 3) return '3M';
  if (v <= 6) return '6M';
  return '1Y';
}

function boolToMode(flag: boolean | undefined, fallback: MiRequirementMode): MiRequirementMode {
  if (flag === true) return 'REQUIRED';
  if (flag === false) return 'NOT_APPLICABLE';
  return fallback;
}

function modeIntelligenceDefaults(mode: BatchPreflightConfiguration['mode']): {
  fundamentals: MiRequirementMode;
  news: MiRequirementMode;
  sentiment: MiRequirementMode;
  corporateEvents: MiRequirementMode;
  macro: MiRequirementMode;
  social: MiRequirementMode;
} {
  const m = String(mode ?? 'STANDARD').toUpperCase();
  if (m === 'ADVANCED') {
    return {
      fundamentals: 'REQUIRED',
      news: 'REQUIRED',
      sentiment: 'REQUIRED',
      corporateEvents: 'REQUIRED',
      macro: 'REQUIRED',
      social: 'NOT_APPLICABLE',
    };
  }
  if (m === 'CUSTOM') {
    return {
      fundamentals: 'OPTIONAL',
      news: 'OPTIONAL',
      sentiment: 'OPTIONAL',
      corporateEvents: 'OPTIONAL',
      macro: 'OPTIONAL',
      social: 'NOT_APPLICABLE',
    };
  }
  // STANDARD
  return {
    fundamentals: 'REQUIRED',
    news: 'OPTIONAL',
    sentiment: 'OPTIONAL',
    corporateEvents: 'OPTIONAL',
    macro: 'OPTIONAL',
    social: 'NOT_APPLICABLE',
  };
}

function withFreshness(
  mode: MiRequirementMode,
  freshness: MiFreshnessPolicy,
): MiCapabilityRequirement {
  return { mode, freshness };
}

/**
 * Resolve configuration into a full DataRequirementPlan.
 * Coverage denoms use RESOLVED only; unresolved/mismatched are integrity counts.
 */
export function resolveDataRequirementPlan(
  config: BatchPreflightConfiguration,
): DataRequirementPlan {
  const asOf = config.asOf ?? new Date().toISOString();
  const newsLookbackDays = config.newsLookbackDays ?? DEFAULT_NEWS_LOOKBACK_DAYS;

  let membershipInstruments: InstrumentRef[];
  let universeVersion: string;

  if (config.lockedMembershipSymbols && config.lockedMembershipSymbols.length > 0) {
    // MI-4 Lock 1: exact create-resolved membership — do not re-resolve from catalog.
    membershipInstruments = config.lockedMembershipSymbols.map(nseEquityInstrumentRef);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          universe: config.universeType,
          locked: config.lockedMembershipSymbols,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    universeVersion = `locked-${config.universeType.toLowerCase()}-${hash}`;
  } else {
    const resolvedUniverse = resolveMarketIntelligenceUniverse({
      universeType: config.universeType,
      customSymbols: config.customSymbols,
      nseEquityAllSymbols: config.nseEquityAllSymbols,
    });
    membershipInstruments = resolvedUniverse.instruments;
    universeVersion = resolvedUniverse.universeVersion;
  }

  const resolved: InstrumentRef[] = [];
  let unresolved = 0;
  let mismatched = 0;

  for (const inst of membershipInstruments) {
    const id = resolveMiInstrumentIdentity({
      symbol: inst.symbol,
      venue: inst.venue,
      assetClass: inst.assetClass,
    });
    if (id.status === 'RESOLVED' && id.instrument) {
      resolved.push(id.instrument);
    } else if (id.status === 'IDENTITY_MISMATCH') {
      mismatched += 1;
    } else {
      unresolved += 1;
    }
  }

  const period = durationToAnalysisPeriod(config.analysisPeriod);
  const hist = sufficientDailyCandleLimit(period);
  const resolution = String(config.resolution ?? '1D').trim() || '1D';

  const defaults = modeIntelligenceDefaults(config.mode);
  const flags = config.intelligence ?? {};

  const fundamentalsMode = boolToMode(flags.fundamentals, defaults.fundamentals);
  const newsMode = boolToMode(flags.news, defaults.news);
  // Sentiment only applies when news is in play; explicit sentiment:false still wins.
  const sentimentFallback =
    newsMode === 'NOT_APPLICABLE' && flags.sentiment === undefined
      ? 'NOT_APPLICABLE'
      : defaults.sentiment;
  const sentimentMode = boolToMode(flags.sentiment, sentimentFallback);
  const corporateMode = boolToMode(flags.corporateEvents, defaults.corporateEvents);
  const macroMode = boolToMode(flags.macro, defaults.macro);
  const socialMode = boolToMode(flags.social, defaults.social);

  return {
    universe: {
      type: config.universeType,
      version: universeVersion,
      instruments: membershipInstruments,
      requestedCount: membershipInstruments.length,
      resolved,
      unresolved,
      mismatched,
    },
    asOf,
    marketData: {
      required: true,
      mode: 'REQUIRED',
      freshness: { mode: 'STRICT', maxAgeMs: DEFAULT_QUOTE_MAX_AGE_MS },
    },
    historical: {
      required: true,
      mode: 'REQUIRED',
      freshness: { mode: 'LATEST_AVAILABLE' },
      resolution,
      start: hist.startDate,
      end: hist.endDate,
      minimumBarsPerInstrument: hist.limit,
    },
    intelligence: {
      fundamentals: withFreshness(fundamentalsMode, { mode: 'LATEST_AVAILABLE' }),
      news: withFreshness(newsMode, {
        mode: 'WINDOWED',
        maxAgeMs: newsLookbackDays * 86_400_000,
      }),
      sentiment: withFreshness(sentimentMode, {
        mode: 'WINDOWED',
        maxAgeMs: newsLookbackDays * 86_400_000,
      }),
      corporateEvents: withFreshness(corporateMode, { mode: 'LATEST_AVAILABLE' }),
      macro: withFreshness(macroMode, { mode: 'LATEST_AVAILABLE' }),
      social: withFreshness(socialMode, { mode: 'WINDOWED' }),
    },
    newsLookbackDays,
  };
}

/** Test helper: build InstrumentRef list without re-running universe catalog. */
export function planInstrumentsFromSymbols(symbols: string[]): InstrumentRef[] {
  return symbols.map(nseEquityInstrumentRef);
}

export { durationToAnalysisPeriod, modeIntelligenceDefaults };
