/**
 * Market Intelligence — universe resolution + requirements + preflight.
 * No hard-coded universe sizes. Never authorizes trades.
 */

import { createHash } from 'crypto';
import type {
  CombinedBatchPreflightResult,
  InstrumentRef,
  MarketDataPreflightInput,
  MarketIntelligenceBatchConfiguration,
  MarketIntelligencePreflightResult,
  MarketIntelligenceRequirements,
  MarketIntelligenceUniverseType,
  MiCoverageState,
  MiDomainCoverage,
  MiFreshnessState,
  MiIdentityResolution,
  MiInstrumentEvidenceStatus,
  MiRequirementLevel,
} from '@stockpred/shared-types';
import {
  canonicalNiftySnapshot,
  normalizeSymbols,
  resolveIntelligenceUniverse,
} from './intelligence-batch-universe';
import {
  hasEquityStatementsGate,
  indexLatestPanelBySymbol,
  type NseMdsFundamentalsPanelRow,
  type NseMdsNewsPanelRow,
} from './nse-mds-evidence';
import { hasCorporateEvidence, type NseMdsCorporatePanelRow } from './mi-mds-bind';

const PARSER_VERSION = 'mi-normalize.v1';

export function nseEquityInstrumentRef(symbol: string): InstrumentRef {
  return {
    symbol: symbol.trim().toUpperCase(),
    assetClass: 'EQUITY',
    venue: 'NSE',
    quoteCurrency: 'INR',
  };
}

/**
 * Resolve MI universe → InstrumentRef[].
 * NIFTY200 = first 200 of NIFTY500 basket order (documented subset, like NIFTY150).
 * NSE_EQUITY_ALL requires canonical membership symbols (equity-master) — never MDS cache.
 */
export function resolveMarketIntelligenceUniverse(input: {
  universeType: MarketIntelligenceUniverseType;
  customSymbols?: string[];
  nseEquityAllSymbols?: string[];
}): { instruments: InstrumentRef[]; universeVersion: string; membershipSource: string } {
  const type = input.universeType;
  let symbols: string[];
  let membershipSource: string;
  let universeVersion: string;

  switch (type) {
    case 'NIFTY50':
    case 'NIFTY100':
    case 'NIFTY500': {
      const snap = canonicalNiftySnapshot(type);
      symbols = snap.symbols;
      membershipSource = snap.membershipSource;
      universeVersion = snap.version;
      break;
    }
    case 'NIFTY200': {
      const snap = canonicalNiftySnapshot('NIFTY500');
      symbols = snap.symbols.slice(0, 200);
      membershipSource = `${snap.membershipSource}#nifty200-subset`;
      const hash = createHash('sha256')
        .update(JSON.stringify({ universe: 'NIFTY200', symbols }))
        .digest('hex')
        .slice(0, 16);
      universeVersion = `nifty200-${hash}`;
      break;
    }
    case 'NSE_EQUITY_ALL': {
      symbols = resolveIntelligenceUniverse({
        universe: 'NSE_ALL',
        allSymbols: input.nseEquityAllSymbols,
      });
      membershipSource = 'canonical-nse-equity-master';
      const hash = createHash('sha256')
        .update(JSON.stringify({ universe: 'NSE_EQUITY_ALL', count: symbols.length, symbols }))
        .digest('hex')
        .slice(0, 16);
      universeVersion = `nse-equity-all-${hash}`;
      break;
    }
    case 'CUSTOM': {
      symbols = normalizeSymbols(input.customSymbols ?? []);
      if (symbols.length === 0) {
        throw new Error('CUSTOM universe requires a non-empty symbols list');
      }
      membershipSource = 'custom';
      const hash = createHash('sha256')
        .update(JSON.stringify({ universe: 'CUSTOM', symbols }))
        .digest('hex')
        .slice(0, 16);
      universeVersion = `custom-${hash}`;
      break;
    }
    default: {
      const _x: never = type;
      throw new Error(`Unsupported MI universe: ${String(_x)}`);
    }
  }

  return {
    instruments: symbols.map(nseEquityInstrumentRef),
    universeVersion,
    membershipSource,
  };
}

