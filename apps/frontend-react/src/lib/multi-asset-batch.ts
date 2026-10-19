import type { AnalysisWindow, InstrumentRef, UniverseCatalogEntry } from '@stockpred/shared-types';

export const ANALYSIS_PERIOD_LABELS: Record<string, string> = {
  '1W': '1 Week',
  '1M': '1 Month',
  '3M': '3 Months',
  '6M': '6 Months',
  '1Y': '1 Year',
  CUSTOM: 'Custom',
};

export const DEFAULT_ANALYSIS_PERIOD = '3M';
export const DEFAULT_PREDICTION_HORIZON = '1M';
export const DEFAULT_ANALYSIS_RESOLUTION = '1D';

export interface MultiAssetBatchRequest {
  universe: string;
  analysisTimeframe: string;
  analysisPeriod: string;
  analysisResolution: string;
  analysisWindow?: AnalysisWindow;
  predictionHorizon: string;
  mode: string;
  sector?: string;
  instruments?: InstrumentRef[];
  instrument?: InstrumentRef;
  /** MI mode — independent of execution mode. */
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  /** Absent → backend STRICT_ALL default. */
  readinessPolicy?: import('@stockpred/shared-types').ReadinessPolicy;
  /** Absent → CURRENT_MARKET (analysis-session.v1). */
  analysisSession?: import('@stockpred/shared-types').AnalysisSessionContract;
}

/** Review & Run selector — DEFAULT omits readinessPolicy from requests. */
export type ReadinessPolicyChoice = 'DEFAULT' | 'ELIGIBLE_SUBSET';

export const ELIGIBLE_SUBSET_POLICY: import('@stockpred/shared-types').ReadinessPolicy = {
  id: 'ELIGIBLE_SUBSET',
  version: 'readiness-policy.v1',
  minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
};

/** Map UI choice → request field. DEFAULT → undefined (omit). */
export function readinessPolicyFromChoice(
  choice: ReadinessPolicyChoice | undefined,
): import('@stockpred/shared-types').ReadinessPolicy | undefined {
  return choice === 'ELIGIBLE_SUBSET' ? ELIGIBLE_SUBSET_POLICY : undefined;
}

/** Review & Run — CURRENT_MARKET omits analysisSession (backend default). */
export type AnalysisSessionChoice = 'CURRENT_MARKET' | 'OFF_SESSION_ANALYSIS';

export const OFF_SESSION_ANALYSIS_CONTRACT: import('@stockpred/shared-types').AnalysisSessionContract =
  {
    id: 'OFF_SESSION_ANALYSIS',
    version: 'analysis-session.v1',
  };

/** Map UI choice → request field. CURRENT_MARKET → undefined (omit). */
export function analysisSessionFromChoice(
  choice: AnalysisSessionChoice | undefined,
): import('@stockpred/shared-types').AnalysisSessionContract | undefined {
  return choice === 'OFF_SESSION_ANALYSIS' ? OFF_SESSION_ANALYSIS_CONTRACT : undefined;
}

const INVENTORY_OUTAGE_CODES = new Set([
  'QUOTE_INVENTORY_UNAVAILABLE',
  'HISTORICAL_INVENTORY_UNAVAILABLE',
  'FUNDAMENTALS_INVENTORY_UNAVAILABLE',
]);

export function isInventoryOutageBlocker(code: string): boolean {
  return INVENTORY_OUTAGE_CODES.has(code);
}

export function humanizePreflightBlocker(code: string): string {
  switch (code) {
    case 'NO_ELIGIBLE_INSTRUMENTS':
      return 'No eligible instruments';
    case 'QUOTE_INVENTORY_UNAVAILABLE':
      return 'Quote inventory unavailable';
    case 'HISTORICAL_INVENTORY_UNAVAILABLE':
      return 'Historical inventory unavailable';
    case 'FUNDAMENTALS_INVENTORY_UNAVAILABLE':
      return 'Fundamentals inventory unavailable';
    case 'ELIGIBLE_SUBSET_BELOW_MINIMUM':
      return 'Eligible subset below minimum';
    case 'HISTORICAL_FAILURE_THRESHOLD_EXCEEDED':
      return 'Historical failure threshold exceeded';
    default:
      return code.replace(/_/g, ' ');
  }
}

