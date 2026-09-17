/**
 * Canonical Universe Registry — membership source of truth.
 * MDS/cache is NEVER universe membership. NSE_ALL comes from equity-master
 * (NSE EQUITY_L.csv via ingest:listings), with atomic versioned snapshots.
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Exchange } from '@stockpred/shared-types';
import type {
  CompletenessStatus,
  DataIngestionRun,
  EligibilityStatus,
  UniverseMembership,
  UniverseRefreshPolicy,
  UniverseValidationResult,
} from '@stockpred/shared-types';
import {
  equityMasterPath,
  isPlaceholderSymbol,
  loadEquityMaster,
  type ListedEquity,
} from './listings';

export type CanonicalUniverseId =
  | 'NSE_ALL'
  | 'US_SP500'
  | 'US_ALL'
  | 'CRYPTO_ALL'
  | 'CRYPTO_SPOT_ALL'
  | 'CRYPTO_FUTURES_ALL'
  | 'COMMODITY_ALL'
  | 'FUTURES_ALL'
  | 'MCX_FUTURES_ALL'
  | 'CME_FUTURES_ALL'
  | 'FOREX_ALL';

/** CRYPTO_ALL is a compatibility alias of CRYPTO_SPOT_ALL. FUTURES_ALL stays unsupported. */
export function normalizeCanonicalUniverseId(id: string): CanonicalUniverseId {
  const u = String(id ?? '')
    .trim()
    .toUpperCase();
  if (u === 'CRYPTO_ALL' || u === 'CRYPTO_SPOT_ALL') return 'CRYPTO_SPOT_ALL';
  return u as CanonicalUniverseId;
}

export type SnapshotLifecycle =
  | 'DISCOVER'
  | 'FETCH'
  | 'NORMALIZE'
  | 'IDENTITY_VALIDATION'
  | 'DEDUPLICATE'
  | 'CLASSIFY'
  | 'ELIGIBILITY'
  | 'COMPLETENESS'
  | 'VERSION'
  | 'PUBLISH'
  | 'REJECTED';

export interface CanonicalUniverseInstrument {
  symbol: string;
  name: string;
  venue: string;
  series: string;
  isin: string | null;
  assetClass?: string;
  quoteCurrency?: string;
  underlying?: string;
  expiry?: string;
  contractMonth?: string;
  contractMultiplier?: number;
  provider?: string;
  providerAssetId?: string;
  baseAsset?: string;
  quoteAsset?: string;
  canonicalSymbol?: string;
  contractType?: 'PERPETUAL' | 'MONTHLY' | 'QUARTERLY' | 'PRODUCT';
  instrumentType?: 'SPOT' | 'PRODUCT' | 'FUTURES_CONTRACT' | 'EQUITY';
  eligibilityStatus: EligibilityStatus;
  eligibilityReason?: string;
  universeVersion?: string;
}

export interface CanonicalUniverseSnapshot {
  universeId: CanonicalUniverseId;
  source: string;
  sourceUrl?: string;
  fetchedAt: number;
  effectiveDate: string;
  version: string;
  lifecycle: SnapshotLifecycle;
  validationStatus: CompletenessStatus;
  rawRecordCount: number;
  sourceCount: number;
  eligibleRecordCount: number;
  instruments: CanonicalUniverseInstrument[];
  validation: UniverseValidationResult;
  ingestionRun?: DataIngestionRun;
}

const DEFAULT_REFRESH_POLICY: UniverseRefreshPolicy = {
  minRelativeRetention: 0.85,
  maxDropPct: 0.15,
};

function snapshotsDir(): string {
  const override = process.env.CANONICAL_UNIVERSE_SNAPSHOT_DIR?.trim();
  if (override) return override;
  return join(__dirname, '..', 'data', 'universe-snapshots');
}

function activePath(universeId: string): string {
  return join(snapshotsDir(), `${universeId}.active.json`);
}

function versionPath(universeId: string, version: string): string {
  const safe = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(snapshotsDir(), `${universeId}.${safe}.json`);
}

function unsupportedArtifactPath(universeId: string): string {
  return join(snapshotsDir(), `${universeId}.canonical.json`);
}

