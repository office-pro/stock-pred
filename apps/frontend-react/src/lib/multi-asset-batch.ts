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
  const byCap = new Map(coverage.map((row) => [row.capability, row]));
  const items: Array<{ label: string; capability: string }> = [
    { label: 'Market Data & Historical Prices', capability: 'marketData' },
    { label: 'Technical Indicators', capability: 'technical' },
    { label: 'Fundamental Analysis', capability: 'fundamentals' },
    { label: 'News & Sentiment', capability: 'news' },
    { label: 'Macro / Economic Factors', capability: 'macro' },
    { label: 'Derivatives Analysis (if applicable)', capability: 'derivatives' },
  ];
  return items.map((item) => {
    const row = byCap.get(item.capability);
    const capState = input.capability?.[item.capability];
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
}): MultiAssetBatchRequest {
  const request: MultiAssetBatchRequest = {
    universe: input.universe.universeId,
    analysisPeriod: input.analysisPeriod,
    analysisTimeframe: input.analysisPeriod,
    analysisResolution: input.analysisResolution ?? DEFAULT_ANALYSIS_RESOLUTION,
    predictionHorizon: input.predictionHorizon,
    mode: input.mode,
  };
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
      return 'Validating coverage...';
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