/** Sort backend ineligibleByReason by count descending — no FE eligibility math. */
export function sortedIneligibleReasons(
  byReason: Record<string, number> | undefined | null,
): Array<{ reason: string; count: number }> {
  if (!byReason) return [];
  return Object.entries(byReason)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function pickDefaultAnalysisPeriod(periods: string[] | undefined): string {
  if (periods?.includes(DEFAULT_ANALYSIS_PERIOD)) return DEFAULT_ANALYSIS_PERIOD;
  return periods?.[0] ?? DEFAULT_ANALYSIS_PERIOD;
}

export function pickDefaultPredictionHorizon(horizons: Array<{ id: string }> | undefined): string {
  const ids = horizons?.map((row) => row.id) ?? [];
  if (ids.includes(DEFAULT_PREDICTION_HORIZON)) return DEFAULT_PREDICTION_HORIZON;
  return ids[0] ?? DEFAULT_PREDICTION_HORIZON;
}

export function pickDefaultAnalysisResolution(resolutions: string[] | undefined): string {
  if (resolutions?.includes(DEFAULT_ANALYSIS_RESOLUTION)) return DEFAULT_ANALYSIS_RESOLUTION;
  return resolutions?.[0] ?? DEFAULT_ANALYSIS_RESOLUTION;
}

export const ANALYSIS_RESOLUTION_LABELS: Record<string, string> = {
  '5m': '5 Minutes',
  '15m': '15 Minutes',
  '1H': '1 Hour',
  '4H': '4 Hours',
  '1D': '1D (Daily)',
};

export const WIZARD_PROGRESS_STAGES = [
  { id: 'initialize', label: 'Initialize' },
  { id: 'fetch', label: 'Fetch Data' },
  { id: 'process', label: 'Process Data' },
  { id: 'technical', label: 'Technical' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'generate', label: 'Generate' },
  { id: 'complete', label: 'Complete' },
] as const;

export type WizardStageState = 'complete' | 'active' | 'pending' | 'unavailable' | 'na';

export function wizardProgressIndex(lifecycle?: string, status?: string): number {
  if (status === 'COMPLETED' || status === 'PARTIAL') return 7;
  switch (lifecycle) {
    case 'UNIVERSE_RESOLVED':
    case 'DATA_PREPARING':
      return 0;
    case 'DATA_HYDRATING':
      return 1;
    case 'DATA_VALIDATED':
      return 2;
    case 'RUNNING_INTELLIGENCE':
    case 'RUNNING_PROFESSIONAL_TRADER':
      return 6;
    case 'FINALIZING':
      return 7;
    default:
      return status === 'RUNNING' ? 1 : 0;
  }
}

function coverageStageState(
  coverage: SnapshotCoverageRow[] | undefined,
  names: string[],
): WizardStageState {
  const row = coverage?.find((item) => names.includes(String(item.capability).toLowerCase()));
  const status = String(row?.status ?? '').toUpperCase();
  if (status === 'AVAILABLE') return 'complete';
  if (status === 'UNAVAILABLE') return 'unavailable';
  if (status === 'N/A') return 'na';
  return 'pending';
}

/** Lifecycle owns Initialize/Fetch/Process/Generate/Complete. Coverage owns Technical/Fundamentals/Sentiment. */
export function wizardStageStates(
  lifecycle?: string,
  status?: string,
  coverage?: SnapshotCoverageRow[],
): Array<{ id: string; label: string; state: WizardStageState }> {
  const pipeline: Record<string, WizardStageState> = {
    initialize: 'pending',
    fetch: 'pending',
    process: 'pending',
    generate: 'pending',
    complete: 'pending',
  };
  let active = -1;
  if (status === 'COMPLETED' || status === 'PARTIAL') {
    active = 4;
  } else if (status === 'FAILED') {
    active = 4;
  } else {
    switch (lifecycle) {
      case 'UNIVERSE_RESOLVED':
      case 'DATA_PREPARING':
        active = 0;
        break;
      case 'DATA_HYDRATING':
        active = 1;
        break;
      case 'DATA_VALIDATED':
        active = 2;
        break;
      case 'RUNNING_INTELLIGENCE':
      case 'RUNNING_PROFESSIONAL_TRADER':
        active = 3;
        break;
      case 'FINALIZING':
        active = 4;
        break;
      default:
        active = status === 'RUNNING' || status === 'PAUSED' || status === 'QUEUED' ? 1 : -1;
    }
  }
  const pipeIds = ['initialize', 'fetch', 'process', 'generate', 'complete'];
  pipeIds.forEach((id, index) => {
    if (active < 0) return;
    if (status === 'FAILED' && index === active) {
      pipeline[id] = 'unavailable';
    } else if (
      index < active ||
      ((status === 'COMPLETED' || status === 'PARTIAL') && index <= active)
    ) {
      pipeline[id] = 'complete';
    } else if (index === active) {
      pipeline[id] = 'active';
    }
  });

  return WIZARD_PROGRESS_STAGES.map((stage) => {
    if (stage.id === 'technical') {
      return { ...stage, state: coverageStageState(coverage, ['technical', 'historicalcandles']) };
    }
    if (stage.id === 'fundamentals') {
      return { ...stage, state: coverageStageState(coverage, ['fundamentals']) };
    }
    if (stage.id === 'sentiment') {
      return { ...stage, state: coverageStageState(coverage, ['news', 'sentiment']) };
    }
    return { ...stage, state: pipeline[stage.id] ?? 'pending' };
  });
}

export function formatElapsed(startedAt?: number, endedAt?: number): string {
  if (startedAt == null) return 'Not available';
  const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatTimestamp(value?: number): string {
  if (value == null) return 'Not available';
  return new Date(value).toLocaleString();
}

export interface SnapshotCoverageRow {
  capability: string;
  group?: string;
  status: string;
  eligible: number;
  available: number;
  partial: number;
  unavailable: number;
  pending?: number;
  na: number;
  coveragePct: number | null;
  reason?: string;
}

export function formatCoveragePct(coveragePct: number | null | undefined, status?: string): string {
  if (status === 'N/A' || coveragePct == null) return 'N/A';
  return `${(coveragePct * 100).toFixed(1)}%`;
}

export function coverageStatusTone(
  status?: string,
): 'success' | 'warning' | 'error' | 'default' | 'info' {
  const s = String(status ?? '').toUpperCase();
  if (
    s === 'AVAILABLE' ||
    s === 'COMPLETE' ||
    s === 'LIVE' ||
    s === 'READY' ||
    s === 'COMPLETED' ||
    s === 'APPROVE'
  ) {
    return 'success';
  }
  if (
    s === 'PARTIAL' ||
    s === 'READY_PARTIAL' ||
    s === 'DELAYED' ||
    s === 'STALE' ||
    s === 'WAIT' ||
    s === 'WATCH'
  ) {
    return 'warning';
  }
  if (s === 'PENDING') return 'info';
  if (s === 'N/A') return 'default';
  if (
    s === 'UNAVAILABLE' ||
    s === 'MISSING' ||
    s === 'FAILED' ||
    s === 'NOT_READY' ||
    s === 'NO_TRADE' ||
    s === 'REJECT'
  ) {
    return 'error';
  }
  return 'default';
}

export interface FrozenResultIdentity {
  symbol: string;
  venue?: string;
  assetClass?: string;
  sector?: string;
  recommendation?: string;
  reason?: string;
  reasonCode?: string;
  companyName?: string;
  rank?: number;
  intelligenceContext?: Record<string, unknown>;
  dataSnapshotVersion?: string;
  marketIntelligenceSnapshotId?: string;
  asOf?: string;
}

export function frozenResultIdentity(row: {
  symbol: string;
  exchange?: string;
  sector?: string;
  companyName?: string;
  rank?: number;
  instrument?: { symbol?: string; venue?: string; assetClass?: string };
  recommendation?: string;
  reason?: string;
  reasonCode?: string;
  intelligenceContext?: Record<string, unknown>;
  dataSnapshotVersion?: string;
  marketIntelligenceSnapshotId?: string;
  asOf?: string;
}): FrozenResultIdentity {
  const instrument = row.instrument;
  const symbol = instrument?.symbol ?? row.symbol;
  return {
    symbol,
    venue: instrument?.venue ?? row.exchange,
    assetClass: instrument?.assetClass,
    sector: row.sector,
    recommendation: row.recommendation,
    reason: row.reason,
    reasonCode: row.reasonCode,
    companyName: row.companyName,
    rank: row.rank,
    intelligenceContext: row.intelligenceContext,
    dataSnapshotVersion: row.dataSnapshotVersion,
    marketIntelligenceSnapshotId: row.marketIntelligenceSnapshotId,
    asOf: row.asOf,
  };
}

export function cryptoHasNseLeak(row: FrozenResultIdentity): boolean {
  const hay = `${row.symbol} ${row.venue ?? ''}`.toUpperCase();
  if (hay.includes('NSE:')) return true;
  const assetClass = String(row.assetClass ?? '').toUpperCase();
  const venue = String(row.venue ?? '').toUpperCase();
  return assetClass.startsWith('CRYPTO') && (venue === 'NSE' || venue === 'BSE');
}

export function validResultRows<T extends { quarantined?: boolean; quarantineStatus?: string }>(
  rows: T[] | undefined,
): T[] {
  return (rows ?? []).filter(
    (row) => !row.quarantined && row.quarantineStatus !== 'IDENTITY_MISMATCH',
  );
}

export interface AnalysisCheckItem {
  label: string;
  applicable: boolean;
  status?: string;
}

export function analysisChecklist(input: {
  coverage?: SnapshotCoverageRow[];
  capability?: Record<string, string>;
}): AnalysisCheckItem[] {
  const coverage = input.coverage ?? [];
  const items: Array<{ label: string; aliases: string[] }> = [
    { label: 'Market Data & Historical Prices', aliases: ['marketdata', 'quotes'] },
    {
      label: 'Technical Indicators',
      aliases: ['technical', 'historicalcandles', 'historical'],
    },
    { label: 'Fundamental Analysis', aliases: ['fundamentals', 'fundamental'] },
    { label: 'News & Sentiment', aliases: ['news', 'sentiment'] },
    { label: 'Macro / Economic Factors', aliases: ['macro'] },
    { label: 'Derivatives Analysis (if applicable)', aliases: ['derivatives'] },
  ];
  return items.map((item) => {
    const row = coverageByCapability(coverage, item.aliases);
    const capState =
      input.capability?.[item.aliases[0]!] ??
      input.capability?.[item.aliases.find((a) => input.capability?.[a] != null) ?? ''];
    const status = row?.status ?? capState;
    const applicable = status != null && status !== 'N/A' && status !== 'UNAVAILABLE';
    return { label: item.label, applicable, status };
  });
}

const DRAFT_KEY = 'multiAsset.draft';
export const ACTIVE_BATCH_STORAGE_KEY = 'multiAsset.selectedBatchId';

export interface WorkstationDraft {
  universeId: string;
  analysisPeriod: string;
  analysisResolution: string;
  horizon: string;
  mode: string;
  sector?: string;
}

export function saveWorkstationDraft(draft: WorkstationDraft): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadWorkstationDraft(): WorkstationDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkstationDraft;
  } catch {
    return null;
  }
}