function shaVersion(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function effectiveDateFrom(isoOrMs: string | number): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function loadMasterMeta(): { updatedAt: string; source: string; stocks: ListedEquity[] } {
  const path = equityMasterPath();
  if (!existsSync(path)) {
    return { updatedAt: '', source: '', stocks: [] };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    updatedAt?: string;
    source?: string;
    stocks?: ListedEquity[];
  };
  return {
    updatedAt: parsed.updatedAt ?? '',
    source: parsed.source ?? 'equity-master.json',
    stocks: (parsed.stocks ?? []).filter((r) => !isPlaceholderSymbol(r.symbol)),
  };
}

/**
 * Eligibility for StockPred NSE equity analysis:
 * NSE venue, EQ series, non-placeholder, valid symbol identity.
 * sourceCount ≠ eligibleCount by design.
 */
export function classifyNseEligibility(row: ListedEquity): {
  status: EligibilityStatus;
  reason?: string;
} {
  const symbol = String(row.symbol ?? '')
    .trim()
    .toUpperCase();
  if (!symbol) return { status: 'INVALID_IDENTITY', reason: 'empty_symbol' };
  if (isPlaceholderSymbol(symbol)) {
    return { status: 'INVALID_IDENTITY', reason: 'placeholder_symbol' };
  }
  if (row.exchange !== Exchange.NSE) {
    return { status: 'EXCLUDED', reason: 'non_nse_exchange' };
  }
  const series = String(row.series ?? '')
    .trim()
    .toUpperCase();
  if (series && series !== 'EQ') {
    return { status: 'EXCLUDED', reason: `series_${series || 'unknown'}` };
  }
  if (row.isin && !String(row.isin).startsWith('INE') && !String(row.isin).startsWith('INF')) {
    return { status: 'EXCLUDED', reason: 'isin_filter' };
  }
  return { status: 'ELIGIBLE' };
}

export function evaluateCompletenessGuard(input: {
  previousEligible: number;
  nextEligible: number;
  policy?: UniverseRefreshPolicy;
}): { ok: boolean; completenessStatus: CompletenessStatus; errors: string[] } {
  const policy = { ...DEFAULT_REFRESH_POLICY, ...input.policy };
  const errors: string[] = [];
  if (input.nextEligible <= 0) {
    errors.push('eligible_count_zero');
    return { ok: false, completenessStatus: 'FAILED', errors };
  }
  if (policy.minAbsoluteCount != null && input.nextEligible < policy.minAbsoluteCount) {
    errors.push(`below_min_absolute:${input.nextEligible}<${policy.minAbsoluteCount}`);
  }
  if (input.previousEligible > 0) {
    const retention = input.nextEligible / input.previousEligible;
    const dropPct = 1 - retention;
    if (policy.minRelativeRetention != null && retention < policy.minRelativeRetention) {
      errors.push(`retention_breach:${retention.toFixed(3)}<${policy.minRelativeRetention}`);
    }
    if (policy.maxDropPct != null && dropPct > policy.maxDropPct) {
      errors.push(`drop_pct_breach:${dropPct.toFixed(3)}>${policy.maxDropPct}`);
    }
  }
  if (errors.length) {
    return { ok: false, completenessStatus: 'PARTIAL', errors };
  }
  return { ok: true, completenessStatus: 'COMPLETE', errors: [] };
}

export function loadActiveUniverseSnapshot(
  universeId: CanonicalUniverseId,
): CanonicalUniverseSnapshot | null {
  const resolved = normalizeCanonicalUniverseId(universeId);
  const candidates =
    resolved === 'CRYPTO_SPOT_ALL'
      ? (['CRYPTO_SPOT_ALL', 'CRYPTO_ALL'] as const)
      : ([resolved] as const);
  for (const id of candidates) {
    const path = activePath(id);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as CanonicalUniverseSnapshot;
    } catch {
      continue;
    }
  }
  return null;
}

export function isPublishableUniverseSnapshot(
  snapshot: CanonicalUniverseSnapshot | null | undefined,
): snapshot is CanonicalUniverseSnapshot {
  if (!snapshot) return false;
  if (snapshot.lifecycle !== 'PUBLISH' || snapshot.validationStatus !== 'COMPLETE') return false;
  if (snapshot.validation?.completenessStatus !== 'COMPLETE') return false;
  if (snapshot.eligibleRecordCount <= 0 || snapshot.instruments.length <= 0) return false;
  if (
    snapshot.ingestionRun?.providerReportedTotal != null &&
    snapshot.ingestionRun.receivedTotal < snapshot.ingestionRun.providerReportedTotal
  ) {
    return false;
  }
  return true;
}

