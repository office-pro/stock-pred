/**
 * Intelligence Batch Controller (B1 durable jobs + B2 TI finalize enrichment).
 * Uses existing analyzeSymbol + TI fetchers + RankingContext only.
 * Never auth chain / TradePlan / fabricated ML.
 */

import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  canonicalInstrumentExists,
  resolveGatedCanonicalUniverse,
  resolveNseAllMembership,
  type CanonicalUniverseId,
} from '@stockpred/database';
import type {
  AgentAnalysis,
  CreateIntelligenceBatchRequest,
  IntelligenceBatch,
  IntelligenceBatchResults,
  IntelligenceBatchResultRow,
  StockQuote,
  TradeDecision,
  MultiAssetReadiness,
  UniverseCatalogEntry,
  BatchDataSnapshot,
} from '@stockpred/shared-types';
import {
  assertB1ExecutableBatchRequest,
  assignFocusCandidates,
  assessOpportunityRanking,
  buildIntelligenceSnapshot,
  canCancel,
  canPause,
  canResume,
  canRetry,
  classifyQuoteStatus,
  compactIntelligenceBatchContext,
  computeProgress,
  countTiEnrichmentFromLabels,
  createIntelligenceBatchSkeleton,
  IntelligenceBatchValidationError,
  mapPool,
  markFailedTasksPending,
  materializeIntelligenceLifecycleState,
  mlSnapshotForBatch,
  buildTradePlan,
  pendingTasksForResume,
  presenceFromUsedCapabilities,
  refreshCheckpointFromTasks,
  resolveIntelligenceUniverse,
  resolveTiDataAsOf,
  rematerializeSetupFromQuote,
  resolveBatchCanonicalIdentity,
  queryIntelligenceBatchResultsPage,
  buildBatchResearchReport,
  compareBatchResearchReports,
  diagnoseMlForBatch,
  diagnoseRsForBatch,
  rollupOmitReasons,
  resolveAssetAdapter,
  resolveAdapterFromInstrumentRef,
  adapterHintFromUniverse,
  adapterHintFromInstrumentRef,
  canonicalNiftySnapshot,
  defaultAnalysisTimeframe,
  defaultAnalysisPeriod,
  defaultAnalysisResolution,
  normalizeAnalysisPeriod,
  normalizeAnalysisResolution,
  parseAnalysisWindow,
  universeRequiresManualInstruments,
  hydrateBatchDataSnapshot,
  quotesMapFromSnapshot,
  instrumentDataBySymbol,
  attachBatchInstrumentToIntelligenceSnapshot,
  bindFrozenResultIdentity,
  deriveBatchResultRecommendation,
  isValidSnapshotRow,
  quarantinedResultRow,
  cloneInstrumentRef,
} from '@stockpred/shared-utils';
import { AgentService } from './agent.service';
import {
  listIntelligenceBatches,
  readIntelligenceBatch,
  readIntelligenceBatchResults,
  recoverInterruptedBatches,
  writeIntelligenceBatch,
  writeIntelligenceBatchResults,
  writeIntelligenceBatchResearchReport,
  writeBatchDataSnapshot,
  readBatchDataSnapshot,
  readIntelligenceBatchResearchReport,
  readLatestIntelligenceBatchResearchReport,
  findPriorSameUniverseResearchReport,
} from './intelligence-batch-store';
import { writeFocusUniverseBatch } from './focus-universe-store';
import { listUniverseCatalog } from './universe-catalog';

type ControlFlags = { pauseRequested: boolean; cancelRequested: boolean };

@Injectable()
export class IntelligenceBatchService implements OnModuleInit {
  private readonly controls = new Map<string, ControlFlags>();
  private readonly activeLoops = new Set<string>();
  /** batchId → symbol → analysis (in-memory for final RankingContext pass). */
  private readonly analysisCache = new Map<string, Map<string, AgentAnalysis>>();

  constructor(private readonly agent: AgentService) {}

  onModuleInit(): void {
    try {
      const recovered = recoverInterruptedBatches();
      if (recovered.length > 0) {
        console.log(
          `[intelligence-batch] recovered ${recovered.length} interrupted batch(es) → PAUSED`,
        );
      }
    } catch (err) {
      console.warn('[intelligence-batch] recovery failed', err);
    }
  }

  async universeCatalogWithAvailability(): Promise<UniverseCatalogEntry[]> {
    const catalog = listUniverseCatalog();
    let quotes = new Map<string, StockQuote>();
    try {
      quotes = await this.agent.fetchCachedQuotesMap(5000);
    } catch {
      // Runtime availability is explicitly missing; canonical membership remains available.
    }
    return catalog.map((entry) => {
      const symbols = this.catalogSymbols(entry.universeId);
      const capability = resolveAssetAdapter(symbols[0] ?? '', entry.adapterHint).capabilities();
      if (!entry.supported || symbols.length === 0) return { ...entry, capability };
      const quoteRows = symbols.map((symbol) => quotes.get(symbol));
      const statuses = quoteRows.map((quote) => quote?.freshnessStatus ?? 'UNKNOWN');
      const live = statuses.filter((status) => status === 'LIVE').length;
      const delayed = statuses.filter((status) => status === 'DELAYED').length;
      const stale = statuses.filter((status) => status === 'STALE').length;
      const historical = statuses.filter((status) => status === 'CLOSED_MARKET').length;
      const available = quoteRows.filter(Boolean).length;
      const latest = symbols.reduce(
        (max, symbol) => Math.max(max, quotes.get(symbol)?.updatedAt ?? 0),
        0,
      );
      const coverageCount = (state: string): number | null => {
        if (state === 'UNAVAILABLE') return 0;
        if (state === 'AVAILABLE') return symbols.length;
        return null;
      };
      const dataStatus =
        available === 0
          ? 'MISSING'
          : stale > 0 || available < symbols.length
            ? 'STALE'
            : live > 0
              ? 'LIVE'
              : delayed > 0
                ? 'DELAYED'
                : 'HISTORICAL';
      return {
        ...entry,
        capability,
        universeProvider: entry.universeProvider,
        dataStatus,
        availability: {
          totalEligible: symbols.length,
          marketDataAvailable: available,
          live,
          delayed,
          stale,
          historical,
          missing: symbols.length - available,
          historicalCandlesAvailable: coverageCount(capability.historicalCandles),
          historicalAnaloguesAvailable: coverageCount(capability.historicalAnalogues),
          bullRunAvailable: coverageCount(capability.bullRun),
          dataAsOf: latest || null,
          dataStatus,
          source: 'MDS quote intersection with immutable canonical membership',
          universeProvider: entry.universeProvider,
        },
      };
    });
  }

  async universeReadiness(universe: string): Promise<MultiAssetReadiness> {
    const catalog = await this.universeCatalogWithAvailability();
    const entry = catalog.find(
      (candidate) => candidate.universeId === universe.trim().toUpperCase(),
    );
    if (!entry) throw new BadRequestException(`Unknown universe: ${universe}`);
    const available = entry.availability?.marketDataAvailable ?? 0;
    const total = entry.availability?.totalEligible ?? entry.instrumentCount ?? 0;
    const marketDataState =
      total === 0 || available === 0 ? 'UNAVAILABLE' : available < total ? 'PARTIAL' : 'AVAILABLE';
    const capability = entry.capability;
    return {
      universe: entry,
      generatedAt: Date.now(),
      dataSources: [
        {
          id: 'canonical-membership',
          label: 'Universe membership',
          capability: 'universe',
          capabilityState: entry.supported ? 'AVAILABLE' : 'UNAVAILABLE',
          dataStatus: 'UNKNOWN',
          provider: 'canonical-universe-registry',
          source: entry.membershipSource,
          authorityRole: 'PRIMARY',
          fallbackUsed: false,
          productionCertified: entry.validationStatus === 'COMPLETE',
          runtimeHealthy: entry.supported,
          reasonCode: entry.reasonCode,
          reason: entry.reason,
        },
        {
          id: 'market-data',
          label: 'Market data availability',
          capability: 'marketData',
          capabilityState: marketDataState,
          dataStatus: entry.dataStatus ?? 'UNKNOWN',
          source: entry.availability?.source,
          dataAsOf: entry.availability?.dataAsOf,
          fallbackUsed: false,
          productionCertified: false,
          runtimeHealthy: available > 0,
          reasonCode: available === 0 ? 'NO_PROVIDER' : undefined,
          reason:
            available === 0
              ? 'No real MDS records intersect the selected canonical membership.'
              : `${available} of ${total} eligible instruments have MDS records.`,
        },
        {
          id: 'historical-candles',
          label: 'Historical candles',
          capability: 'historicalCandles',
          capabilityState: capability?.historicalCandles ?? 'UNAVAILABLE',
          dataStatus: 'UNKNOWN',
          productionCertified: false,
          reason: 'Adapter capability is declared; universe-wide runtime health is not measured.',
        },
        {
          id: 'fundamentals',
          label: 'Fundamentals',
          capability: 'fundamentals',
          capabilityState: capability?.fundamentals ?? 'UNAVAILABLE',
          dataStatus: 'UNKNOWN',
          productionCertified: false,
          reason: 'Runtime coverage is reported by completed batch capability coverage.',
        },
        {
          id: 'news',
          label: 'News',
          capability: 'news',
          capabilityState: capability?.catalyst ?? 'UNAVAILABLE',
          dataStatus: 'UNKNOWN',
          productionCertified: false,
          reason: 'Runtime coverage is reported by completed batch capability coverage.',
        },
      ],
    };
  }