export function clearWorkstationDraft(): void {
  sessionStorage.removeItem(DRAFT_KEY);
}

export function clearActiveBatchSession(): void {
  sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY);
}

export function isActiveBatchStatus(status?: string): boolean {
  return status === 'RUNNING' || status === 'QUEUED' || status === 'PAUSED';
}

export function isTerminalBatchStatus(status?: string): boolean {
  return (
    status === 'COMPLETED' || status === 'PARTIAL' || status === 'FAILED' || status === 'CANCELLED'
  );
}

/** Persist only while a run can still be recovered. Terminal ids must not reopen on /batch. */
export function persistActiveBatchId(batchId: string, status?: string): void {
  if (!batchId || isTerminalBatchStatus(status)) {
    sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY);
    return;
  }
  if (isActiveBatchStatus(status) || status == null) {
    sessionStorage.setItem(ACTIVE_BATCH_STORAGE_KEY, batchId);
  }
}

export const DEFAULT_WORKSTATION_UNIVERSE = 'NIFTY500';

export const FEATURED_PREDEFINED_CARDS: ReadonlyArray<{
  universeId: string;
  title: string;
  subtitle: string;
  placeholder?: boolean;
}> = [
  { universeId: 'NIFTY500', title: 'NSE Equity', subtitle: 'NIFTY 500' },
  { universeId: 'NSE_ALL', title: 'NSE F&O', subtitle: 'Futures & Options' },
  { universeId: 'BSE_EQUITY', title: 'BSE Equity', subtitle: 'BSE listed', placeholder: true },
  { universeId: 'US_ALL', title: 'US Equities', subtitle: 'US Stocks (All)' },
  { universeId: 'NIFTY50', title: 'Indices', subtitle: 'Index constituents' },
  { universeId: 'COMMODITY_ALL', title: 'Commodities', subtitle: 'Gold, Silver, Oil etc.' },
  { universeId: 'CRYPTO_SPOT_ALL', title: 'Crypto', subtitle: 'Top Crypto Assets' },
  { universeId: 'FOREX_ALL', title: 'Forex', subtitle: 'Major FX Pairs' },
];