function modeDefaults(mode: MarketIntelligenceBatchConfiguration['mode']): {
  fundamentals: MiRequirementLevel;
  news: MiRequirementLevel;
  corporateEvents: MiRequirementLevel;
} {
  const m = String(mode ?? 'STANDARD').toUpperCase();
  if (m === 'ADVANCED') {
    return { fundamentals: 'required', news: 'required', corporateEvents: 'required' };
  }
  if (m === 'CUSTOM') {
    return { fundamentals: 'optional', news: 'optional', corporateEvents: 'optional' };
  }
  // STANDARD and other modes
  return { fundamentals: 'required', news: 'optional', corporateEvents: 'optional' };
}

export function resolveMarketIntelligenceRequirements(
  config: MarketIntelligenceBatchConfiguration,
): MarketIntelligenceRequirements {
  const resolved = resolveMarketIntelligenceUniverse({
    universeType: config.universeType,
    customSymbols: config.customSymbols,
    nseEquityAllSymbols: config.nseEquityAllSymbols,
  });
  const defaults = modeDefaults(config.mode);
  const features = config.features ?? {};
  return {
    instruments: resolved.instruments,
    requiredCount: resolved.instruments.length,
    universeType: config.universeType,
    universeVersion: resolved.universeVersion,
    fundamentals: features.fundamentals ?? defaults.fundamentals,
    news: features.news ?? defaults.news,
    corporateEvents: features.corporateEvents ?? defaults.corporateEvents,
    newsLookbackDays: config.newsLookbackDays ?? 30,
    fundamentalRecency: 'latest-available',
    asOf: config.asOf ?? new Date().toISOString(),
  };
}

/** Resolve symbol text → NSE cash equity InstrumentRef (controlled; no guessing). */
export function resolveMiInstrumentIdentity(input: {
  symbol?: string;
  venue?: string;
  assetClass?: string;
  isin?: string;
  status?: string;
  /** When true (default), only NSE/BSE EQUITY cash are RESOLVED. */
  requireNseCashEquity?: boolean;
  knownIsinToSymbol?: Record<string, string>;
}): MiIdentityResolution {
  if (input.isin && input.knownIsinToSymbol?.[input.isin]) {
    return {
      status: 'RESOLVED',
      instrument: nseEquityInstrumentRef(input.knownIsinToSymbol[input.isin]),
    };
  }
  const symbol = String(input.symbol ?? '')
    .trim()
    .toUpperCase();
  if (!symbol) {
    return { status: 'IDENTITY_UNRESOLVED', reasonCode: 'IDENTITY_UNRESOLVED' };
  }
  if (symbol.includes(' ') || symbol.includes('/')) {
    return { status: 'IDENTITY_UNRESOLVED', reasonCode: 'IDENTITY_UNRESOLVED' };
  }

  const requireCash = input.requireNseCashEquity !== false;
  const venue = String(input.venue ?? 'NSE').toUpperCase();
  const assetClass = String(input.assetClass ?? 'EQUITY').toUpperCase();
  const status = String(input.status ?? 'ACTIVE').toUpperCase();

  // Explicit wrong venue/class → MISMATCH (not unresolved)
  if (input.venue != null || input.assetClass != null) {
    const venueOk = venue === 'NSE' || venue === 'BSE';
    const classOk = assetClass === 'EQUITY';
    if (requireCash && (!venueOk || !classOk)) {
      return { status: 'IDENTITY_MISMATCH', reasonCode: 'IDENTITY_MISMATCH' };
    }
  } else if (venue && venue !== 'NSE' && venue !== 'BSE') {
    return { status: 'IDENTITY_UNRESOLVED', reasonCode: 'IDENTITY_UNRESOLVED' };
  }

  if (requireCash && status && !['ACTIVE', 'LISTED', 'ELIGIBLE', ''].includes(status)) {
    if (['SUSPENDED', 'DELISTED', 'INACTIVE'].includes(status)) {
      return { status: 'IDENTITY_MISMATCH', reasonCode: 'IDENTITY_MISMATCH' };
    }
  }

  return {
    status: 'RESOLVED',
    instrument: {
      symbol,
      assetClass: 'EQUITY',
      venue: venue === 'BSE' ? 'BSE' : 'NSE',
      quoteCurrency: 'INR',
    },
  };
}

function coverageState(available: number, eligible: number): MiCoverageState {
  if (eligible <= 0) return 'MISSING';
  if (available <= 0) return 'MISSING';
  if (available >= eligible) return 'COMPLETE';
  return 'PARTIAL';
}