function atomicWriteJson(targetPath: string, payload: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmp, targetPath);
}

/**
 * Publish NSE_ALL from equity-master (canonical NSE listings artifact).
 * On completeness failure: REJECT new snapshot; retain last-known-good active.
 */
export function publishNseAllFromEquityMaster(opts?: {
  policy?: UniverseRefreshPolicy;
  now?: number;
}): {
  snapshot: CanonicalUniverseSnapshot | null;
  published: boolean;
  validation: UniverseValidationResult;
  reason?: string;
} {
  const now = opts?.now ?? Date.now();
  const runId = `uir-${randomUUID()}`;
  const meta = loadMasterMeta();
  const stocks = meta.stocks.length ? meta.stocks : loadEquityMaster();
  const source = meta.source || 'NSE EQUITY_L.csv via equity-master.json';

  let duplicateCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  const seen = new Set<string>();
  const instruments: CanonicalUniverseInstrument[] = [];

  for (const row of stocks) {
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!symbol) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(symbol);
    const { status, reason } = classifyNseEligibility(row);
    if (status === 'INVALID_IDENTITY') {
      rejectedCount += 1;
      continue;
    }
    if (status !== 'ELIGIBLE') {
      excludedCount += 1;
      continue;
    }
    instruments.push({
      symbol,
      name: row.name,
      venue: 'NSE',
      series: row.series || 'EQ',
      isin: row.isin,
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: reason,
    });
  }

  instruments.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const eligibleSymbols = instruments.map((i) => i.symbol);
  const versionPayload = JSON.stringify({
    universeId: 'NSE_ALL',
    source,
    symbols: eligibleSymbols,
  });
  const version = `nse-all-${shaVersion(versionPayload)}`;

  const previous = loadActiveUniverseSnapshot('NSE_ALL');
  const guard = evaluateCompletenessGuard({
    previousEligible: previous?.eligibleRecordCount ?? 0,
    nextEligible: instruments.length,
    policy: opts?.policy,
  });

  const validation: UniverseValidationResult = {
    universeId: 'NSE_ALL',
    source,
    sourceCount: stocks.length,
    normalizedCount: seen.size,
    eligibleCount: instruments.length,
    rejectedCount,
    duplicateCount,
    excludedCount,
    completenessStatus: guard.completenessStatus,
    warnings:
      stocks.length === 0
        ? ['equity_master_empty_run_ingest_listings']
        : previous && previous.eligibleRecordCount !== instruments.length
          ? [`eligible_delta:${previous.eligibleRecordCount}->${instruments.length}`]
          : [],
    errors: guard.errors,
  };

  const ingestionRun: DataIngestionRun = {
    runId,
    provider: 'nse-equity-master',
    universe: 'NSE_ALL',
    startedAt: now,
    completedAt: now,
    requested: stocks.length,
    received: stocks.length,
    normalized: seen.size,
    rejected: rejectedCount,
    duplicates: duplicateCount,
    missing: 0,
    failed: guard.ok ? 0 : 1,
    requestCount: 1,
    pageCount: 1,
    cursorCount: 0,
    providerReportedTotal: stocks.length,
    receivedTotal: stocks.length,
    completenessStatus: guard.completenessStatus,
    errorCodes: guard.errors,
  };

  if (!guard.ok || instruments.length === 0) {
    return {
      snapshot: previous,
      published: false,
      validation,
      reason:
        instruments.length === 0
          ? 'UNIVERSE_REFRESH_FAILED:empty_eligible'
          : `UNIVERSE_REFRESH_FAILED:${guard.errors.join('|')}`,
    };
  }

  const snapshot: CanonicalUniverseSnapshot = {
    universeId: 'NSE_ALL',
    source,
    sourceUrl: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
    fetchedAt: now,
    effectiveDate: effectiveDateFrom(meta.updatedAt || now),
    version,
    lifecycle: 'PUBLISH',
    validationStatus: 'COMPLETE',
    rawRecordCount: stocks.length,
    sourceCount: stocks.length,
    eligibleRecordCount: instruments.length,
    instruments,
    validation,
    ingestionRun,
  };

  atomicWriteJson(versionPath('NSE_ALL', version), snapshot);
  atomicWriteJson(activePath('NSE_ALL'), snapshot);

  return { snapshot, published: true, validation };
}