export const FEATURED_UNIVERSE_IDS = FEATURED_PREDEFINED_CARDS.filter(
  (row) => !row.placeholder,
).map((row) => row.universeId);

export function statusChipColor(
  status?: string,
): 'success' | 'error' | 'warning' | 'default' | 'info' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'PARTIAL' || status === 'PAUSED') return 'warning';
  if (status === 'RUNNING' || status === 'QUEUED') return 'info';
  return 'default';
}

export function defaultCustomAnalysisWindow(now = new Date()): AnalysisWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 180);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

export function isValidAnalysisWindow(window: AnalysisWindow | undefined): boolean {
  const startDate = window?.startDate ?? '';
  const endDate = window?.endDate ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  return startDate <= endDate;
}

/** UI contract guard: predefined universes can never leak manual identity payloads. */
export function buildMultiAssetBatchRequest(input: {
  universe: UniverseCatalogEntry;
  analysisPeriod: string;
  analysisWindow?: AnalysisWindow;
  predictionHorizon: string;
  mode: string;
  sector?: string;
  analysisResolution?: string;
  instruments: InstrumentRef[];
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  readinessPolicyChoice?: ReadinessPolicyChoice;
  analysisSessionChoice?: AnalysisSessionChoice;
}): MultiAssetBatchRequest {
  const request: MultiAssetBatchRequest = {
    universe: input.universe.universeId,
    analysisPeriod: input.analysisPeriod,
    analysisTimeframe: input.analysisPeriod,
    analysisResolution: input.analysisResolution ?? DEFAULT_ANALYSIS_RESOLUTION,
    predictionHorizon: input.predictionHorizon,
    mode: input.mode,
    miMode: input.miMode ?? 'STANDARD',
  };
  const readinessPolicy = readinessPolicyFromChoice(input.readinessPolicyChoice);
  if (readinessPolicy) request.readinessPolicy = readinessPolicy;
  const analysisSession = analysisSessionFromChoice(input.analysisSessionChoice);
  if (analysisSession) request.analysisSession = analysisSession;
  if (input.analysisPeriod === 'CUSTOM') {
    if (!isValidAnalysisWindow(input.analysisWindow)) {
      throw new Error('CUSTOM analysis period requires startDate and endDate');
    }
    request.analysisWindow = {
      startDate: input.analysisWindow!.startDate,
      endDate: input.analysisWindow!.endDate,
    };
  }
  if (input.universe.kind === 'SECTOR') {
    if (!input.sector) throw new Error('SECTOR requires canonical sector snapshot');
    request.sector = input.sector;
  } else if (input.universe.kind === 'SINGLE_STOCK') {
    if (input.instruments.length !== 1) {
      throw new Error('SINGLE_STOCK requires exactly one canonical InstrumentRef');
    }
    request.instrument = input.instruments[0];
  } else if (input.universe.kind === 'CUSTOM') {
    if (input.instruments.length === 0) {
      throw new Error('CUSTOM requires canonical InstrumentRefs');
    }
    request.instruments = input.instruments;
  }
  return request;
}

export function renderUnavailable(value: unknown): string {
  return value == null || value === '' ? 'Not available' : String(value);
}

export const BACKEND_RECOMMENDATIONS = ['APPROVE', 'WAIT', 'WATCH', 'NO_TRADE', 'REJECT'] as const;

/** Backend enum only — never map APPROVE → BUY. */
export function displayRecommendation(value?: string | null): string {
  if (value == null || value === '') return 'Not available';
  const upper = String(value).toUpperCase();
  return (BACKEND_RECOMMENDATIONS as readonly string[]).includes(upper) ? upper : 'Not available';
}

export function resultNumericField(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not available';
  return String(value);
}

export function batchReadinessHeadline(coveragePct: number | null | undefined): string {
  if (coveragePct == null || !Number.isFinite(coveragePct)) return 'Not available';
  const pct = coveragePct > 1 ? coveragePct : coveragePct * 100;
  return `${pct.toFixed(1)}%`;
}

export function hasBatchReadinessDenominator(coveragePct: number | null | undefined): boolean {
  return coveragePct != null && Number.isFinite(coveragePct);
}

export function formatBatchDuration(startedAt?: number, completedAt?: number): string {
  if (startedAt == null || completedAt == null) return 'Not available';
  return formatElapsed(startedAt, completedAt);
}

export type HistoryBatchLike = {
  batchId: string;
  universe: string;
  status: string;
  analysisPeriod?: string;
  analysisResolution?: string;
  predictionHorizon?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  eligibleCount?: number;
  updatedAt: number;
};

export function pickLatestTerminalBatch<T extends HistoryBatchLike>(rows: T[]): T | undefined {
  return [...rows]
    .filter((row) => isTerminalBatchStatus(row.status))
    .sort(
      (a, b) =>
        (b.completedAt ?? b.createdAt ?? b.updatedAt) -
        (a.completedAt ?? a.createdAt ?? a.updatedAt),
    )[0];
}

/** Newest non-terminal batch for a universe (QUEUED / RUNNING / PAUSED). */
export function pickActiveBatchForUniverse<T extends HistoryBatchLike>(
  rows: T[],
  universeId: string | undefined,
): T | undefined {
  const u = String(universeId ?? '')
    .trim()
    .toUpperCase();
  if (!u) return undefined;
  return [...rows]
    .filter(
      (row) =>
        isActiveBatchStatus(row.status) &&
        String(row.universe ?? '')
          .trim()
          .toUpperCase() === u,
    )
    .sort((a, b) => (b.createdAt ?? b.updatedAt ?? 0) - (a.createdAt ?? a.updatedAt ?? 0))[0];
}