function freshnessFromTimestamps(
  timestamps: Array<string | undefined>,
  asOfIso: string,
): MiFreshnessState {
  const asOf = Date.parse(asOfIso);
  const times = timestamps
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  if (times.length === 0) return 'UNKNOWN';
  // Look-ahead: any evidence available after asOf is invalid for this view
  if (times.some((t) => t > asOf)) return 'UNKNOWN';
  const newest = Math.max(...times);
  const ageMs = asOf - newest;
  if (ageMs <= 24 * 60 * 60 * 1000) return 'CURRENT';
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'DELAYED';
  return 'STALE';
}

function domainCoverage(input: {
  eligible: number;
  available: number;
  required: boolean;
  timestamps: Array<string | undefined>;
  asOf: string;
  source?: string;
}): MiDomainCoverage {
  return {
    coverage: coverageState(input.available, input.eligible),
    freshness: freshnessFromTimestamps(input.timestamps, input.asOf),
    eligible: input.eligible,
    available: input.available,
    missing: Math.max(0, input.eligible - input.available),
    required: input.required,
    lastUpdated: input.timestamps.filter(Boolean).sort().at(-1) ?? null,
    source: input.source,
  };
}

/**
 * MI preflight from per-instrument evidence status.
 * Does not fabricate missing data. Coverage ≠ freshness.
 */
export function runMarketIntelligencePreflight(input: {
  requirements: MarketIntelligenceRequirements;
  evidence: MiInstrumentEvidenceStatus[];
}): MarketIntelligencePreflightResult {
  const req = input.requirements;
  const asOf = req.asOf;
  const asOfMs = Date.parse(asOf);
  const bySymbol = new Map(
    input.evidence.map((e) => [e.instrument.symbol.toUpperCase(), e] as const),
  );

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  let fundOk = 0;
  let newsOk = 0;
  let corpOk = 0;
  const fundTs: string[] = [];
  const newsTs: string[] = [];
  const corpTs: string[] = [];
  let unresolved = 0;
  let futureLeak = 0;

  for (const inst of req.instruments) {
    const row = bySymbol.get(inst.symbol.toUpperCase());
    if (!row || row.identityStatus === 'IDENTITY_UNRESOLVED') {
      unresolved += 1;
      continue;
    }

    const checkFuture = (iso?: string): boolean => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return Number.isFinite(t) && t > asOfMs;
    };

    if (row.hasFundamentals) {
      if (checkFuture(row.fundamentalsAvailableAt)) futureLeak += 1;
      else {
        fundOk += 1;
        if (row.fundamentalsAvailableAt) fundTs.push(row.fundamentalsAvailableAt);
      }
    }
    if (row.hasNewsInWindow) {
      if (checkFuture(row.newsLatestAvailableAt)) futureLeak += 1;
      else {
        newsOk += 1;
        if (row.newsLatestAvailableAt) newsTs.push(row.newsLatestAvailableAt);
      }
    }
    if (row.hasCorporateEvents) {
      if (checkFuture(row.corporateLatestAvailableAt)) futureLeak += 1;
      else {
        corpOk += 1;
        if (row.corporateLatestAvailableAt) corpTs.push(row.corporateLatestAvailableAt);
      }
    }
  }

  const eligible = req.requiredCount;
  if (unresolved > 0) {
    warnings.push(`IDENTITY_UNRESOLVED:${unresolved}`);
  }
  if (futureLeak > 0) {
    blockingReasons.push(`FUTURE_DATA_LEAKAGE:${futureLeak}`);
  }

  const fundamentals = domainCoverage({
    eligible,
    available: fundOk,
    required: req.fundamentals === 'required',
    timestamps: fundTs,
    asOf,
    source: 'mi-fundamentals',
  });
  const news = domainCoverage({
    eligible,
    available: newsOk,
    required: req.news === 'required',
    timestamps: newsTs,
    asOf,
    source: 'mi-news',
  });
  const corporateEvents = domainCoverage({
    eligible,
    available: corpOk,
    required: req.corporateEvents === 'required',
    timestamps: corpTs,
    asOf,
    source: 'mi-corporate',
  });

  const checkDomain = (level: MiRequirementLevel, domain: MiDomainCoverage, name: string): void => {
    if (level === 'off') return;
    if (level === 'required' && domain.coverage !== 'COMPLETE') {
      blockingReasons.push(
        `${name}_INSUFFICIENT:${domain.available}/${domain.eligible}:${domain.coverage}`,
      );
    } else if (level === 'optional' && domain.coverage !== 'COMPLETE') {
      warnings.push(`${name}_PARTIAL:${domain.available}/${domain.eligible}:${domain.coverage}`);
    }
  };

  checkDomain(req.fundamentals, fundamentals, 'FUNDAMENTALS');
  checkDomain(req.news, news, 'NEWS');
  checkDomain(req.corporateEvents, corporateEvents, 'CORPORATE_EVENTS');

  if (eligible === 0) {
    blockingReasons.push('EMPTY_UNIVERSE');
  }

  return {
    canRun: blockingReasons.length === 0,
    requirements: req,
    coverage: { fundamentals, news, corporateEvents },
    blockingReasons,
    warnings,
  };
}