/** Atomic publish for any canonical universe. Partial/incomplete runs keep last-known-good. */
export function publishCanonicalUniverseSnapshot(input: {
  universeId: CanonicalUniverseId;
  source: string;
  sourceUrl?: string;
  provider: string;
  instruments: CanonicalUniverseInstrument[];
  sourceCount: number;
  rawRecordCount: number;
  rejectedCount: number;
  duplicateCount: number;
  excludedCount: number;
  warnings?: string[];
  now?: number;
  policy?: UniverseRefreshPolicy;
  providerReportedTotal?: number;
  receivedTotal?: number;
  pageCount?: number;
}): {
  snapshot: CanonicalUniverseSnapshot | null;
  published: boolean;
  validation: UniverseValidationResult;
  reason?: string;
} {
  const now = input.now ?? Date.now();
  const eligible = input.instruments
    .filter((row) => row.eligibilityStatus === 'ELIGIBLE')
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const previous = loadActiveUniverseSnapshot(input.universeId);
  const guard = evaluateCompletenessGuard({
    previousEligible: previous?.eligibleRecordCount ?? 0,
    nextEligible: eligible.length,
    policy: input.policy,
  });
  const receivedTotal = input.receivedTotal ?? input.rawRecordCount;
  const incompleteFetch =
    input.providerReportedTotal != null && receivedTotal < input.providerReportedTotal;
  const validation: UniverseValidationResult = {
    universeId: input.universeId,
    source: input.source,
    sourceCount: input.sourceCount,
    normalizedCount: input.instruments.length,
    eligibleCount: eligible.length,
    rejectedCount: input.rejectedCount,
    duplicateCount: input.duplicateCount,
    excludedCount: input.excludedCount,
    completenessStatus: incompleteFetch ? 'PARTIAL' : guard.completenessStatus,
    warnings: input.warnings ?? [],
    errors: incompleteFetch
      ? [`provider_total_incomplete:${receivedTotal}<${input.providerReportedTotal}`]
      : guard.errors,
  };
  const ingestionRun: DataIngestionRun = {
    runId: `uir-${randomUUID()}`,
    provider: input.provider,
    universe: input.universeId,
    startedAt: now,
    completedAt: now,
    requested: input.sourceCount,
    received: receivedTotal,
    normalized: input.instruments.length,
    rejected: input.rejectedCount,
    duplicates: input.duplicateCount,
    missing: Math.max(0, input.sourceCount - receivedTotal),
    failed: guard.ok && !incompleteFetch ? 0 : 1,
    requestCount: Math.max(1, input.pageCount ?? 1),
    pageCount: Math.max(1, input.pageCount ?? 1),
    cursorCount: 0,
    providerReportedTotal: input.providerReportedTotal,
    receivedTotal,
    completenessStatus: validation.completenessStatus,
    errorCodes: validation.errors,
  };
  if (!guard.ok || incompleteFetch || eligible.length === 0) {
    return {
      snapshot: previous,
      published: false,
      validation,
      reason:
        eligible.length === 0
          ? 'UNIVERSE_REFRESH_FAILED:empty_eligible'
          : `UNIVERSE_REFRESH_FAILED:${validation.errors.join('|')}`,
    };
  }
  const version = `${input.universeId.toLowerCase()}-${shaVersion(
    JSON.stringify({
      universeId: input.universeId,
      source: input.source,
      symbols: eligible.map((row) => row.providerAssetId ?? row.symbol),
    }),
  )}`;
  const snapshot: CanonicalUniverseSnapshot = {
    universeId: input.universeId,
    source: input.source,
    sourceUrl: input.sourceUrl,
    fetchedAt: now,
    effectiveDate: effectiveDateFrom(now),
    version,
    lifecycle: 'PUBLISH',
    validationStatus: 'COMPLETE',
    rawRecordCount: input.rawRecordCount,
    sourceCount: input.sourceCount,
    eligibleRecordCount: eligible.length,
    instruments: eligible.map((row) => ({ ...row, universeVersion: version })),
    validation,
    ingestionRun,
  };
  atomicWriteJson(versionPath(input.universeId, version), snapshot);
  atomicWriteJson(activePath(input.universeId), snapshot);
  if (normalizeCanonicalUniverseId(input.universeId) === 'CRYPTO_SPOT_ALL') {
    atomicWriteJson(activePath('CRYPTO_ALL'), { ...snapshot, universeId: 'CRYPTO_SPOT_ALL' });
  }
  return { snapshot, published: true, validation };
}