/** After a create transport failure, recover a batch that may have been persisted anyway. */
export function pickRecoverableCreatedBatch<T extends HistoryBatchLike>(
  rows: T[],
  universeId: string,
  sinceMs: number,
): T | undefined {
  const active = pickActiveBatchForUniverse(rows, universeId);
  if (!active) return undefined;
  const created = active.createdAt ?? active.updatedAt ?? 0;
  if (created < sinceMs - 5_000) return undefined;
  return active;
}

export function coverageByCapability(
  rows: SnapshotCoverageRow[] | undefined,
  names: string[],
): SnapshotCoverageRow | undefined {
  const set = new Set(names.map((name) => name.toLowerCase()));
  return (rows ?? []).find((row) => set.has(String(row.capability).toLowerCase()));
}

export type OverviewKpi = { id: string; label: string; value: string; detail: string };

export function overviewKpis(input: {
  batch?: {
    identityCounts?: { eligible?: number; valid?: number; quarantined?: number };
    dataReadinessReport?: { eligible?: number; coveragePct?: number | null };
    eligibleCount?: number;
    capabilityCoverage?: SnapshotCoverageRow[];
  };
  hasTerminalBatch: boolean;
}): OverviewKpi[] {
  if (!input.hasTerminalBatch || !input.batch) {
    return [
      { id: 'total', label: 'Total Symbols', value: 'Not available', detail: 'Not available' },
      { id: 'quotes', label: 'Quotes', value: 'Not available', detail: 'Not available' },
      { id: 'historical', label: 'Historical', value: 'Not available', detail: 'Not available' },
      { id: 'ml', label: 'ML', value: 'Not available', detail: 'Not available' },
      { id: 'sentiment', label: 'Sentiment', value: 'Not available', detail: 'Not available' },
      {
        id: 'fundamentals',
        label: 'Fundamentals',
        value: 'Not available',
        detail: 'Not available',
      },
    ];
  }
  const coverage = input.batch.capabilityCoverage ?? [];
  const total =
    input.batch.identityCounts?.eligible ??
    input.batch.dataReadinessReport?.eligible ??
    input.batch.eligibleCount;
  const cell = (id: string, label: string, row: SnapshotCoverageRow | undefined): OverviewKpi => ({
    id,
    label,
    value: row ? String(row.available) : 'Not available',
    detail: row ? formatCoveragePct(row.coveragePct, row.status) : 'Not available',
  });
  return [
    {
      id: 'total',
      label: 'Total Symbols',
      value: total == null ? 'Not available' : total.toLocaleString(),
      detail:
        input.batch.dataReadinessReport?.coveragePct != null
          ? batchReadinessHeadline(input.batch.dataReadinessReport.coveragePct)
          : 'Not available',
    },
    cell('quotes', 'Quotes', coverageByCapability(coverage, ['marketdata', 'quotes'])),
    cell(
      'historical',
      'Historical',
      coverageByCapability(coverage, ['technical', 'historicalcandles', 'historical']),
    ),
    cell('ml', 'ML', coverageByCapability(coverage, ['ml'])),
    cell('sentiment', 'Sentiment', coverageByCapability(coverage, ['news', 'sentiment'])),
    cell(
      'fundamentals',
      'Fundamentals',
      coverageByCapability(coverage, ['fundamentals', 'fundamental']),
    ),
  ];
}

export function filterHistoryRows(
  rows: HistoryBatchLike[],
  filters: {
    query: string;
    universe: string;
    status: string;
    startDate: string;
    endDate: string;
  },
): HistoryBatchLike[] {
  const q = filters.query.trim().toUpperCase();
  return rows.filter((row) => {
    if (filters.universe && row.universe !== filters.universe) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (q) {
      const hay = `${row.batchId} ${row.universe}`.toUpperCase();
      if (!hay.includes(q)) return false;
    }
    const ts = row.createdAt ?? row.startedAt ?? row.updatedAt;
    if (filters.startDate) {
      const start = Date.parse(`${filters.startDate}T00:00:00`);
      if (!Number.isNaN(start) && ts < start) return false;
    }
    if (filters.endDate) {
      const end = Date.parse(`${filters.endDate}T23:59:59`);
      if (!Number.isNaN(end) && ts > end) return false;
    }
    return true;
  });
}

export function contextNumeric(
  ctx: Record<string, unknown> | undefined,
  key: 'overallScore' | 'tradePlanExpectedR' | 'mlConfidence' | 'tradePlanConfidence',
): string {
  return resultNumericField(ctx?.[key]);
}

/** Backend lifecycle copy only — never derive READY / READY_PARTIAL / NOT_READY. */
export function lifecycleStageCopy(stage: string | undefined, eligible?: number): string {
  switch (stage) {
    case 'UNIVERSE_RESOLVED':
      return 'Resolving universe...';
    case 'DATA_PREPARING':
      return 'Preparing data...';
    case 'DATA_HYDRATING': {
      const n = Number(eligible ?? 0);
      return `Hydrating ${n.toLocaleString('en-US')} instruments...`;
    }
    case 'DATA_VALIDATED':
      return 'Snapshot validated — Market Intelligence gate waiting...';
    case 'RUNNING_INTELLIGENCE':
      return 'Data ready — starting intelligence...';
    case 'RUNNING_PROFESSIONAL_TRADER':
      return 'Running ProfessionalTrader...';
    case 'FINALIZING':
      return 'Finalizing...';
    default:
      return '';
  }
}

export type PreflightPresentationState =
  | 'NOT_EVALUATED'
  | 'LOADING'
  | 'READY'
  | 'BLOCKED'
  | 'ERROR';

/** Presentation optimization only — backend miUniverseTypeForCreate remains authoritative. */
export function isMiPreflightUniverse(universeId: string | undefined | null): boolean {
  const id = String(universeId ?? '')
    .trim()
    .toUpperCase();
  return (
    id === 'NIFTY50' ||
    id === 'NIFTY100' ||
    id === 'NIFTY200' ||
    id === 'NIFTY500' ||
    id === 'CUSTOM' ||
    id === 'NSE_ALL' ||
    id === 'NSE_EQUITY_ALL'
  );
}