  private catalogSymbols(universe: IntelligenceBatch['universe']): string[] {
    if (
      universe === 'NIFTY50' ||
      universe === 'NIFTY100' ||
      universe === 'NIFTY150' ||
      universe === 'NIFTY500'
    ) {
      return canonicalNiftySnapshot(universe).symbols;
    }
    if (universe === 'NSE_ALL') {
      try {
        return resolveNseAllMembership().symbols;
      } catch {
        return [];
      }
    }
    if (
      universe === 'US_SP500' ||
      universe === 'US_ALL' ||
      universe === 'CRYPTO_ALL' ||
      universe === 'CRYPTO_SPOT_ALL' ||
      universe === 'CRYPTO_FUTURES_ALL' ||
      universe === 'COMMODITY_ALL' ||
      universe === 'FUTURES_ALL' ||
      universe === 'MCX_FUTURES_ALL' ||
      universe === 'CME_FUTURES_ALL' ||
      universe === 'FOREX_ALL'
    ) {
      return resolveGatedCanonicalUniverse(universe).symbols ?? [];
    }
    return [];
  }

  list(limit = 50): IntelligenceBatch[] {
    return listIntelligenceBatches(limit);
  }

  get(batchId: string): IntelligenceBatch {
    const batch = readIntelligenceBatch(batchId);
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    const snapshot = readBatchDataSnapshot(batchId);
    return {
      ...batch,
      capabilityCoverage: snapshot?.capabilityCoverage ?? batch.capabilityCoverage,
      identityCounts: snapshot?.identityCounts ?? batch.identityCounts,
      snapshotProvider: snapshot?.provider ?? batch.snapshotProvider,
      snapshotDataAsOf: snapshot?.dataAsOf ?? batch.snapshotDataAsOf,
    };
  }

  getResults(
    batchId: string,
    query: import('@stockpred/shared-types').IntelligenceBatchResultsQuery = {},
  ): import('@stockpred/shared-types').IntelligenceBatchResultsPage {
    const batch = this.get(batchId);
    const results = readIntelligenceBatchResults(batchId);
    if (!results) {
      throw new NotFoundException(`Results for batch ${batchId} not available yet`);
    }
    return queryIntelligenceBatchResultsPage(
      results,
      query,
      batch.progress?.stages,
      batch.progress?.diagnostics,
    );
  }

  getResearchReport(batchId: string) {
    this.get(batchId);
    const report = readIntelligenceBatchResearchReport(batchId);
    if (!report) {
      return {
        available: false as const,
        reason: 'Research report Not available for this batch yet',
        missingCapability: 'BatchResearchReport',
      };
    }
    return { available: true as const, report };
  }

  getLatestResearchReport(universe?: string) {
    const report = readLatestIntelligenceBatchResearchReport(universe);
    if (!report) {
      return {
        available: false as const,
        reason: 'No completed batch research report available',
        missingCapability: 'BatchResearchReport',
        universe: universe ?? null,
      };
    }
    return { available: true as const, report };
  }

  /**
   * KPI compare vs prior same-universe research-report (stored reports only).
   * Optional priorId; default = previous COMPLETED/PARTIAL with a report.
   */
  compareResearchReport(batchId: string, priorId?: string) {
    const currentWrap = this.getResearchReport(batchId);
    if (!currentWrap.available || !('report' in currentWrap) || !currentWrap.report) {
      return {
        available: false as const,
        reason: 'CURRENT_REPORT_MISSING',
        missingCapability: 'BatchResearchReport',
      };
    }
    const current = currentWrap.report;
    const prior = priorId?.trim()
      ? readIntelligenceBatchResearchReport(priorId.trim())
      : findPriorSameUniverseResearchReport(String(current.universe), batchId);
    if (priorId?.trim() && prior && String(prior.universe) !== String(current.universe)) {
      return {
        available: false as const,
        reason: 'NO_PRIOR_SAME_UNIVERSE',
        current: current.dashboardSummary ?? null,
        prior: null,
        deltas: { available: false, reason: 'NO_PRIOR_SAME_UNIVERSE' },
      };
    }
    const compared = compareBatchResearchReports(current, prior);
    return compared;
  }

