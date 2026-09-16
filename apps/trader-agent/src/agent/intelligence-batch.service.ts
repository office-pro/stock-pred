/**
 * Intelligence Batch Controller (B1 durable jobs + B2 TI finalize enrichment).
 * Uses existing analyzeSymbol + TI fetchers + RankingContext only.
 * Never auth chain / TradePlan / fabricated ML.
 */

import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type {
  AgentAnalysis,
  CreateIntelligenceBatchRequest,
  IntelligenceBatch,
  IntelligenceBatchResults,
  IntelligenceBatchResultRow,
  StockQuote,
  TradeDecision,
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
  diagnoseMlForBatch,
  diagnoseRsForBatch,
  rollupOmitReasons,
  DEFAULT_ALL_UNIVERSE_LIMIT,
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
  readIntelligenceBatchResearchReport,
  readLatestIntelligenceBatchResearchReport,
} from './intelligence-batch-store';
import { writeFocusUniverseBatch } from './focus-universe-store';

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

  list(limit = 50): IntelligenceBatch[] {
    return listIntelligenceBatches(limit);
  }

  get(batchId: string): IntelligenceBatch {
    const batch = readIntelligenceBatch(batchId);
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
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

    let allSymbols: string[] | undefined;
    if (req.universe === 'ALL') {
      const map = await this.agent.fetchCachedQuotesMap(
        Math.min(req.allLimit ?? DEFAULT_ALL_UNIVERSE_LIMIT, 5000),
      );
      allSymbols = [...map.keys()].sort();
    }

    let sectorSymbols: string[] | undefined;
    if (req.universe === 'SECTOR') {
      if (!req.sector?.trim()) {
        throw new BadRequestException('SECTOR universe requires sector');
      }
      sectorSymbols = await this.agent.fetchSectorMembersForIntelligenceBatch(req.sector.trim());
      if (sectorSymbols.length === 0) {
        throw new BadRequestException(`No members found for sector ${req.sector.trim()}`);
      }
    }

    let symbols: string[];
    try {
      symbols = resolveIntelligenceUniverse({
        universe: req.universe,
        customSymbols: req.symbols,
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
      now,
      scanKind: req.scanKind ?? 'FULL_MARKET',
      sector: req.sector?.trim() || undefined,
      inverseDownsideThreshold: req.inverseDownsideThreshold,
      globalEventType: req.globalEventType?.trim() || undefined,
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
      };
      writeIntelligenceBatch(batch);

      const quotesMap = await this.agent.fetchCachedQuotesMap(5000);
      const concurrency = Math.max(1, this.agent.getAnalysisConcurrency());
      console.log(
        `[intelligence-batch] ${batchId} RUNNING universe=${batch.universe} symbols=${batch.symbols.length} concurrency=${concurrency}`,
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
          let quote = quotesMap.get(task.symbol);
          if (!quote) {
            const recovered = await this.agent.fetchQuoteForIntelligenceBatch(task.symbol);
            if (recovered) {
              quotesMap.set(task.symbol, recovered);
              quote = recovered;
            }
          }
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
    }> = [];

    const skippedEnrichment: Array<{ symbol: string; reason: string }> = [];
    const mlOmitReasons: string[] = [];
    const rsOmitReasons: string[] = [];

    for (const task of doneTasks) {
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

      // P0b — prefer quotesMap; on miss, single-symbol MDS fetch (Case B). Case A stays null.
      let quote = quotesMap.get(task.symbol) ?? null;
      let quoteStatus:
        | 'VALID'
        | 'MDS_UNAVAILABLE'
        | 'PRICE_ZERO'
        | 'MAP_MISS_RECOVERED'
        | undefined;
      if (!quote) {
        const recovered = await this.agent.fetchQuoteForIntelligenceBatch(task.symbol);
        if (recovered) {
          quote = recovered;
          quotesMap.set(task.symbol, recovered);
          quoteStatus = 'MAP_MISS_RECOVERED';
          console.log(
            `[IBATCH][QUOTE] batchId=${batch.batchId} symbol=${task.symbol} ` +
              `map=MISS recovered=true price=${recovered.price}`,
          );
        } else {
          quoteStatus = 'MDS_UNAVAILABLE';
          console.log(
            `[IBATCH][QUOTE] batchId=${batch.batchId} symbol=${task.symbol} ` +
              `map=MISS mds=UNAVAILABLE case=A`,
          );
        }
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

      const snap = buildIntelligenceSnapshot({
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
      });

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
        exchange: identity.exchange,
        identityStatus: identity.identityStatus,
        price: identity.price,
        sector: quote?.sector ?? batch.sector ?? undefined,
        snapshot: snap,
        portfolioFit: 'GOOD',
        analysis,
        intelligenceContext,
        presence,
        dataAsOf,
        lifecycleState,
      });
    }

    let results: IntelligenceBatchResults | null = null;
    if (rankingCandidates.length > 0) {
      const opportunityRanking = assessOpportunityRanking({
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
      });

      const dataAsOf = rankingCandidates.reduce((max, c) => {
        const v = c.dataAsOf ?? 0;
        return v > max ? v : max;
      }, 0);
      const dataStatus = classifyQuoteStatus(dataAsOf > 0 ? dataAsOf : null, generatedAt);

      const rankings: IntelligenceBatchResultRow[] = opportunityRanking.rankings.map((r) => {
        const row = rankingCandidates.find((c) => c.opportunityId === r.opportunityId);
        return {
          rank: r.rank,
          symbol: row?.symbol ?? r.symbol,
          opportunityId: r.opportunityId,
          companyName: row?.companyName,
          exchange: row?.exchange,
          identityStatus: row?.identityStatus,
          price: row?.price,
          sector: row?.sector,
          dominance: r.dominance,
          stale: r.stale,
          dataCompleteness: r.dataCompleteness,
          intelligenceContext: row?.intelligenceContext,
          dataAsOf: row?.dataAsOf,
          rankingEngineVersion: opportunityRanking.engineVersion,
          calculationVersion: opportunityRanking.calculationVersion,
          tradeHorizon: opportunityRanking.context.tradeHorizon,
          strategyTag: opportunityRanking.context.strategyTag,
        };
      });

      results = {
        schemaVersion: 'intelligence-batch-results.v1',
        batchId: batch.batchId,
        generatedAt,
        dataAsOf: dataAsOf > 0 ? dataAsOf : generatedAt,
        dataStatus,
        rankingEngineVersion: opportunityRanking.engineVersion,
        calculationVersion: opportunityRanking.calculationVersion,
        tradeHorizon: opportunityRanking.context.tradeHorizon ?? 'SWING_TRADE',
        strategyTag: opportunityRanking.context.strategyTag ?? 'BREAKOUT',
        rankings,
      };
      const resultsDoc = results;
      writeIntelligenceBatchResults(resultsDoc);

      try {
        const report = buildBatchResearchReport({
          batchId: batch.batchId,
          completedAt: generatedAt,
          universe: String(batch.universe ?? 'CUSTOM'),
          coverage: {
            total: batch.progress?.total ?? batch.tasks.length,
            processed: doneTasks.length,
            failed: failedCount,
          },
          rankings,
          dataStatus:
            (dataStatus as 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN') || 'UNKNOWN',
          dataAsOf: resultsDoc.dataAsOf,
          marketRegime: marketContextForRank?.scannerRegime ?? null,
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