export function catalogUniverseToMiTypePresentation(
  universeId: string,
): 'NIFTY50' | 'NIFTY100' | 'NIFTY200' | 'NIFTY500' | 'CUSTOM' | 'NSE_EQUITY_ALL' | null {
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
  return null;
}

function parseAnalysisPeriodToDuration(raw?: string | null): {
  value: number;
  unit: 'D' | 'W' | 'M' | 'Y';
} {
  const token = String(raw ?? '3M')
    .trim()
    .toUpperCase();
  if (token === '1W') return { value: 1, unit: 'W' };
  if (token === '1M') return { value: 1, unit: 'M' };
  if (token === '3M') return { value: 3, unit: 'M' };
  if (token === '6M') return { value: 6, unit: 'M' };
  if (token === '1Y' || token === '12M') return { value: 1, unit: 'Y' };
  const m = token.match(/^(\d+)\s*([DWMY])$/);
  if (m) return { value: Number(m[1]), unit: m[2] as 'D' | 'W' | 'M' | 'Y' };
  return { value: 3, unit: 'M' };
}

export interface WorkstationPreflightForm {
  universeId: string;
  analysisPeriod: string;
  analysisResolution: string;
  predictionHorizon: string;
  miMode?: 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  readinessPolicyChoice?: ReadinessPolicyChoice;
  analysisSessionChoice?: AnalysisSessionChoice;
  /** Exact symbols when CUSTOM / SINGLE_STOCK — presentation lock for fingerprint. */
  lockedSymbols?: string[];
  intelligence?: {
    fundamentals?: boolean;
    news?: boolean;
    sentiment?: boolean;
    corporateEvents?: boolean;
    macro?: boolean;
    social?: boolean;
  };
}

/** Map workstation form → BatchPreflightConfiguration (mirrors backend create mapping). */
export function mapWorkstationToPreflightConfig(
  form: WorkstationPreflightForm,
): import('@stockpred/shared-types').BatchPreflightConfiguration | null {
  const universeType = catalogUniverseToMiTypePresentation(form.universeId);
  if (!universeType) return null;
  const locked = (form.lockedSymbols ?? [])
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);
  const config: import('@stockpred/shared-types').BatchPreflightConfiguration = {
    universeType,
    analysisPeriod: parseAnalysisPeriodToDuration(form.analysisPeriod),
    resolution: String(form.analysisResolution ?? '1D').trim() || '1D',
    predictionHorizon: parseAnalysisPeriodToDuration(form.predictionHorizon),
    mode: form.miMode ?? 'STANDARD',
    intelligence: form.intelligence,
  };
  const readinessPolicy = readinessPolicyFromChoice(form.readinessPolicyChoice);
  if (readinessPolicy) config.readinessPolicy = readinessPolicy;
  const analysisSession = analysisSessionFromChoice(form.analysisSessionChoice);
  if (analysisSession) config.analysisSession = analysisSession;
  if (locked.length > 0) {
    config.lockedMembershipSymbols = locked;
  }
  if (universeType === 'CUSTOM') {
    config.customSymbols = locked;
  } else if (universeType === 'NSE_EQUITY_ALL' && locked.length > 0) {
    config.nseEquityAllSymbols = locked;
  }
  return config;
}

/** Stable fingerprint for Guard 1 — stale preflight must not enable Run. */
export function stableSerializePreflightConfig(
  config: import('@stockpred/shared-types').BatchPreflightConfiguration | null,
): string {
  if (!config) return '';
  return JSON.stringify({
    universeType: config.universeType,
    locked: [...(config.lockedMembershipSymbols ?? [])].sort(),
    custom: [...(config.customSymbols ?? [])].sort(),
    nseAll: [...(config.nseEquityAllSymbols ?? [])].sort(),
    analysisPeriod: config.analysisPeriod,
    resolution: config.resolution,
    predictionHorizon: config.predictionHorizon,
    mode: config.mode ?? 'STANDARD',
    intelligence: config.intelligence ?? null,
    readinessPolicy: config.readinessPolicy ?? null,
    analysisSession: config.analysisSession ?? null,
  });
}

export function computeBackendCanRun(input: {
  isMiUniverse: boolean;
  currentKey: string;
  storedKey: string | null;
  result: import('@stockpred/shared-types').CombinedBatchPreflightV2 | null | undefined;
  presentation: PreflightPresentationState;
}): boolean {
  if (!input.isMiUniverse) return true;
  if (input.presentation === 'LOADING' || input.presentation === 'ERROR') return false;
  if (!input.storedKey || input.storedKey !== input.currentKey) return false;
  const pf = input.result;
  if (!pf) return false;
  // canAnalyze mirrors canRun when venue is open; research path when closed.
  return pf.canAnalyze === true;
}

export function computeCanSubmit(input: {
  formValid: boolean;
  isMiUniverse: boolean;
  backendCanRun: boolean;
}): boolean {
  return input.formValid && (!input.isMiUniverse || input.backendCanRun);
}

export type PreflightLegRow = {
  key: string;
  label: string;
  mode: string;
  available: number;
  requiredCount: number;
  coverage: string;
  freshness: string;
  reasonCodes?: string[];
};

/** Flatten CombinedBatchPreflightV2 legs for display — no arithmetic. */
export function preflightLegsFromV2(
  pf: import('@stockpred/shared-types').CombinedBatchPreflightV2 | null | undefined,
): PreflightLegRow[] {
  if (!pf) return [];
  const leg = (
    key: string,
    label: string,
    r: import('@stockpred/shared-types').MiReadinessResult,
  ): PreflightLegRow => ({
    key,
    label,
    mode: r.mode,
    available: r.available,
    requiredCount: r.requiredCount,
    coverage: r.coverage,
    freshness: r.freshness,
    reasonCodes: r.reasonCodes,
  });
  return [
    leg('marketData', 'Market Data', pf.marketData),
    leg('historical', 'Historical Candles', pf.historical),
    leg('fundamentals', 'Fundamentals', pf.intelligence.fundamentals),
    leg('news', 'News', pf.intelligence.news),
    leg('sentiment', 'Sentiment', pf.intelligence.sentiment),
    leg('corporateEvents', 'Corporate Events', pf.intelligence.corporateEvents),
    leg('macro', 'Macro', pf.intelligence.macro),
    leg('social', 'Social', pf.intelligence.social),
  ];
}