  /**
   * Rebuild research-report from stored results + prior report (no re-rank).
   * Optional MDS sector snapshot when available.
   */
  async rebuildResearchReport(batchId: string) {
    const batch = this.get(batchId);
    if (batch.status !== 'COMPLETED' && batch.status !== 'PARTIAL') {
      throw new BadRequestException(
        `Research report rebuild requires COMPLETED or PARTIAL batch (got ${batch.status})`,
      );
    }
    const results = readIntelligenceBatchResults(batchId);
    if (!results?.rankings?.length) {
      throw new NotFoundException(
        `Results for batch ${batchId} Not available — cannot rebuild report`,
      );
    }
    const prior = findPriorSameUniverseResearchReport(String(batch.universe ?? 'CUSTOM'), batchId);
    let marketContext:
      | {
          scannerRegime?: string;
          breadthPercentAboveEma50?: number | null;
        }
      | undefined;
    try {
      marketContext = await this.agent.fetchTiMarketContextForIntelligenceBatch();
    } catch {
      marketContext = undefined;
    }
    let sectorLeadersBySector:
      | Record<string, { leaders?: string[]; laggards?: string[] }>
      | undefined;
    try {
      sectorLeadersBySector = await this.agent.fetchSectorLeadersSnapshotForIntelligenceBatch();
    } catch {
      sectorLeadersBySector = undefined;
    }
    const breadthPct = marketContext?.breadthPercentAboveEma50;
    const marketBreadth =
      breadthPct != null && Number.isFinite(breadthPct)
        ? `${breadthPct.toFixed(1)}% above EMA50`
        : null;
    const report = buildBatchResearchReport({
      batchId: batch.batchId,
      completedAt: batch.completedAt ?? batch.updatedAt ?? results.generatedAt ?? Date.now(),
      universe: String(batch.universe ?? 'CUSTOM'),
      universeVersion: batch.universeVersion,
      membershipSource: batch.membershipSource,
      adapterVersion: batch.adapterVersion,
      providerSelection: batch.providerSelection,
      analysisTimeframe: batch.analysisTimeframe,
      predictionHorizon: batch.predictionHorizon,
      sessionContext: batch.sessionContext,
      coverage: {
        total: batch.eligibleCount ?? batch.progress?.total ?? results.rankings.length,
        processed: results.rankings.length,
        failed: (batch.tasks ?? []).filter((t) => t.status === 'FAILED').length,
      },
      rankings: results.rankings,
      dataStatus:
        (results.dataStatus as 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN') || 'UNKNOWN',
      dataAsOf: results.dataAsOf,
      marketRegime: marketContext?.scannerRegime ?? null,
      marketBreadth,
      priorReport: prior,
      sectorLeadersBySector,
    });
    writeIntelligenceBatchResearchReport(report);
    return { available: true as const, report, rebuilt: true as const };
  }

  /** Sector-first presentation grouping — does not change RankingContext. */
  getResultsBySector(batchId: string) {
    const page = this.getResults(batchId, {
      page: 1,
      pageSize: 10_000,
      sort: 'rank',
      order: 'asc',
    });
    const groups = new Map<
      string,
      {
        sector: string;
        memberCount: number;
        bullCandidates: number;
        state?: string;
        rankings: typeof page.rankings;
      }
    >();
    for (const row of page.rankings) {
      const sector = String(row.sector || 'UNCLASSIFIED').toUpperCase();
      const g = groups.get(sector) ?? {
        sector,
        memberCount: 0,
        bullCandidates: 0,
        state: row.intelligenceContext?.sectorState,
        rankings: [] as typeof page.rankings,
      };
      g.memberCount += 1;
      if (
        row.intelligenceContext?.bullRunStage ||
        (row.intelligenceContext?.bullRunV2Cells?.length ?? 0) > 0
      ) {
        g.bullCandidates += 1;
      }
      if (!g.state && row.intelligenceContext?.sectorState) {
        g.state = row.intelligenceContext.sectorState;
      }
      g.rankings.push(row);
      groups.set(sector, g);
    }
    return {
      batchId,
      defaultSort: 'rank' as const,
      sectors: [...groups.values()].sort((a, b) => a.sector.localeCompare(b.sector)),
      total: page.total,
      note: 'Sector grouping is presentation-only; canonical RankingContext rank is unchanged.',
    };
  }

  async create(req: CreateIntelligenceBatchRequest): Promise<IntelligenceBatch> {
    let batchType: ReturnType<typeof assertB1ExecutableBatchRequest>['batchType'];
    let mode: ReturnType<typeof assertB1ExecutableBatchRequest>['mode'];
    try {
      ({ batchType, mode } = assertB1ExecutableBatchRequest(req));
    } catch (err) {
      if (err instanceof IntelligenceBatchValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const manualUniverse = universeRequiresManualInstruments(req.universe);
    const universeScanKind =
      req.universe === 'SECTOR'
        ? 'SECTOR'
        : req.universe === 'SINGLE_STOCK'
          ? 'SINGLE_STOCK'
          : req.universe === 'US_SP500' || req.universe === 'US_ALL' || req.universe === 'US_CUSTOM'
            ? 'US_SCAN'
            : req.universe === 'CRYPTO_ALL' ||
                req.universe === 'CRYPTO_SPOT_ALL' ||
                req.universe === 'CRYPTO_FUTURES_ALL' ||
                req.universe === 'CRYPTO_CUSTOM'
              ? 'CRYPTO_SCAN'
              : req.universe === 'COMMODITY_ALL' || req.universe === 'COMMODITIES_CUSTOM'
                ? 'COMMODITIES_SCAN'
                : req.universe === 'FUTURES_ALL' ||
                    req.universe === 'MCX_FUTURES_ALL' ||
                    req.universe === 'CME_FUTURES_ALL' ||
                    req.universe === 'FUTURES_CUSTOM'
                  ? 'FUTURES_SCAN'
                  : req.universe === 'FOREX_ALL'
                    ? 'FOREX_SCAN'
                    : req.universe === 'CUSTOM'
                      ? 'CUSTOM'
                      : 'FULL_MARKET';
    const inferredScanKind = req.scanKind ?? universeScanKind;
    const strictScanKinds = new Set([
      'SECTOR',
      'SINGLE_STOCK',
      'US_SCAN',
      'CRYPTO_SCAN',
      'COMMODITIES_SCAN',
      'FUTURES_SCAN',
      'FOREX_SCAN',
      'CUSTOM',
    ]);
    if (strictScanKinds.has(universeScanKind) && inferredScanKind !== universeScanKind) {
      throw new BadRequestException(
        `Invalid scanKind ${inferredScanKind} for ${req.universe}; expected ${universeScanKind}`,
      );
    }
    const requestedInstruments = [
      ...(req.instruments ?? []),
      ...(req.instrument ? [req.instrument] : []),
    ];
    if (!manualUniverse && ((req.symbols?.length ?? 0) > 0 || requestedInstruments.length > 0)) {
      throw new BadRequestException(
        `BATCH_UNIVERSE_RULE:${req.universe} resolves canonical membership on the backend; symbols are forbidden`,
      );
    }
    if (req.universe === 'CUSTOM' && requestedInstruments.length === 0) {
      throw new BadRequestException('CUSTOM requires canonical instruments from instrument search');
    }
    if (req.universe === 'SINGLE_STOCK' && requestedInstruments.length !== 1) {
      throw new BadRequestException('SINGLE_STOCK requires exactly one canonical instrument');
    }
    if (
      (req.universe === 'CUSTOM' || req.universe === 'SINGLE_STOCK') &&
      requestedInstruments.some((instrument) => !canonicalInstrumentExists(instrument))
    ) {
      throw new BadRequestException(
        'CONTRACT_UNRESOLVED:custom instruments must match the canonical Instrument Registry',
      );
    }
    if (req.allLimit != null) {
      throw new BadRequestException(
        'BATCH_UNIVERSE_RULE:allLimit is not accepted for canonical predefined universes',
      );
    }
    if ((req.universe === 'SECTOR' || req.scanKind === 'SECTOR') && !req.sector?.trim()) {
      throw new BadRequestException('SECTOR requires a backend-provided sector');
    }
    if (req.scanKind === 'INVERSE_SCAN' && req.inverseDownsideThreshold == null) {
      throw new BadRequestException('INVERSE_SCAN requires inverseDownsideThreshold');
    }
    if (req.scanKind === 'GLOBAL_EVENT_SCAN' && !req.globalEventType?.trim()) {
      throw new BadRequestException('GLOBAL_EVENT_SCAN requires globalEventType');
    }
    const requestedPeriod = normalizeAnalysisPeriod(
      req.analysisPeriod ?? req.analysisTimeframe ?? defaultAnalysisPeriod(),
    );
    const requestedResolution = normalizeAnalysisResolution(
      req.analysisResolution ?? defaultAnalysisResolution(),
    );
    let analysisWindow = req.analysisWindow;
    if (requestedPeriod === 'CUSTOM') {
      try {
        analysisWindow = parseAnalysisWindow(req.analysisWindow);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : String(error));
      }
    } else {
      analysisWindow = undefined;
    }
    const requestedTimeframe = requestedPeriod;
    const requestedHorizon = req.predictionHorizon ?? '1M';
    const createHint = requestedInstruments[0]
      ? adapterHintFromInstrumentRef(requestedInstruments[0])
      : adapterHintFromUniverse(req.universe);
    if (createHint) {
      try {
        resolveAssetAdapter(requestedInstruments[0]?.symbol ?? '', createHint).resolveHorizon(
          requestedHorizon,
        );
      } catch {
        throw new BadRequestException(
          `Unsupported predictionHorizon ${requestedHorizon} for ${req.universe}`,
        );
      }
    }

    let allSymbols: string[] | undefined;
    let universeVersion: string | undefined;
    let membershipSource: string | undefined;
    let eligibleCount: number | undefined;
    let sourceCount: number | undefined;

    if (req.universe === 'ALL' || req.universe === 'NSE_ALL') {
      // Canonical Universe Registry (equity-master / NSE listings) — NEVER MDS cache.
      try {
        const { symbols: membership, snapshot } = resolveNseAllMembership();
        allSymbols = membership;
        universeVersion = snapshot.version;
        membershipSource = snapshot.source;
        eligibleCount = snapshot.eligibleRecordCount;
        sourceCount = snapshot.sourceCount;
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error
            ? err.message
            : 'NSE_ALL canonical membership unavailable — run npm run ingest:listings',
        );
      }
    }

    if (
      req.universe === 'NIFTY50' ||
      req.universe === 'NIFTY100' ||
      req.universe === 'NIFTY150' ||
      req.universe === 'NIFTY500'
    ) {
      const snapshot = canonicalNiftySnapshot(req.universe);
      universeVersion = snapshot.version;
      membershipSource = snapshot.membershipSource;
      eligibleCount = snapshot.symbols.length;
      sourceCount = snapshot.symbols.length;
    }

    const gatedId = req.universe as CanonicalUniverseId;
    if (
      req.universe === 'US_SP500' ||
      req.universe === 'US_ALL' ||
      req.universe === 'CRYPTO_ALL' ||
      req.universe === 'CRYPTO_SPOT_ALL' ||
      req.universe === 'CRYPTO_FUTURES_ALL' ||
      req.universe === 'COMMODITY_ALL' ||
      req.universe === 'FUTURES_ALL' ||
      req.universe === 'MCX_FUTURES_ALL' ||
      req.universe === 'CME_FUTURES_ALL' ||
      req.universe === 'FOREX_ALL'
    ) {
      const gated = resolveGatedCanonicalUniverse(gatedId);
      if (!gated.supported || !gated.symbols?.length) {
        throw new BadRequestException(gated.detail ?? `UNSUPPORTED_UNIVERSE:${req.universe}`);
      }
      allSymbols = gated.symbols;
      universeVersion = gated.snapshot?.version;
      membershipSource = gated.snapshot?.source;
      eligibleCount = gated.snapshot?.eligibleRecordCount;
      sourceCount = gated.snapshot?.sourceCount;
    }

    let sectorSymbols: string[] | undefined;
    if (req.universe === 'SECTOR') {
      if (!req.sector?.trim()) {
        throw new BadRequestException('SECTOR universe requires sector');
      }
      const sectorSnapshot = await this.agent.fetchSectorSnapshotForIntelligenceBatch(
        req.sector.trim(),
      );
      sectorSymbols = sectorSnapshot?.symbols;
      if (!sectorSnapshot || sectorSnapshot.symbols.length === 0) {
        throw new BadRequestException(`No members found for sector ${req.sector.trim()}`);
      }
      universeVersion = sectorSnapshot.sectorVersion;
      membershipSource = sectorSnapshot.source;
      eligibleCount = sectorSnapshot.symbols.length;
      sourceCount = sectorSnapshot.symbols.length;
    }

    let symbols: string[];
    try {
      symbols = resolveIntelligenceUniverse({
        universe: req.universe,
        customSymbols:
          requestedInstruments.length > 0
            ? requestedInstruments.map((instrument) => instrument.symbol)
            : req.symbols,
        allSymbols,
        allLimit: req.allLimit,
        sectorSymbols,
      });
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    if (symbols.length === 0) {
      throw new BadRequestException('Resolved universe is empty');
    }

    const now = Date.now();
    const batchId = `IBATCH-${now}`;
    const batch = createIntelligenceBatchSkeleton({
      batchId,
      universe: req.universe,
      batchType,
      mode,
      symbols,
      instrumentSet:
        requestedInstruments.length > 0
          ? requestedInstruments.map((instrument) => ({ ...instrument }))
          : symbols.map((symbol) => {
              const hint = adapterHintFromUniverse(req.universe);
              if (!hint) {
                throw new BadRequestException(
                  `No adapter mapping for universe ${req.universe}; frozen InstrumentRef required`,
                );
              }
              return resolveAssetAdapter(symbol, hint).resolveInstrument(symbol);
            }),
      now,
      scanKind: inferredScanKind,
      sector: req.sector?.trim() || undefined,
      inverseDownsideThreshold: req.inverseDownsideThreshold,
      globalEventType: req.globalEventType?.trim() || undefined,
      universeVersion,
      membershipSource,
      eligibleCount: eligibleCount ?? symbols.length,
      sourceCount,
      adapterVersion: 'asset-adapter.v1',
      providerSelection: membershipSource ? 'canonical-universe-registry' : undefined,
      analysisTimeframe: requestedTimeframe,
      analysisPeriod: requestedPeriod,
      analysisResolution: requestedResolution,
      analysisWindow,
      predictionHorizon: requestedHorizon,
      sessionContext: (() => {
        const sessionRef = requestedInstruments[0];
        const sessionHint = sessionRef
          ? adapterHintFromInstrumentRef(sessionRef)
          : adapterHintFromUniverse(req.universe);
        if (!sessionHint) return undefined;
        return resolveAssetAdapter(
          sessionRef?.symbol ?? symbols[0] ?? '',
          sessionHint,
        ).temporalContext(now).sessionContextId;
      })(),
    });
    batch.status = 'QUEUED';
    batch.updatedAt = now;
    writeIntelligenceBatch(batch);
    this.controls.set(batchId, { pauseRequested: false, cancelRequested: false });
    void this.runLoop(batchId);
    return batch;
  }

  pause(batchId: string): IntelligenceBatch {
    const batch = this.get(batchId);
    if (!canPause(batch.status)) {
      throw new BadRequestException(`Cannot pause batch in status ${batch.status}`);
    }
    const flags = this.controls.get(batchId) ?? { pauseRequested: false, cancelRequested: false };
    flags.pauseRequested = true;
    this.controls.set(batchId, flags);
    if (batch.status === 'QUEUED' && !this.activeLoops.has(batchId)) {
      const next = { ...batch, status: 'PAUSED' as const, updatedAt: Date.now() };
      writeIntelligenceBatch(next);
      return next;
    }
    return batch;
  }

  resume(batchId: string): IntelligenceBatch {
    const batch = this.get(batchId);
    if (!canResume(batch.status)) {
      throw new BadRequestException(`Cannot resume batch in status ${batch.status}`);
    }
    const flags = this.controls.get(batchId) ?? { pauseRequested: false, cancelRequested: false };
    flags.pauseRequested = false;
    flags.cancelRequested = false;
    this.controls.set(batchId, flags);
    const now = Date.now();
    const next: IntelligenceBatch = {
      ...batch,
      status: 'RESUMING',
      updatedAt: now,
    };
    writeIntelligenceBatch(next);
    void this.runLoop(batchId);
    return next;
  }

  cancel(batchId: string): IntelligenceBatch {
    const batch = this.get(batchId);
    if (!canCancel(batch.status)) {
      throw new BadRequestException(`Cannot cancel batch in status ${batch.status}`);
    }
    const flags = this.controls.get(batchId) ?? { pauseRequested: false, cancelRequested: false };
    flags.cancelRequested = true;
    this.controls.set(batchId, flags);
    if (!this.activeLoops.has(batchId)) {
      const now = Date.now();
      const next: IntelligenceBatch = {
        ...batch,
        status: 'CANCELLED',
        updatedAt: now,
        completedAt: now,
        tasks: batch.tasks.map((t) =>
          t.status === 'PENDING' || t.status === 'RUNNING'
            ? { ...t, status: 'SKIPPED' as const, completedAt: now }
            : t,
        ),
      };
      next.progress = computeProgress(next.tasks);
      next.checkpoint = refreshCheckpointFromTasks(next.tasks, null, now);
      writeIntelligenceBatch(next);
      return next;
    }
    return batch;
  }

  retry(batchId: string): IntelligenceBatch {
    const batch = this.get(batchId);
    if (!canRetry(batch.status)) {
      throw new BadRequestException(`Cannot retry batch in status ${batch.status}`);
    }
    const flags = this.controls.get(batchId) ?? { pauseRequested: false, cancelRequested: false };
    flags.pauseRequested = false;
    flags.cancelRequested = false;
    this.controls.set(batchId, flags);
    const now = Date.now();
    const tasks = markFailedTasksPending(batch.tasks);
    const next: IntelligenceBatch = {
      ...batch,
      status: 'RESUMING',
      updatedAt: now,
      completedAt: undefined,
      error: undefined,
      tasks,
      progress: computeProgress(tasks),
      checkpoint: refreshCheckpointFromTasks(tasks, null, now),
    };
    writeIntelligenceBatch(next);
    void this.runLoop(batchId);
    return next;
  }

  private async runLoop(batchId: string): Promise<void> {
    if (this.activeLoops.has(batchId)) return;
    this.activeLoops.add(batchId);
    try {
      let batch = this.get(batchId);
      const now = Date.now();
      batch = {
        ...batch,
        status: 'RUNNING',
        startedAt: batch.startedAt ?? now,
        updatedAt: now,
        lifecycleStage: 'DATA_PREPARING',
      };
      writeIntelligenceBatch(batch);

      const snapshot = await this.prepareBatchDataSnapshot(batch);
      batch = this.get(batchId);
      if (snapshot.coverage.readiness === 'NOT_READY') {
        const failedAt = Date.now();
        writeIntelligenceBatch({
          ...batch,
          status: 'FAILED',
          dataReadiness: 'NOT_READY',
          dataReadinessReport: snapshot.coverage,
          lifecycleStage: 'DATA_VALIDATED',
          error: snapshot.coverage.reasons.join('; ') || 'NOT_READY',
          updatedAt: failedAt,
          completedAt: failedAt,
        });
        return;
      }

      const quotesMap = quotesMapFromSnapshot(snapshot);
      const bySymbol = instrumentDataBySymbol(snapshot);
      const skipAt = Date.now();
      const tasks = batch.tasks.map((t) => {
        const row = bySymbol.get(t.symbol);
        if (t.status !== 'PENDING') return t;
        if (!row || !isValidSnapshotRow(row)) {
          const bind = bindFrozenResultIdentity({
            frozen: row,
            universeId: batch.universe,
            taskSymbol: t.symbol,
          });
          return {
            ...t,
            status: 'SKIPPED' as const,
            completedAt: skipAt,
            error: bind.reasonCode ?? 'IDENTITY_MISMATCH',
          };
        }
        if (row.dataStatus === 'UNAVAILABLE' || row.dataStatus === 'FAILED') {
          return {
            ...t,
            status: 'SKIPPED' as const,
            completedAt: skipAt,
            error: row.reasonCode ?? row.message,
          };
        }
        return t;
      });
      batch = {
        ...this.get(batchId),
        tasks,
        progress: computeProgress(tasks),
        lifecycleStage: 'RUNNING_INTELLIGENCE',
        dataReadiness: snapshot.coverage.readiness,
        dataReadinessReport: snapshot.coverage,
        dataSnapshotVersion: snapshot.dataSnapshotVersion,
        updatedAt: skipAt,
      };
      writeIntelligenceBatch(batch);

      const concurrency = Math.max(1, this.agent.getAnalysisConcurrency());
      console.log(
        `[intelligence-batch] ${batchId} RUNNING universe=${batch.universe} symbols=${batch.symbols.length} concurrency=${concurrency} readiness=${snapshot.coverage.readiness}`,
      );

      while (true) {
        const flags = this.controls.get(batchId) ?? {
          pauseRequested: false,
          cancelRequested: false,
        };
        batch = this.get(batchId);

        if (flags.cancelRequested) {
          console.log(`[intelligence-batch] ${batchId} cancel requested`);
          this.finalizeCancel(batch);
          return;
        }
        if (flags.pauseRequested) {
          console.log(`[intelligence-batch] ${batchId} pause requested`);
          this.finalizePause(batch);
          return;
        }

        const pending = pendingTasksForResume(batch.tasks).filter((t) => t.status === 'PENDING');
        if (pending.length === 0) {
          console.log(
            `[intelligence-batch] ${batchId} all symbols analyzed → finalize (TI/ML/TradePlan/Ranking)`,
          );
          await this.finalizeComplete(batch, quotesMap);
          console.log(`[intelligence-batch] ${batchId} COMPLETE`);
          return;
        }

        const wave = pending.slice(0, concurrency);
        const doneCount = batch.tasks.filter((t) => t.status === 'DONE').length;
        console.log(
          `[intelligence-batch] ${batchId} wave analyzing [${wave.map((t) => t.symbol).join(', ')}] ` +
            `(${doneCount}/${batch.tasks.length} done, ${pending.length} pending)`,
        );
        await mapPool(wave, concurrency, async (task) => {
          const latestFlags = this.controls.get(batchId);
          if (latestFlags?.cancelRequested || latestFlags?.pauseRequested) {
            return;
          }
          const quote = quotesMap.get(task.symbol);
          await this.processOneSymbol(batchId, task.symbol, quote);
        });
      }
    } catch (err) {
      try {
        const batch = readIntelligenceBatch(batchId);
        if (batch && batch.status === 'RUNNING') {
          const now = Date.now();
          writeIntelligenceBatch({
            ...batch,
            status: 'FAILED',
            error: err instanceof Error ? err.message : String(err),
            updatedAt: now,
            completedAt: now,
            progress: computeProgress(batch.tasks),
            checkpoint: refreshCheckpointFromTasks(batch.tasks, null, now),
          });
        }
      } catch {
        /* ignore */
      }
    } finally {
      this.activeLoops.delete(batchId);
    }
  }

  private async prepareBatchDataSnapshot(batch: IntelligenceBatch): Promise<BatchDataSnapshot> {
    writeIntelligenceBatch({
      ...batch,
      lifecycleStage: 'DATA_HYDRATING',
      updatedAt: Date.now(),
    });

    const nseHint = adapterHintFromUniverse(batch.universe);
    let mdsQuotes = new Map<string, StockQuote>();
    if (nseHint === 'NSE_EQUITY' || nseHint === 'BSE_EQUITY') {
      try {
        mdsQuotes = await this.agent.fetchCachedQuotesMap(5000);
      } catch {
        /* NSE hydrate without MDS cache */
      }
    }

    const instruments =
      batch.instrumentSet && batch.instrumentSet.length > 0
        ? batch.instrumentSet
        : batch.symbols.map((symbol) => {
            const hint = adapterHintFromUniverse(batch.universe);
            if (!hint) {
              throw new Error(
                `No adapter mapping for universe ${batch.universe}; frozen InstrumentRef required`,
              );
            }
            return resolveAssetAdapter(symbol, hint).resolveInstrument(symbol);
          });

    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: batch.batchId,
      universeId: batch.universe,
      universeVersion: batch.universeVersion,
      instruments,
      eligible: batch.eligibleCount ?? instruments.length,
      deps: {
        fetchNseQuote: async (symbol) => mdsQuotes.get(symbol) ?? null,
      },
    });
    writeBatchDataSnapshot(snapshot);
    writeIntelligenceBatch({
      ...this.get(batch.batchId),
      lifecycleStage: 'DATA_VALIDATED',
      dataSnapshotVersion: snapshot.dataSnapshotVersion,
      dataReadiness: report.readiness,
      dataReadinessReport: report,
      providerSelection: snapshot.provider,
      updatedAt: Date.now(),
    });
    return snapshot;
  }