/** Ensure active NSE_ALL exists (publish from equity-master if missing). */
export function ensureNseAllSnapshot(opts?: {
  policy?: UniverseRefreshPolicy;
  now?: number;
}): CanonicalUniverseSnapshot {
  const active = loadActiveUniverseSnapshot('NSE_ALL');
  if (isPublishableUniverseSnapshot(active)) {
    return active;
  }
  const result = publishNseAllFromEquityMaster(opts);
  if (result.snapshot) return result.snapshot;
  throw new Error(
    result.reason ??
      'NSE_ALL unavailable — run npm run ingest:listings to build equity-master.json',
  );
}

export function resolveNseAllMembership(opts?: { refresh?: boolean }): {
  symbols: string[];
  snapshot: CanonicalUniverseSnapshot;
  membership: UniverseMembership[];
} {
  const snapshot = opts?.refresh
    ? (publishNseAllFromEquityMaster().snapshot ?? ensureNseAllSnapshot())
    : ensureNseAllSnapshot();
  if (!isPublishableUniverseSnapshot(snapshot)) {
    throw new Error('UNIVERSE_REFRESH_FAILED:NSE_ALL active snapshot is not PUBLISH/COMPLETE');
  }
  const instruments = snapshot.instruments;
  const membership: UniverseMembership[] = instruments.map((i) => ({
    universeId: 'NSE_ALL',
    membershipSource: snapshot.source,
    effectiveDate: snapshot.effectiveDate,
    discoveredAt: snapshot.fetchedAt,
    eligibilityStatus: i.eligibilityStatus,
    eligibilityReason: i.eligibilityReason,
    symbol: i.symbol,
  }));
  return {
    symbols: instruments.map((i) => i.symbol),
    snapshot,
    membership,
  };
}

export function membershipIdentity(row: CanonicalUniverseInstrument): string {
  return String(row.providerAssetId ?? row.symbol ?? '').trim();
}

export function gatedUniverseUnavailableDetail(universeId: CanonicalUniverseId): string {
  switch (normalizeCanonicalUniverseId(universeId)) {
    case 'CRYPTO_ALL':
    case 'CRYPTO_SPOT_ALL':
      return 'CRYPTO_SPOT_ALL (alias CRYPTO_ALL) is all eligible crypto spot instruments from CRYPTO_UNIVERSE_PROVIDER (binance or coingecko, never merged). Run npm run ingest:crypto to publish a versioned snapshot. Membership is not a market-data download.';
    case 'CRYPTO_FUTURES_ALL':
      return 'CRYPTO_FUTURES_ALL is Binance Futures contracts (PERPETUAL / MONTHLY / QUARTERLY). Run npm run ingest:crypto-futures. Spot and futures are different instruments.';
    case 'COMMODITY_ALL':
      return 'COMMODITY_ALL is commodity products/underlyings from a validated Alpha Vantage catalog (optional EIA energy history), not NSE commodity-related equities and not MCX/CME futures months. Run npm run ingest:commodities with ALPHA_VANTAGE_API_KEY.';
    case 'MCX_FUTURES_ALL':
      return 'MCX_FUTURES_ALL requires an approved machine-readable delayed feed. A public delayed webpage is not a production API — do not scrape. MarketData/Historical remain UNAVAILABLE until that feed is verified.';
    case 'CME_FUTURES_ALL':
      return 'CME_FUTURES_ALL requires an approved machine-readable delayed/reference source. CME website quotes are reference-only and are not a licensed production feed. Do not scrape.';
    case 'FUTURES_ALL':
      return 'FUTURES_ALL is unsupported. Use CRYPTO_FUTURES_ALL, MCX_FUTURES_ALL, or CME_FUTURES_ALL. A generic futures mega-list is not invented.';
    case 'US_SP500':
      return 'US_SP500 requires a versioned constituent source. Implement when that source is verified — do not invent the list.';
    case 'US_ALL':
      return 'US_ALL is NASDAQ Trader nasdaqlisted + otherlisted equities. Run npm run ingest:us (also part of npm run start:all). Do not invent tickers.';
    case 'FOREX_ALL':
      return 'FOREX_ALL is Twelve Data /forex_pairs membership. Run npm run ingest:forex with TWELVE_DATA_API_KEY. Do not invent FX pairs.';
    default:
      return `${universeId} requires an approved versioned canonical artifact.`;
  }
}