export const COVERAGE_GROUP_LABELS: Record<string, string> = {
  data: 'Core Data',
  intelligence: 'Derived Intelligence',
  derivatives: 'Derivatives',
  execution: 'Execution',
};

export function coverageGroupLabel(group?: string): string {
  const g = String(group ?? 'data').toLowerCase();
  return COVERAGE_GROUP_LABELS[g] ?? group ?? 'Core Data';
}

/** Presentation label for capability keys — never invents counts. */
export function capabilityDisplayLabel(capability: string): string {
  const map: Record<string, string> = {
    marketData: 'Market Data',
    historicalCandles: 'Historical Candles',
    historical: 'Historical Candles',
    fundamentals: 'Fundamentals',
    news: 'News',
    sentiment: 'Sentiment',
    macro: 'Macro',
    social: 'Social',
    onchain: 'On-chain',
    technical: 'Technical',
    sector: 'Sector',
    ml: 'ML',
    catalyst: 'Catalyst',
    derivatives: 'Derivatives',
    corporateEvents: 'Corporate Events',
  };
  return map[capability] ?? capability;
}

export function formatDataAge(dataAsOf?: number | string | null): string {
  if (dataAsOf == null || dataAsOf === '') return '—';
  const ts = typeof dataAsOf === 'number' ? dataAsOf : Date.parse(String(dataAsOf));
  if (!Number.isFinite(ts)) return '—';
  const ms = Math.max(0, Date.now() - ts);
  if (ms < 60_000) return `${Math.floor(ms / 1000)} sec`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  return `${Math.floor(ms / 3_600_000)} h`;
}

/** Workflow stepper index for Batch Run wireframe (Configure→…→Generate). */
export function miWorkflowStepIndex(input: {
  hasBatch: boolean;
  lifecycle?: string;
  status?: string;
  preflightPresentation?: PreflightPresentationState;
}): number {
  if (
    input.status === 'COMPLETED' ||
    input.status === 'PARTIAL' ||
    input.lifecycle === 'FINALIZING'
  ) {
    return 4;
  }
  if (
    input.lifecycle === 'RUNNING_INTELLIGENCE' ||
    input.lifecycle === 'RUNNING_PROFESSIONAL_TRADER'
  ) {
    return 4;
  }
  if (input.lifecycle === 'DATA_VALIDATED') return 3;
  if (input.lifecycle === 'DATA_HYDRATING' || input.lifecycle === 'DATA_PREPARING') return 2;
  if (input.hasBatch) return 2;
  if (input.preflightPresentation === 'READY' || input.preflightPresentation === 'BLOCKED') {
    return 1;
  }
  return 0;
}

export const MI_WORKFLOW_STEPS = [
  { id: 'configure', label: 'Configure' },
  { id: 'preflight', label: 'Preflight' },
  { id: 'snapshot', label: 'Data Snapshot' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'generate', label: 'Generate' },
] as const;

/** Progress stages for wireframe Batch Progress panel. */
export function batchRunProgressStages(input: {
  lifecycle?: string;
  status?: string;
  coverage?: SnapshotCoverageRow[];
}): Array<{
  id: string;
  label: string;
  state: WizardStageState;
  available?: number;
  eligible?: number;
  coveragePct?: number | null;
}> {
  const lc = String(input.lifecycle ?? '');
  const st = String(input.status ?? '');
  const cov = input.coverage ?? [];
  const row = (...names: string[]) =>
    coverageByCapability(
      cov,
      names.map((n) => n.toLowerCase()),
    );

  const terminal = st === 'COMPLETED' || st === 'PARTIAL';
  const failed = st === 'FAILED' || st === 'CANCELLED';
  const runningIntel = lc === 'RUNNING_INTELLIGENCE' || lc === 'RUNNING_PROFESSIONAL_TRADER';
  const validated = lc === 'DATA_VALIDATED';
  const hydrating = lc === 'DATA_HYDRATING' || lc === 'DATA_PREPARING';
  const finalizing = lc === 'FINALIZING';

  const covState = (r: SnapshotCoverageRow | undefined): WizardStageState => {
    if (!r) return 'pending';
    const s = String(r.status).toUpperCase();
    if (s === 'AVAILABLE') return 'complete';
    if (s === 'PENDING') return runningIntel ? 'active' : 'pending';
    if (s === 'PARTIAL') return 'active';
    if (s === 'UNAVAILABLE') return 'unavailable';
    if (s === 'N/A') return 'na';
    return 'pending';
  };

  const tech = row('technical', 'historicalcandles');
  const fund = row('fundamentals');
  const news = row('news');
  const sent = row('sentiment');

  let preflight: WizardStageState = 'pending';
  let snapshot: WizardStageState = 'pending';
  let generate: WizardStageState = 'pending';
  let results: WizardStageState = 'pending';

  if (terminal || finalizing) {
    preflight = snapshot = generate = results = 'complete';
  } else if (failed) {
    generate = 'unavailable';
    results = 'unavailable';
    if (hydrating || validated || runningIntel) {
      preflight = 'complete';
      snapshot = validated || runningIntel ? 'complete' : 'active';
    }
  } else if (runningIntel) {
    preflight = 'complete';
    snapshot = 'complete';
    generate = 'active';
    results = 'pending';
  } else if (validated) {
    preflight = 'complete';
    snapshot = 'complete';
    // Generate WAITING while coverage still PENDING — never active before RUNNING_INTELLIGENCE
    generate = 'pending';
    results = 'pending';
  } else if (hydrating) {
    preflight = 'complete';
    snapshot = 'active';
  } else if (input.lifecycle || input.status === 'QUEUED' || input.status === 'RUNNING') {
    preflight = 'complete';
    snapshot = 'pending';
  }

  return [
    { id: 'preflight', label: 'Preflight', state: preflight },
    { id: 'snapshot', label: 'Data Snapshot', state: snapshot },
    {
      id: 'technical',
      label: 'Technical',
      state: terminal || runningIntel || validated ? covState(tech) || 'complete' : covState(tech),
      available: tech?.available,
      eligible: tech?.eligible,
      coveragePct: tech?.coveragePct,
    },
    {
      id: 'fundamentals',
      label: 'Fundamentals',
      state: covState(fund),
      available: fund?.available,
      eligible: fund?.eligible,
      coveragePct: fund?.coveragePct,
    },
    {
      id: 'news',
      label: 'News',
      state: covState(news),
      available: news?.available,
      eligible: news?.eligible,
      coveragePct: news?.coveragePct,
    },
    {
      id: 'sentiment',
      label: 'Sentiment',
      state: covState(sent),
      available: sent?.available,
      eligible: sent?.eligible,
      coveragePct: sent?.coveragePct,
    },
    { id: 'generate', label: 'Generate', state: generate },
    { id: 'results', label: 'Results', state: results },
  ];
}