  private async processOneSymbol(
    batchId: string,
    symbol: string,
    quote: StockQuote | undefined,
  ): Promise<void> {
    const startedAt = Date.now();
    let batch = this.get(batchId);
    batch = {
      ...batch,
      tasks: batch.tasks.map((t) =>
        t.symbol === symbol
          ? {
              ...t,
              status: 'RUNNING' as const,
              startedAt,
              lifecycleState: 'INTELLIGENCE_ANALYSIS' as const,
            }
          : t,
      ),
      checkpoint: refreshCheckpointFromTasks(batch.tasks, symbol, startedAt),
      updatedAt: startedAt,
    };
    writeIntelligenceBatch(batch);
    console.log(`[intelligence-batch] ${batchId} → analyzing ${symbol}`);

    try {
      const analysis = await this.agent.analyzeForIntelligenceBatch(symbol, quote);
      analysis.symbol = symbol;
      const cache = this.analysisCache.get(batchId) ?? new Map<string, AgentAnalysis>();
      cache.set(symbol, analysis);
      this.analysisCache.set(batchId, cache);
      const completedAt = Date.now();
      const opportunityId = `ibatch-${batchId}-${symbol}`;
      batch = this.get(batchId);
      batch = {
        ...batch,
        tasks: batch.tasks.map((t) =>
          t.symbol === symbol
            ? {
                ...t,
                status: 'DONE' as const,
                completedAt,
                opportunityId,
                lifecycleState: 'SHORTLIST' as const,
                intelligenceContext: {
                  thesis: analysis.thesis,
                  decision: analysis.decision,
                  overallScore: analysis.scores.overall,
                },
                dataAsOf: quote?.updatedAt ?? analysis.generatedAt,
              }
            : t,
        ),
      };
      batch.progress = computeProgress(batch.tasks);
      batch.checkpoint = refreshCheckpointFromTasks(batch.tasks, null, completedAt);
      batch.updatedAt = completedAt;
      writeIntelligenceBatch(batch);
      console.log(
        `[intelligence-batch] ${batchId} ✓ ${symbol} DONE overall=${analysis.scores.overall} ` +
          `(${batch.progress.processed}/${batch.progress.total})`,
      );
    } catch (err) {
      const completedAt = Date.now();
      batch = this.get(batchId);
      batch = {
        ...batch,
        tasks: batch.tasks.map((t) =>
          t.symbol === symbol
            ? {
                ...t,
                status: 'FAILED' as const,
                completedAt,
                error: err instanceof Error ? err.message : String(err),
              }
            : t,
        ),
      };
      batch.progress = computeProgress(batch.tasks);
      batch.checkpoint = refreshCheckpointFromTasks(batch.tasks, null, completedAt);
      batch.updatedAt = completedAt;
      writeIntelligenceBatch(batch);
      console.warn(
        `[intelligence-batch] ${batchId} ✗ ${symbol} FAILED: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private finalizePause(batch: IntelligenceBatch): void {
    const now = Date.now();
    const tasks = batch.tasks.map((t) =>
      t.status === 'RUNNING' ? { ...t, status: 'PENDING' as const, startedAt: undefined } : t,
    );
    writeIntelligenceBatch({
      ...batch,
      status: 'PAUSED',
      updatedAt: now,
      tasks,
      progress: computeProgress(tasks),
      checkpoint: refreshCheckpointFromTasks(tasks, null, now),
    });
  }

  private finalizeCancel(batch: IntelligenceBatch): void {
    const now = Date.now();
    const tasks = batch.tasks.map((t) =>
      t.status === 'PENDING' || t.status === 'RUNNING'
        ? { ...t, status: 'SKIPPED' as const, completedAt: now }
        : t,
    );
    writeIntelligenceBatch({
      ...batch,
      status: 'CANCELLED',
      updatedAt: now,
      completedAt: now,
      tasks,
      progress: computeProgress(tasks),
      checkpoint: refreshCheckpointFromTasks(tasks, null, now),
    });
  }

  /**
   * Rank completed cohort with RankingContext + B2/B3/B4 enrichment (finalize-only).
   * No evaluateTrade / Risk / Portfolio / Policy / Gate. No B4 ranking keys.
   * Exit advisory omitted without real position (never fabricate HOLD).
   */
  private async finalizeComplete(
    batch: IntelligenceBatch,
    quotesMap: Map<string, StockQuote>,
  ): Promise<void> {
    const doneTasks = batch.tasks.filter((t) => t.status === 'DONE');
    const failedCount = batch.tasks.filter((t) => t.status === 'FAILED').length;
    const generatedAt = Date.now();
    const cache = this.analysisCache.get(batch.batchId) ?? new Map<string, AgentAnalysis>();
    const frozenSnapshot = readBatchDataSnapshot(batch.batchId);
    const frozenBySymbol = frozenSnapshot ? instrumentDataBySymbol(frozenSnapshot) : new Map();

    writeIntelligenceBatch({
      ...this.get(batch.batchId),
      lifecycleStage: 'RUNNING_PROFESSIONAL_TRADER',
      updatedAt: generatedAt,
    });

    // Ensure MDS prediction cache is refreshed before per-symbol ML fetch (usable-only).
    try {
      const refresh = await this.agent.refreshMlPredictionsForIntelligenceBatch();
      console.log(
        `[intelligence-batch] ${batch.batchId} ML cache refresh loaded=${refresh.loaded} ` +
          `bridgeUsable=${refresh.bridge?.usable ?? 0}/${refresh.bridge?.total ?? 0}`,
      );
    } catch (err) {
      console.warn(
        `[intelligence-batch] ${batch.batchId} ML cache refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const marketContextForRank = await this.agent.fetchTiMarketContextForIntelligenceBatch();

    const rankingCandidates: Array<{
      opportunityId: string;
      symbol: string;
      companyName?: string;
      exchange?: string;
      identityStatus?: import('@stockpred/shared-types').BatchIdentityStatus;
      price?: number;
      sector?: string;
      snapshot: ReturnType<typeof buildIntelligenceSnapshot>;
      portfolioFit: 'GOOD';
      analysis: AgentAnalysis;
      intelligenceContext: ReturnType<typeof compactIntelligenceBatchContext>;
      presence: ReturnType<typeof presenceFromUsedCapabilities>;
      dataAsOf?: number;
      lifecycleState?: import('@stockpred/shared-types').IntelligenceLifecycleState;
      instrument?: import('@stockpred/shared-types').InstrumentRef;
      membershipIdentity?: string;
      recommendation?: import('@stockpred/shared-types').BatchResultRecommendation;
      reasonCode?: string;
      reason?: string;
    }> = [];

    const skippedEnrichment: Array<{ symbol: string; reason: string }> = [];
    const mlOmitReasons: string[] = [];
    const rsOmitReasons: string[] = [];
    const quarantinedRows: IntelligenceBatchResultRow[] = [];

    for (const task of doneTasks) {
      const frozenRow = frozenBySymbol.get(task.symbol);
      const bind = bindFrozenResultIdentity({
        frozen: frozenRow,
        universeId: String(batch.universe ?? ''),
        taskSymbol: task.symbol,
      });
      if (!bind.ok) {
        quarantinedRows.push(
          quarantinedResultRow({
            symbol: task.symbol,
            frozen: frozenRow,
            bind,
          }),
        );
        continue;
      }

      let analysis = cache.get(task.symbol);
      if (!analysis) {
        const quote = quotesMap.get(task.symbol);
        try {
          analysis = await this.agent.analyzeForIntelligenceBatch(task.symbol, quote);
          cache.set(task.symbol, analysis);
        } catch (err) {
          skippedEnrichment.push({
            symbol: task.symbol,
            reason: err instanceof Error ? err.message : String(err),
          });
          console.warn(
            `[intelligence-batch] ${batch.batchId} enrich-skip ${task.symbol}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
      }

      // Quotes come only from frozen BatchDataSnapshot — never MDS after freeze.
      const quote = quotesMap.get(task.symbol) ?? null;
      let quoteStatus:
        | 'VALID'
        | 'MDS_UNAVAILABLE'
        | 'PRICE_ZERO'
        | 'MAP_MISS_RECOVERED'
        | undefined;
      if (!quote) {
        quoteStatus = 'MDS_UNAVAILABLE';
        console.log(
          `[IBATCH][QUOTE] batchId=${batch.batchId} symbol=${task.symbol} ` +
            `snapshot=MISS case=A`,
        );
      } else if (!(quote.price > 0)) {
        quoteStatus = 'PRICE_ZERO';
      } else {
        quoteStatus = 'VALID';
      }

      const [ti, catalyst, mlFetch, b9b17] = await Promise.all([
        this.agent.fetchTiInputsForIntelligenceBatch(
          task.symbol,
          analysis.setup?.expectedHoldingPeriod,
        ),
        this.agent.fetchTiCatalystForIntelligenceBatch(task.symbol),
        this.agent.fetchTiMlPredictionForIntelligenceBatch(task.symbol),
        this.agent.fetchB9B17AdvisoryForIntelligenceBatch(task.symbol, {
          sector: batch.sector ?? quote?.sector ?? null,
          globalEventType: batch.globalEventType ?? null,
        }),
      ]);
      const mlPrediction = mlFetch.prediction;
      const mlDiag = diagnoseMlForBatch({
        called: true,
        prediction: mlPrediction,
        fetchError: mlFetch.fetchError,
      });
      let mlOmit: string;
      if (mlFetch.fetchError) {
        mlOmit = 'FETCH_ERROR';
      } else if (!mlFetch.rawPresent) {
        mlOmit = 'NO_RESPONSE';
      } else if (!mlPrediction) {
        mlOmit = mlFetch.omitReason ?? 'NO_MODEL_VERSION';
      } else {
        mlOmit = mlDiag.omitReason;
      }
      mlOmitReasons.push(mlOmit);
      if (task.symbol === 'TCS' || task.symbol === 'RELIANCE') {
        console.log(
          `[IBATCH][ML] batchId=${batch.batchId} symbol=${task.symbol} requested=true ` +
            `providerResponse=${mlFetch.rawPresent} usable=${mlOmit === 'COMPACTED'} ` +
            `modelVersion=${mlDiag.modelVersion ?? ''} featureVersion=${mlDiag.featureVersion ?? ''} ` +
            `compact=${mlOmit === 'COMPACTED'}`,
        );
        if (mlOmit !== 'COMPACTED') {
          console.log(
            `[IBATCH][ML][OMIT] batchId=${batch.batchId} symbol=${task.symbol} reason=${mlOmit}`,
          );
        }
      }
      const marketContext = marketContextForRank;

      const stubDecision: TradeDecision = {
        decisionId: task.opportunityId ?? `ibatch-${batch.batchId}-${task.symbol}`,
        symbol: task.symbol,
        intent: 'BUY',
        eligibility: 'HUMAN_ONLY',
        signalScore: analysis.scores.overall,
        confidence: analysis.setup.confidence,
        scores: analysis.scores,
        strategy: analysis.setup.instrument || 'COMPOSITE',
        marketRegime: analysis.marketRegime,
        thesis: analysis.thesis,
        counterThesis: analysis.counterThesis,
        invalidation: analysis.invalidation,
        reasons: [],
        reasonCodes: [],
        setup: {
          entry: analysis.setup.entry,
          stopLoss: analysis.setup.stopLoss,
          target1: analysis.setup.target1,
          target2: analysis.setup.target2,
          target3: analysis.setup.target3,
          riskReward: analysis.setup.riskReward,
          recommendedQty: analysis.setup.positionSize,
        },
        quoteTimestamp: analysis.generatedAt,
        createdAt: generatedAt,
        ttlMs: 30 * 60_000,
      };

      // Canonical identity + rematerialize setup from quote when analyze lacked levels.
      // `quote` already resolved (map + Case B single-symbol MDS recovery).
      analysis.symbol = task.symbol;
      analysis = rematerializeSetupFromQuote(analysis, quote);
      cache.set(task.symbol, analysis);
      const identity = resolveBatchCanonicalIdentity({
        taskSymbol: task.symbol,
        analysisSymbol: analysis.symbol,
        quote,
      });
      const mlSnap = mlSnapshotForBatch(mlPrediction);
      const dataAsOfBase = resolveTiDataAsOf([
        task.dataAsOf,
        quote?.updatedAt,
        ti.crossSectional?.asOf,
        ti.multiHorizon?.asOf,
        ti.multiHorizon?.sourceDataTimestamp,
        marketContext?.asOf,
        catalyst?.asOf,
        mlPrediction?.sourceDataTimestamp,
        mlPrediction?.predictionTimestamp,
        analysis.generatedAt,
      ]);

      const snap = attachBatchInstrumentToIntelligenceSnapshot(
        buildIntelligenceSnapshot({
          analysis,
          decision: stubDecision,
          sourceDataTimestamp: dataAsOfBase ?? analysis.generatedAt,
          marketContext,
          crossSectional: ti.crossSectional,
          multiHorizon: ti.multiHorizon,
          catalyst: catalyst
            ? {
                candidates: catalyst.candidates,
                decisionTimestamp: catalyst.decisionTimestamp,
                asOf: catalyst.asOf,
              }
            : undefined,
          mlPrediction: mlSnap ?? mlPrediction,
        }),
        frozenBySymbol.get(task.symbol),
        frozenSnapshot ?? undefined,
      );

      const structuredThesis = this.agent.buildThesisForIntelligenceBatch(
        analysis,
        snap,
        generatedAt,
      );
      const waitRec = this.agent.buildWaitForIntelligenceBatch(analysis, snap, generatedAt);
      const integrityBand = quote?.manipulation?.band ?? null;

      const tradePlan = buildTradePlan({
        now: generatedAt,
        opportunityId: stubDecision.decisionId,
        analysis,
        snapshot: snap,
        preferWait: waitRec.decision === 'WAIT' && structuredThesis.state === 'WEAKENING',
        advisoryContext: b9b17,
      });

      const dataAsOf = resolveTiDataAsOf([
        dataAsOfBase,
        structuredThesis.provenance?.sourceDataTimestamp,
        structuredThesis.provenance?.generatedAt,
        waitRec.expiryAt,
      ]);

      const baseLabels = compactIntelligenceBatchContext({
        thesis: analysis.thesis,
        decision: analysis.decision,
        overallScore: analysis.scores.overall,
        fundamentalScore: analysis.scores.fundamental,
        sentimentScore: analysis.scores.sentiment,
        macroScore: analysis.scores.macro,
        snapshot: snap,
        mlPrediction: mlPrediction,
      });

      const lifecycleState = materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: baseLabels,
        thesisState: structuredThesis.state,
      });

      const intelligenceContext = compactIntelligenceBatchContext({
        thesis: analysis.thesis,
        decision: analysis.decision,
        overallScore: analysis.scores.overall,
        fundamentalScore: analysis.scores.fundamental,
        sentimentScore: analysis.scores.sentiment,
        macroScore: analysis.scores.macro,
        snapshot: snap,
        thesisState: structuredThesis.state,
        waitState: waitRec.decision === 'WAIT' ? 'WAIT' : null,
        waitTrigger: waitRec.reevaluateWhen?.trigger,
        exitAdvisory: null,
        integrityStatus: integrityBand,
        intelligenceLifecycleState: lifecycleState,
        mlPrediction: mlPrediction,
        tradePlan,
        sectorState: b9b17.sectorState,
        bullRunStage: b9b17.bullRunStage,
        bullRunProbability3m: b9b17.bullRunProbability3m,
        bullRunV2Cells: b9b17.bullRunV2Cells,
        bullRunDataStatus: b9b17.bullRunDataStatus,
        globalEventImpact: b9b17.globalEventImpact,
        fnoStatus: b9b17.fnoStatus,
        quoteStatus,
      });

      const presence = presenceFromUsedCapabilities(
        analysis.usedCapabilities,
        {
          fundamental: analysis.scores.fundamental,
          macro: analysis.scores.macro,
        },
        {
          thesis: structuredThesis.state != null,
          wait: waitRec.decision === 'WAIT',
          exit: false,
          integrity: integrityBand != null,
          ml: intelligenceContext.mlModelVersion != null,
          professionalAnalysis: intelligenceContext.tradePlanRecommendation != null,
        },
      );

      const cs = ti.crossSectional;
      const rsDiag = diagnoseRsForBatch({
        called: true,
        fetchNull: cs == null,
        quoteRs: cs?.quoteRs ?? null,
        scannerRs: cs?.scannerRs ?? null,
        rsVsNifty50: cs?.rsVsNifty50 ?? null,
        source: snap.crossSectionalRs?.source ?? (cs?.rsVsNifty50 == null ? 'MISSING' : null),
        snapshotAttached: !!snap.crossSectionalRs,
        rsBucket: intelligenceContext.rsBucket ?? null,
        benchmarkDailyLength: cs?.benchmarkDailyLength ?? null,
      });
      rsOmitReasons.push(rsDiag.omitReason);
      if (task.symbol === 'TCS' || task.symbol === 'RELIANCE') {
        console.log(
          `[RS][RESULT] batchId=${batch.batchId} symbol=${task.symbol} ` +
            `source=${rsDiag.source ?? 'MISSING'} rsValue=${cs?.rsVsNifty50 ?? 'null'} ` +
            `rsBucket=${intelligenceContext.rsBucket ?? 'null'} omit=${rsDiag.omitReason} ` +
            `benchmarkDailyLength=${cs?.benchmarkDailyLength ?? 'null'}`,
        );
        const tp = intelligenceContext.tradePlanStatus;
        console.log(
          `[TRADEPLAN][SETUP] batchId=${batch.batchId} symbol=${task.symbol} ` +
            `tradePlanStatus=${tp ?? 'none'} ` +
            `missingFields=${JSON.stringify(intelligenceContext.tradePlanMissingFields ?? [])}`,
        );
      }

      rankingCandidates.push({
        opportunityId: stubDecision.decisionId,
        symbol: identity.symbol,
        companyName: identity.companyName,
        exchange: bind.instrument?.venue ?? identity.exchange,
        identityStatus: bind.identityStatus,
        price: identity.price,
        sector: quote?.sector ?? batch.sector ?? undefined,
        snapshot: snap,
        portfolioFit: 'GOOD',
        analysis,
        intelligenceContext,
        presence,
        dataAsOf,
        lifecycleState,
        instrument: bind.instrument ? cloneInstrumentRef(bind.instrument) : undefined,
        membershipIdentity: bind.membershipIdentity,
        ...deriveBatchResultRecommendation({
          tradePlanRecommendation: intelligenceContext.tradePlanRecommendation,
          analysisDecision: analysis.decision,
          waitState: intelligenceContext.waitState,
        }),
      });
    }

    for (const task of batch.tasks) {
      if (task.status !== 'SKIPPED') continue;
      if (
        task.error !== 'IDENTITY_MISMATCH' &&
        !String(task.error ?? '').includes('IDENTITY_MISMATCH')
      ) {
        continue;
      }
      if (quarantinedRows.some((row) => row.symbol === task.symbol)) continue;
      const frozenRow = frozenBySymbol.get(task.symbol);
      const bind = bindFrozenResultIdentity({
        frozen: frozenRow,
        universeId: String(batch.universe ?? ''),
        taskSymbol: task.symbol,
      });
      quarantinedRows.push(
        quarantinedResultRow({
          symbol: task.symbol,
          frozen: frozenRow,
          bind,
        }),
      );
    }

    let results: IntelligenceBatchResults | null = null;
    const identityCounts = {
      eligible: batch.eligibleCount ?? batch.tasks.length,
      valid: rankingCandidates.length,
      quarantined: quarantinedRows.length,
    };
    if (rankingCandidates.length > 0 || quarantinedRows.length > 0) {
      const opportunityRanking = rankingCandidates.length
        ? assessOpportunityRanking({
            context: {
              tradeHorizon: 'SWING_TRADE',
              strategyTag: 'BREAKOUT',
              timestamp: new Date(generatedAt).toISOString(),
            },
            candidates: rankingCandidates.map((c) => ({
              opportunityId: c.opportunityId,
              symbol: c.symbol,
              snapshot: c.snapshot,
              portfolioFit: c.portfolioFit,
            })),
          })
        : null;

      const dataAsOf = rankingCandidates.reduce((max, c) => {
        const v = c.dataAsOf ?? 0;
        return v > max ? v : max;
      }, 0);
      const dataStatus = classifyQuoteStatus(dataAsOf > 0 ? dataAsOf : null, generatedAt);

      const rankings: IntelligenceBatchResultRow[] = (opportunityRanking?.rankings ?? []).map(
        (r) => {
          const row = rankingCandidates.find((c) => c.opportunityId === r.opportunityId);
          const symbol = row?.symbol ?? r.symbol;
          const instrument = row?.instrument
            ? cloneInstrumentRef(row.instrument)
            : frozenBySymbol.get(symbol)?.instrumentRef
              ? cloneInstrumentRef(frozenBySymbol.get(symbol)!.instrumentRef)
              : undefined;
          const adapter = instrument ? resolveAdapterFromInstrumentRef(instrument) : null;
          const temporal = adapter?.temporalContext(generatedAt);
          const series = adapter?.normalizeSeries([]);
          return {
            rank: r.rank,
            symbol,
            opportunityId: r.opportunityId,
            companyName: row?.companyName,
            exchange: instrument?.venue ?? row?.exchange,
            identityStatus: row?.identityStatus ?? 'VALID',
            price: row?.price,
            sector: row?.sector,
            dominance: r.dominance,
            stale: r.stale,
            dataCompleteness: r.dataCompleteness,
            intelligenceContext: row?.intelligenceContext,
            dataAsOf: row?.dataAsOf,
            rankingEngineVersion: opportunityRanking?.engineVersion,
            calculationVersion: opportunityRanking?.calculationVersion,
            tradeHorizon: opportunityRanking?.context.tradeHorizon,
            strategyTag: opportunityRanking?.context.strategyTag,
            instrument,
            adapterId: adapter?.id,
            analysisTimeframe: batch.analysisTimeframe ?? defaultAnalysisTimeframe(),
            predictionHorizon: batch.predictionHorizon ?? '1M',
            sessionContext: temporal?.sessionContextId ?? batch.sessionContext,
            seriesProvenance: series?.seriesProvenance,
            membershipIdentity: row?.membershipIdentity,
            quarantined: false,
            recommendation: row?.recommendation,
            reasonCode: row?.reasonCode,
            reason: row?.reason,
            multiAssetDataStatus:
              row?.intelligenceContext?.quoteStatus === 'MDS_UNAVAILABLE'
                ? 'MISSING'
                : row?.intelligenceContext?.bullRunDataStatus === 'LIVE'
                  ? 'LIVE'
                  : row?.intelligenceContext?.bullRunDataStatus === 'STALE'
                    ? 'STALE'
                    : 'UNKNOWN',
          };
        },
      );

      results = {
        schemaVersion: 'intelligence-batch-results.v1',
        batchId: batch.batchId,
        generatedAt,
        dataAsOf: dataAsOf > 0 ? dataAsOf : generatedAt,
        dataStatus,
        rankingEngineVersion: opportunityRanking?.engineVersion ?? 'ranking-context.v1',
        calculationVersion: opportunityRanking?.calculationVersion ?? 'ranking-context.v1',
        tradeHorizon: opportunityRanking?.context.tradeHorizon ?? 'SWING_TRADE',
        strategyTag: opportunityRanking?.context.strategyTag ?? 'BREAKOUT',
        rankings,
        quarantined: quarantinedRows,
        identityCounts,
      };
      const resultsDoc = results;
      writeIntelligenceBatchResults(resultsDoc);

      try {
        const prior = findPriorSameUniverseResearchReport(
          String(batch.universe ?? 'CUSTOM'),
          batch.batchId,
        );
        const breadthPct = marketContextForRank?.breadthPercentAboveEma50;
        const marketBreadth =
          breadthPct != null && Number.isFinite(breadthPct)
            ? `${breadthPct.toFixed(1)}% above EMA50`
            : null;
        let sectorLeadersBySector:
          | Record<string, { leaders?: string[]; laggards?: string[] }>
          | undefined;
        try {
          sectorLeadersBySector = await this.agent.fetchSectorLeadersSnapshotForIntelligenceBatch();
        } catch {
          sectorLeadersBySector = undefined;
        }
        const report = buildBatchResearchReport({
          batchId: batch.batchId,
          completedAt: generatedAt,
          universe: String(batch.universe ?? 'CUSTOM'),
          universeVersion: batch.universeVersion,
          membershipSource: batch.membershipSource,
          adapterVersion: batch.adapterVersion,
          providerSelection: batch.providerSelection,
          analysisTimeframe: batch.analysisTimeframe,
          predictionHorizon: batch.predictionHorizon,
          sessionContext: batch.sessionContext,
          coverage: {
            total: batch.eligibleCount ?? batch.progress?.total ?? batch.tasks.length,
            processed: doneTasks.length,
            failed: failedCount,
          },
          rankings,
          dataStatus:
            (dataStatus as 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN') || 'UNKNOWN',
          dataAsOf: resultsDoc.dataAsOf,
          marketRegime: marketContextForRank?.scannerRegime ?? null,
          marketBreadth,
          priorReport: prior,
          sectorLeadersBySector,
          snapshotCapabilityCoverage: frozenSnapshot?.capabilityCoverage,
        });
        writeIntelligenceBatchResearchReport(report);
      } catch (err) {
        console.warn(
          `[intelligence-batch] ${batch.batchId} research-report failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const focus = assignFocusCandidates({
        batchId: `FOCUS-from-${batch.batchId}`,
        generatedAt,
        dataAsOf: resultsDoc.dataAsOf,
        source: 'EOD_CACHED',
        dataStatus: resultsDoc.dataStatus,
        universeSize: rankings.length,
        ranked: rankings.map((r) => ({
          symbol: r.symbol,
          rank: r.rank,
          opportunityId: r.opportunityId,
          rankingEngineVersion: r.rankingEngineVersion,
          calculationVersion: r.calculationVersion,
          tradeHorizon: 'SWING_TRADE' as const,
          strategyTag: r.strategyTag,
          thesis: r.intelligenceContext?.thesis,
          decision: r.intelligenceContext?.decision,
          overallScore: r.intelligenceContext?.overallScore,
          dataAsOf: r.dataAsOf ?? resultsDoc.dataAsOf,
        })),
      });
      writeFocusUniverseBatch(focus);
    }

    const tiCounts = {
      ...countTiEnrichmentFromLabels(rankingCandidates, { tiTotal: doneTasks.length }),
      exitRequiresOpenPosition: true as const,
    };
    const mlByReason = rollupOmitReasons(mlOmitReasons);
    const rsByReason = rollupOmitReasons(rsOmitReasons);
    const mlUsable = mlByReason.COMPACTED ?? 0;
    const rsUsable = rsByReason.LABELLED ?? 0;
    const diagnostics = {
      ml: {
        usable: mlUsable,
        unavailable: Math.max(0, (mlOmitReasons.length || doneTasks.length) - mlUsable),
        byReason: mlByReason,
      },
      rs: {
        usable: rsUsable,
        unavailable: Math.max(0, (rsOmitReasons.length || doneTasks.length) - rsUsable),
        byReason: rsByReason,
      },
    };
    console.log(
      `[IBATCH][ML][SUMMARY] batchId=${batch.batchId} doneTasks=${doneTasks.length} ` +
        `requested=${mlOmitReasons.length} usable=${mlUsable} omitted=${Math.max(0, mlOmitReasons.length - mlUsable)} ` +
        `byReason=${JSON.stringify(mlByReason)}`,
    );
    console.log(
      `[IBATCH][RS][SUMMARY] batchId=${batch.batchId} doneTasks=${doneTasks.length} ` +
        `usable=${rsUsable} omitted=${Math.max(0, rsOmitReasons.length - rsUsable)} ` +
        `byReason=${JSON.stringify(rsByReason)}`,
    );
    console.log(
      `[intelligence-batch] ${batch.batchId} coverage cohort ` +
        `doneTasks=${doneTasks.length} enriched=${rankingCandidates.length} ` +
        `skippedEnrichment=${skippedEnrichment.length} ` +
        `tiTotal=${tiCounts.tiTotal} ml=${tiCounts.mlDone}/${tiCounts.tiTotal} ` +
        `rs=${tiCounts.rsDone}/${tiCounts.tiTotal}`,
    );
    console.log(
      `[intelligence-batch] ${batch.batchId} mlOmitReasons=${JSON.stringify(mlByReason)} ` +
        `rsOmitReasons=${JSON.stringify(rsByReason)}`,
    );
    if (skippedEnrichment.length > 0) {
      console.warn(
        `[intelligence-batch] ${batch.batchId} skippedEnrichment sample=` +
          JSON.stringify(skippedEnrichment.slice(0, 10)),
      );
    }
    const status =
      failedCount > 0 && doneTasks.length > 0
        ? 'PARTIAL'
        : failedCount > 0
          ? 'FAILED'
          : 'COMPLETED';
    const latest = this.get(batch.batchId);
    const tasksWithContext = latest.tasks.map((t) => {
      const row = rankingCandidates.find((c) => c.symbol === t.symbol);
      if (!row || t.status !== 'DONE') return t;
      return {
        ...t,
        intelligenceContext: row.intelligenceContext,
        dataAsOf: row.dataAsOf ?? t.dataAsOf,
        lifecycleState: row.lifecycleState ?? row.intelligenceContext.intelligenceLifecycleState,
      };
    });
    const progress = computeProgress(tasksWithContext, tiCounts);
    writeIntelligenceBatch({
      ...latest,
      status,
      lifecycleStage: 'FINALIZING',
      updatedAt: generatedAt,
      completedAt: generatedAt,
      resultsArtifactId: results ? `${batch.batchId}.results` : undefined,
      tasks: tasksWithContext,
      progress: { ...progress, diagnostics },
      checkpoint: refreshCheckpointFromTasks(tasksWithContext, null, generatedAt),
      error: status === 'FAILED' ? 'All symbol tasks failed' : undefined,
    });
    this.analysisCache.delete(batch.batchId);
  }
}