/**
 * Gated global *_ALL / US_SP500 — only when a real canonical artifact exists.
 * Never invent constituents from model knowledge or source arrays.
 */
export function resolveGatedCanonicalUniverse(universeId: CanonicalUniverseId): {
  supported: boolean;
  symbols?: string[];
  snapshot?: CanonicalUniverseSnapshot;
  reasonCode?: string;
  detail?: string;
} {
  if (universeId === 'NSE_ALL') {
    const { symbols, snapshot } = resolveNseAllMembership();
    return { supported: true, symbols, snapshot };
  }

  const resolved = normalizeCanonicalUniverseId(universeId);
  if (resolved === 'FUTURES_ALL') {
    return {
      supported: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      detail: gatedUniverseUnavailableDetail('FUTURES_ALL'),
    };
  }

  const active = loadActiveUniverseSnapshot(resolved);
  if (isPublishableUniverseSnapshot(active)) {
    const symbols = active.instruments
      .filter((i) => i.eligibilityStatus === 'ELIGIBLE')
      .map(membershipIdentity)
      .filter(Boolean);
    return { supported: true, symbols, snapshot: active };
  }

  const artifact = unsupportedArtifactPath(resolved);
  if (!existsSync(artifact)) {
    return {
      supported: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      detail: gatedUniverseUnavailableDetail(resolved),
    };
  }
  try {
    const snapshot = JSON.parse(readFileSync(artifact, 'utf8')) as CanonicalUniverseSnapshot;
    if (
      (snapshot.universeId !== resolved &&
        !(resolved === 'CRYPTO_SPOT_ALL' && snapshot.universeId === 'CRYPTO_ALL')) ||
      !isPublishableUniverseSnapshot(snapshot)
    ) {
      return {
        supported: false,
        reasonCode: 'UNIVERSE_REFRESH_FAILED',
        detail: `${universeId} artifact is not PUBLISH/COMPLETE`,
      };
    }
    const symbols = snapshot.instruments
      .filter((i) => i.eligibilityStatus === 'ELIGIBLE')
      .map(membershipIdentity)
      .filter(Boolean);
    if (symbols.length === 0) {
      return {
        supported: false,
        reasonCode: 'UNSUPPORTED_UNIVERSE',
        detail: `${universeId} artifact has zero eligible instruments`,
      };
    }
    return { supported: true, symbols, snapshot };
  } catch (err) {
    return {
      supported: false,
      reasonCode: 'UNIVERSE_REFRESH_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** MDS symbols must never define membership — compare helpers for tests/gates. */
export function assertMembershipNotFromMdsCache(
  membershipSymbols: string[],
  mdsCacheSymbols: string[],
): { ok: boolean; detail: string } {
  if (membershipSymbols.length === 0) {
    return { ok: false, detail: 'empty_membership' };
  }
  if (mdsCacheSymbols.length === 0) {
    return { ok: true, detail: 'mds_empty_membership_independent' };
  }
  const mdsSet = new Set(mdsCacheSymbols.map((s) => s.toUpperCase()));
  const identical =
    membershipSymbols.length === mdsCacheSymbols.length &&
    membershipSymbols.every((s) => mdsSet.has(s));
  if (identical) {
    return {
      ok: false,
      detail: 'membership_equals_mds_cache_forbidden',
    };
  }
  return {
    ok: true,
    detail: `membership=${membershipSymbols.length} mds=${mdsCacheSymbols.length} independent`,
  };
}