/** Format create-batch / PREFLIGHT_BLOCKED errors for the workstation Alert. */
export function formatCreateBatchError(reason: unknown): string {
  const body = unwrapPreflightBlockedBody(reason);
  if (body) {
    const lines = ['Cannot start batch', ''];
    if (body.outcome) {
      lines.push(`Outcome: ${body.outcome}`, '');
    }
    const elig = body.combinedPreflight?.eligibility;
    if (elig) {
      lines.push(
        `Eligible ${elig.eligible} / ${elig.universeTotal}` +
          (elig.analyzedNotPromotable
            ? ` · ANALYZED_NOT_PROMOTABLE ${elig.analyzedNotPromotable}`
            : '') +
          (elig.ineligible ? ` · INELIGIBLE ${elig.ineligible}` : ''),
        '',
      );
    }
    const legs = preflightLegsFromV2(body.combinedPreflight);
    for (const leg of legs) {
      if (leg.mode === 'NOT_APPLICABLE') continue;
      lines.push(`• ${leg.label}: ${leg.available} / ${leg.requiredCount} (${leg.coverage})`);
    }
    const u = body.combinedPreflight?.universe;
    if (u) {
      lines.push(
        '',
        `Universe resolved ${u.resolved} / requested ${u.requested}` +
          (u.unresolved || u.mismatched
            ? ` · unresolved ${u.unresolved} · mismatched ${u.mismatched}`
            : ''),
      );
    }
    if (body.blockers?.length) {
      lines.push('', `Blockers: ${body.blockers.join(', ')}`);
    }
    if (body.combinedPreflight?.warnings?.length) {
      lines.push(`Warnings: ${body.combinedPreflight.warnings.join(', ')}`);
    }
    lines.push('', 'Resolve the required data issues and try again.');
    return lines.join('\n');
  }

  const data =
    reason && typeof reason === 'object' && 'data' in reason
      ? (reason as { data?: unknown }).data
      : reason;
  if (data && typeof data === 'object' && 'message' in data) {
    const msg = (data as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (reason instanceof Error) return reason.message;
  return 'Batch rejected';
}

/**
 * Format a failed combined-preflight request for the readiness panel.
 * Transport/exception failures only — a 2xx BLOCKED result is not an error.
 */
export function formatPreflightRequestError(reason: unknown): string {
  if (!reason || typeof reason !== 'object') return 'Preflight request failed';
  const err = reason as {
    status?: unknown;
    originalStatus?: unknown;
    data?: unknown;
    error?: unknown;
  };
  const detail = typeof err.error === 'string' ? err.error : undefined;

  if (err.status === 'FETCH_ERROR') {
    return `Network error — could not reach the API gateway${detail ? ` (${detail})` : ''}`;
  }
  if (err.status === 'TIMEOUT_ERROR') {
    return `Preflight request timed out${detail ? ` (${detail})` : ''}`;
  }

  const httpStatus =
    typeof err.status === 'number'
      ? err.status
      : typeof err.originalStatus === 'number'
        ? err.originalStatus
        : undefined;
  let message: string | undefined;
  const data = err.data;
  if (typeof data === 'string' && data.trim()) {
    message = data.trim().slice(0, 300);
  } else if (data && typeof data === 'object') {
    const raw = (data as { message?: unknown }).message;
    if (typeof raw === 'string') message = raw;
    else if (Array.isArray(raw)) message = raw.map(String).join('; ');
    else if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { message?: unknown }).message === 'string'
    ) {
      message = (raw as { message: string }).message;
    }
  }
  if (!message && detail) message = detail;

  if (httpStatus !== undefined) return `HTTP ${httpStatus}${message ? ` — ${message}` : ''}`;
  return message ?? 'Preflight request failed';
}

export function unwrapPreflightBlockedBody(
  reason: unknown,
): import('@stockpred/shared-types').PreflightBlockedErrorBody | null {
  const data =
    reason && typeof reason === 'object' && 'data' in reason
      ? (reason as { data?: unknown }).data
      : reason;
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (row.code === 'PREFLIGHT_BLOCKED' && row.combinedPreflight) {
    return row as unknown as import('@stockpred/shared-types').PreflightBlockedErrorBody;
  }
  if (row.message && typeof row.message === 'object') {
    const nested = row.message as Record<string, unknown>;
    if (nested.code === 'PREFLIGHT_BLOCKED' && nested.combinedPreflight) {
      return nested as unknown as import('@stockpred/shared-types').PreflightBlockedErrorBody;
    }
  }
  return null;
}