/**
 * Map catalog universe ids → MI universe types.
 * NSE_ALL → NSE_EQUITY_ALL. Unknown India equity baskets → CUSTOM with provided symbols.
 */
export function catalogUniverseToMiType(
  universeId: string,
): MarketIntelligenceUniverseType | 'UNSUPPORTED' {
  const id = universeId.trim().toUpperCase();
  if (
    id === 'NIFTY50' ||
    id === 'NIFTY100' ||
    id === 'NIFTY200' ||
    id === 'NIFTY500' ||
    id === 'CUSTOM'
  ) {
    return id;
  }
  if (id === 'NSE_ALL' || id === 'NSE_EQUITY_ALL') return 'NSE_EQUITY_ALL';
  return 'UNSUPPORTED';
}

/** Build MI evidence from existing MDS fundamentals/news/corporate panels (no fabrication). */
export function buildMiEvidenceFromMdsPanels(input: {
  instruments: InstrumentRef[];
  fundamentalsRows?: NseMdsFundamentalsPanelRow[];
  newsRows?: NseMdsNewsPanelRow[];
  corporateRows?: NseMdsCorporatePanelRow[];
  newsLookbackDays?: number;
}): MiInstrumentEvidenceStatus[] {
  const fundBy = indexLatestPanelBySymbol(input.fundamentalsRows);
  const newsBy = indexLatestPanelBySymbol(input.newsRows);
  const corpBy = new Map<string, NseMdsCorporatePanelRow[]>();
  for (const row of input.corporateRows ?? []) {
    const sym = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!sym) continue;
    const list = corpBy.get(sym) ?? [];
    list.push(row);
    corpBy.set(sym, list);
  }
  return input.instruments.map((instrument) => {
    const sym = instrument.symbol.toUpperCase();
    const fund = fundBy.get(sym);
    const news = newsBy.get(sym);
    const corpRows = corpBy.get(sym);
    const hasFundamentals = hasEquityStatementsGate(fund);
    const newsCount = news?.news_count_7d;
    const hasNewsInWindow =
      typeof newsCount === 'number' && Number.isFinite(newsCount) && newsCount > 0;
    const hasCorporateEvents = hasCorporateEvidence(corpRows);
    const corpLatest = corpRows
      ?.map((r) => r.available_at ?? r.published_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      instrument,
      identityStatus: 'RESOLVED' as const,
      hasFundamentals,
      fundamentalsAvailableAt: hasFundamentals
        ? (fund?.available_at ?? fund?.as_of_date ?? undefined ?? undefined)
        : undefined,
      hasNewsInWindow,
      newsLatestAvailableAt: hasNewsInWindow
        ? (news?.available_at ?? news?.as_of_date ?? undefined ?? undefined)
        : undefined,
      hasCorporateEvents,
      corporateLatestAvailableAt: hasCorporateEvents
        ? (corpLatest ?? undefined ?? undefined)
        : undefined,
    };
  });
}

export function combineBatchPreflight(input: {
  marketData: MarketDataPreflightInput;
  marketIntelligence: MarketIntelligencePreflightResult;
}): CombinedBatchPreflightResult {
  const blockingReasons = [
    ...(input.marketData.canRun ? [] : ['MARKET_DATA_PREFLIGHT_FAILED']),
    ...(input.marketData.blockingReasons ?? []),
    ...(input.marketIntelligence.canRun ? [] : ['MARKET_INTELLIGENCE_PREFLIGHT_FAILED']),
    ...input.marketIntelligence.blockingReasons,
  ];
  const warnings = [...(input.marketData.warnings ?? []), ...input.marketIntelligence.warnings];
  return {
    canRun: input.marketData.canRun && input.marketIntelligence.canRun,
    marketData: input.marketData,
    marketIntelligence: input.marketIntelligence,
    blockingReasons: [...new Set(blockingReasons)],
    warnings: [...new Set(warnings)],
  };
}

export { PARSER_VERSION as MI_PARSER_VERSION };
