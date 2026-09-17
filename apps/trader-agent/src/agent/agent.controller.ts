import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  commodityUniverseGate,
  configuredCryptoUniverseProvider,
  fetchCryptoFuturesUniverse,
  fetchCryptoUniverse,
  loadActiveUniverseSnapshot,
  publishCanonicalUniverseSnapshot,
  publishNseAllFromEquityMaster,
  resolveGatedCanonicalUniverse,
  probeAndPublishCommodityUniverse,
  searchCanonicalInstruments,
  ingestForexAllUniverse,
} from '@stockpred/database';
import type {
  AgentAnalysis,
  AgentCapabilityRequest,
  AgentCapabilityStatus,
  AgentDecisionMode,
  AgentLiveArming,
  AgentManagedPosition,
  AgentMode,
  AgentRecommendation,
  AgentRiskBudgetConfig,
  AgentWalkForwardReport,
  AnalysisPeriod,
  AnalysisResolution,
  CreateIntelligenceBatchRequest,
  DecisionLedgerEntry,
  FocusUniverseBatch,
  PortfolioSnapshot,
} from '@stockpred/shared-types';
import { AgentService } from './agent.service';
import { ContinuousIntelligenceStore } from './continuous-intelligence-store';
import { IntelligenceBatchService } from './intelligence-batch.service';
import {
  emptyHistoricalPredictionProofNote,
  loadHistoricalPredictionProof,
  runAndPersistHistoricalPredictionProof,
} from './historical-prediction-proof-store';
import {
  createPaperExperiment,
  listPaperExperiments,
  getPaperExperiment,
  recordPaperOutcome,
  appendLearningNote,
  registerCandidateModel,
  learningTouchesRiskOrGate,
  listProviderCapabilities,
  listInstrumentAdapters,
  resolveInstrumentWithAdapter,
  adapterHintFromUniverse,
} from '@stockpred/shared-utils';
import type { InstrumentRef, LearningPhase, PaperExperimentStatus } from '@stockpred/shared-types';

/** BATCH UNIVERSE RULE — exposed on catalog API for FE/docs. */
const BATCH_UNIVERSE_RULE_NOTE =
  'A predefined universe selection must automatically resolve its complete canonical membership from the backend. Manual symbols are permitted only for CUSTOM and SINGLE_STOCK (and legacy *_CUSTOM). Missing canonical source → Not available / UNSUPPORTED_UNIVERSE — never fall back to CUSTOM, MDS cache, or hardcoded lists.';

class CreatePaperExperimentDto {
  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  adapterHint?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  predictionHorizon?: string;

  @IsOptional()
  @IsString()
  thesis?: string;

  @IsOptional()
  @IsString()
  recommendation?: string;

  @IsOptional()
  @Type(() => Number)
  probability?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class PaperOutcomeDto {
  @IsOptional()
  @Type(() => Number)
  actualReturn?: number;

  @IsOptional()
  @Type(() => Number)
  mfe?: number;

  @IsOptional()
  @Type(() => Number)
  mae?: number;

  @IsOptional()
  @IsBoolean()
  targetReached?: boolean;

  @IsOptional()
  @IsString()
  sampleNote?: string;
}

class LearningNoteDto {
  @IsIn(['MEASURE', 'CALIBRATE', 'VALIDATE'])
  phase!: LearningPhase;

  @IsString()
  note!: string;
}

class SetModeDto {
  @IsIn(['RESEARCH', 'PAPER', 'LIVE'])
  mode!: AgentMode;

  @IsOptional()
  @IsString()
  confirmLive?: string;
}

class SetDecisionModeDto {
  @IsIn(['APPROVAL', 'AUTONOMOUS'])
  decisionMode!: AgentDecisionMode;
}

class SetLiveAutoArmDto {
  @IsBoolean()
  armed!: boolean;

  /** Required when armed=true; must be exactly "ARM LIVE AUTONOMOUS". */
  @IsOptional()
  @IsString()
  confirmLiveAuto?: string;
}

class KillSwitchDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  flatten?: boolean;
}

class TradingEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

class AckCapabilityDto {
  @IsString()
  id!: string;
}

class BrokerReadyDto {
  @IsBoolean()
  configured!: boolean;

  @IsOptional()
  @IsBoolean()
  testOk?: boolean;
}

class ApproveDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

class WaitDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class RejectDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class InstrumentRefDto {
  @IsString()
  symbol!: string;

  @IsString()
  assetClass!: InstrumentRef['assetClass'];

  @IsString()
  venue!: string;

  @IsString()
  quoteCurrency!: string;

  @IsOptional()
  @IsString()
  canonicalSymbol?: string;

  @IsOptional()
  @IsString()
  underlying?: string;

  @IsOptional()
  @IsString()
  expiry?: string;

  @IsOptional()
  @IsString()
  contractMonth?: string;
}

class AnalysisWindowDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

class CreateIntelligenceBatchDto {
  @IsIn([
    'NIFTY50',
    'NIFTY100',
    'NIFTY150',
    'NIFTY500',
    'ALL',
    'NSE_ALL',
    'US_SP500',
    'US_ALL',
    'CRYPTO_ALL',
    'CRYPTO_SPOT_ALL',
    'CRYPTO_FUTURES_ALL',
    'COMMODITY_ALL',
    'FUTURES_ALL',
    'MCX_FUTURES_ALL',
    'CME_FUTURES_ALL',
    'FOREX_ALL',
    'CUSTOM',
    'SECTOR',
    'SINGLE_STOCK',
    'US_CUSTOM',
    'CRYPTO_CUSTOM',
    'COMMODITIES_CUSTOM',
    'FUTURES_CUSTOM',
  ])
  universe!:
    | 'NIFTY50'
    | 'NIFTY100'
    | 'NIFTY150'
    | 'NIFTY500'
    | 'ALL'
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
    | 'FOREX_ALL'
    | 'CUSTOM'
    | 'SECTOR'
    | 'SINGLE_STOCK'
    | 'US_CUSTOM'
    | 'CRYPTO_CUSTOM'
    | 'COMMODITIES_CUSTOM'
    | 'FUTURES_CUSTOM';

  @IsOptional()
  @IsIn(['FULL_ANALYSIS', 'LIVE_CONTINUOUS'])
  batchType?: 'FULL_ANALYSIS' | 'LIVE_CONTINUOUS';

  @IsOptional()
  @IsIn(['HISTORICAL', 'LIVE', 'HYBRID'])
  mode?: 'HISTORICAL' | 'LIVE' | 'HYBRID';

  @IsOptional()
  @IsIn([
    'FULL_MARKET',
    'SECTOR',
    'SINGLE_STOCK',
    'BULL_RUN_SCAN',
    'RELATIONSHIP_SCAN',
    'INVERSE_SCAN',
    'EVENT_ANALYSIS',
    'GLOBAL_EVENT_SCAN',
    'CUSTOM',
    'US_SCAN',
    'CRYPTO_SCAN',
    'COMMODITIES_SCAN',
    'FUTURES_SCAN',
    'FOREX_SCAN',
  ])
  scanKind?:
    | 'FULL_MARKET'
    | 'SECTOR'
    | 'SINGLE_STOCK'
    | 'BULL_RUN_SCAN'
    | 'RELATIONSHIP_SCAN'
    | 'INVERSE_SCAN'
    | 'EVENT_ANALYSIS'
    | 'GLOBAL_EVENT_SCAN'
    | 'CUSTOM'
    | 'US_SCAN'
    | 'CRYPTO_SCAN'
    | 'COMMODITIES_SCAN'
    | 'FUTURES_SCAN'
    | 'FOREX_SCAN';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbols?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstrumentRefDto)
  instruments?: InstrumentRefDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InstrumentRefDto)
  instrument?: InstrumentRefDto;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  allLimit?: number;

  @IsOptional()
  @Type(() => Number)
  inverseDownsideThreshold?: number;

  @IsOptional()
  @IsString()
  globalEventType?: string;

  @IsOptional()
  @IsString()
  analysisTimeframe?: string;

  @IsOptional()
  @IsIn(['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'])
  analysisPeriod?: AnalysisPeriod;

  @IsOptional()
  @IsIn(['5m', '15m', '1H', '4H', '1D'])
  analysisResolution?: AnalysisResolution;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisWindowDto)
  analysisWindow?: AnalysisWindowDto;

  @IsOptional()
  @IsString()
  predictionHorizon?: string;
}

class RecordOutcomeDto {
  @IsOptional()
  @IsString()
  decisionId?: string;

  @IsOptional()
  @IsString()
  tradeId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  positionId?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @Type(() => Number)
  exitPrice!: number;

  @Type(() => Number)
  pnl!: number;

  @IsOptional()
  @Type(() => Number)
  pnlPercent?: number;

  @IsOptional()
  @Type(() => Number)
  holdingPeriodMs?: number;

  @IsString()
  exitReason!: string;

  @IsOptional()
  @Type(() => Number)
  closedAt?: number;
}

class SoakStartDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60_000)
  targetDurationMs?: number;
}

class SoakWaiveDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly intelligenceBatches: IntelligenceBatchService,
    private readonly continuous: ContinuousIntelligenceStore,
  ) {}

  @Get('mode')
  getMode(
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): ReturnType<AgentService['getMode']> {
    return this.agent.getMode(userId, brandId);
  }

  @Get('human-intel-metrics')
  humanIntelMetrics(
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ): ReturnType<AgentService['getHumanIntelMetrics']> {
    return this.agent.getHumanIntelMetrics(Math.min(limit, 2000));
  }

  @Get('risk-budgets')
  getRiskBudgets(): { riskBudgets: AgentRiskBudgetConfig } {
    return this.agent.getRiskBudgets();
  }

  @Get('walk-forward')
  walkForward(): {
    report: AgentWalkForwardReport | null;
    path: string | null;
  } {
    return this.agent.getWalkForwardReport();
  }

  @Post('trading-enabled')
  setTradingEnabled(@Body() body: TradingEnabledDto): Promise<{ tradingEnabled: boolean }> {
    return this.agent.setTradingEnabled(body.enabled);
  }

  @Post('mode')
  setMode(@Body() body: SetModeDto): { mode: AgentMode; liveArming: AgentLiveArming } {
    return this.agent.setMode(body.mode, body.confirmLive);
  }

  @Post('live-auto-arm')
  setLiveAutoArmed(@Body() body: SetLiveAutoArmDto): ReturnType<AgentService['setLiveAutoArmed']> {
    return this.agent.setLiveAutoArmed(body.armed, body.confirmLiveAuto);
  }

  @Get('p5-evidence-unlock')
  p5EvidenceUnlock(): ReturnType<AgentService['getP5EvidenceUnlock']> {
    return this.agent.getP5EvidenceUnlock();
  }

  @Post('decision-mode')
  setDecisionMode(@Body() body: SetDecisionModeDto): {
    decisionMode: AgentDecisionMode;
    note: string;
  } {
    return this.agent.setDecisionMode(body.decisionMode);
  }

  @Get('decisions')
  decisions(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('decisionId') decisionId?: string,
  ): {
    decisions: import('@stockpred/shared-types').DecisionWithLifecycle[];
    decisionMode: AgentDecisionMode;
  } {
    return this.agent.getDecisions(Math.min(limit, 200), decisionId);
  }

  @Get('decisions/:id/lifecycle')
  decisionLifecycle(
    @Param('id') id: string,
  ): Promise<{ lifecycle: import('@stockpred/shared-types').TradeLifecycleSnapshot | null }> {
    return this.agent.getDecisionLifecycle(id).then((lifecycle) => ({ lifecycle }));
  }

  @Post('kill-switch')
  killSwitch(@Body() body: KillSwitchDto): { killSwitch: boolean; flatten: boolean } {
    return this.agent.setKillSwitch(body.enabled, body.flatten);
  }

  @Post('broker-ready')
  brokerReady(@Body() body: BrokerReadyDto): { ok: boolean } {
    this.agent.recordBrokerConfig(body.configured);
    if (body.testOk != null) this.agent.recordBrokerTest(body.testOk);
    return { ok: true };
  }

  @Get('capabilities')
  capabilities(): Promise<{
    capabilities: AgentCapabilityStatus[];
    requests: AgentCapabilityRequest[];
  }> {
    return this.agent.listCapabilities();
  }

  @Get('capability-requests')
  async capabilityRequests(): Promise<{ requests: AgentCapabilityRequest[] }> {
    const { requests } = await this.agent.listCapabilities();
    return { requests };
  }

  @Post('capability-requests/ack')
  ack(@Body() body: AckCapabilityDto): { id: string; acknowledged: boolean } {
    return this.agent.acknowledgeCapability(body.id);
  }

  @Get('suggestions')
  suggestions(): Promise<{
    suggestions: import('@stockpred/shared-types').AgentSuggestion[];
    cursorSdk: { configured: boolean; installed: boolean };
  }> {
    return this.agent.listSuggestions();
  }

  @Post('suggestions/:id/ack')
  ackSuggestion(@Param('id') id: string): { id: string; acknowledged: boolean } {
    return this.agent.acknowledgeCapability(id);
  }

  @Post('suggestions/:id/reopen')
  reopenSuggestion(@Param('id') id: string): { id: string; status: 'open' } {
    return this.agent.reopenSuggestion(id);
  }

  @Post('suggestions/:id/implement')
  implementSuggestion(
    @Param('id') id: string,
  ): Promise<import('@stockpred/shared-types').AgentSuggestion> {
    return this.agent.implementSuggestion(id);
  }

  @Get('opportunities')
  opportunities(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<{
    mode: AgentMode;
    opportunities: AgentAnalysis[];
    added: Array<AgentAnalysis & { executedAt: number; quantity: number; status: 'APPROVED' }>;
    capabilityRequests: AgentCapabilityRequest[];
    disclaimer: string;
  }> {
    return this.agent.getOpportunities(Math.min(limit, 50), userId, brandId);
  }

  /** Latest FocusUniverseBatch artifact (optimization-only — not authorization). */
  @Get('focus-universe/latest')
  focusUniverseLatest(): FocusUniverseBatch | null {
    return this.agent.getFocusUniverseLatest();
  }

  /**
   * Offline intelligence batch → FocusUniverseBatch.
   * Read-only: no ledger / Risk / Policy / Gate / orders.
   */
  @Post('focus-universe/run-offline')
  runOfflineFocusBatch(
    @Query('limit', new DefaultValuePipe(80), ParseIntPipe) limit = 80,
  ): Promise<FocusUniverseBatch> {
    return this.agent.runOfflineFocusBatch(Math.min(limit, 200));
  }

  /** B1 Intelligence Batch — HISTORICAL / FULL_ANALYSIS only (no auth chain). */
  @Post('intelligence-batches')
  createIntelligenceBatch(@Body() body: CreateIntelligenceBatchDto) {
    return this.intelligenceBatches.create(body as CreateIntelligenceBatchRequest);
  }

  @Get('intelligence-batches')
  listIntelligenceBatches(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    return this.intelligenceBatches.list(Math.min(limit, 200));
  }

  @Get('intelligence-batches/latest/research-report')
  getLatestIntelligenceBatchResearchReport(@Query('universe') universe?: string) {
    return this.intelligenceBatches.getLatestResearchReport(universe);
  }

  @Get('intelligence-batches/:id/research-report/compare')
  compareIntelligenceBatchResearchReport(
    @Param('id') id: string,
    @Query('priorId') priorId?: string,
  ) {
    return this.intelligenceBatches.compareResearchReport(id, priorId);
  }

  @Post('intelligence-batches/:id/research-report/rebuild')
  rebuildIntelligenceBatchResearchReport(@Param('id') id: string) {
    return this.intelligenceBatches.rebuildResearchReport(id);
  }

  @Get('intelligence-batches/:id/research-report')
  getIntelligenceBatchResearchReport(@Param('id') id: string) {
    return this.intelligenceBatches.getResearchReport(id);
  }

  @Get('intelligence-batches/:id/results/by-sector')
  getIntelligenceBatchResultsBySector(@Param('id') id: string) {
    return this.intelligenceBatches.getResultsBySector(id);
  }

  /** Multi-asset instrument + provider registry (discovered from repo providers). */
  @Get('multi-asset/registry')
  multiAssetRegistry() {
    return {
      providers: listProviderCapabilities(),
      adapters: listInstrumentAdapters().map((a) => ({
        id: a.id,
        productLabel: a.productLabel(),
        benchmarkId: a.benchmarkId(),
        capabilities: a.capabilities(),
        featureHints: a.featureHints(),
        temporal: a.temporalContext(),
      })),
      learningTouchesRiskOrGate: learningTouchesRiskOrGate(),
      nonProductionProviders: ['simulated'],
      providerAuthorizesExecution: false,
    };
  }

  /**
   * Canonical universe catalog + coverage preview for batch UI.
   * Predefined universes resolve membership on the backend — never FE symbol lists.
   */
  @Get('multi-asset/universes')
  async listCanonicalUniverses(@Query('universe') universe?: string) {
    const catalog = await this.intelligenceBatches.universeCatalogWithAvailability();
    if (universe?.trim()) {
      const id = universe.trim().toUpperCase();
      const preview = catalog.find((entry) => entry.universeId === id);
      if (!preview) throw new BadRequestException(`Unknown universe: ${universe}`);
      return { universes: [preview], note: BATCH_UNIVERSE_RULE_NOTE };
    }
    return { universes: catalog, note: BATCH_UNIVERSE_RULE_NOTE };
  }

  @Get('multi-asset/instruments/search')
  searchCanonicalInstruments(
    @Query('q') query?: string,
    @Query('assetClass') assetClass?: InstrumentRef['assetClass'],
    @Query('venue') venue?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return {
      instruments: searchCanonicalInstruments({
        query: String(query ?? ''),
        assetClass,
        venue,
        limit,
      }),
    };
  }

  @Get('multi-asset/readiness')
  getMultiAssetReadiness(@Query('universe') universe?: string) {
    if (!universe?.trim()) throw new BadRequestException('universe required');
    return this.intelligenceBatches.universeReadiness(universe);
  }

  @Post('multi-asset/universes/:universe/refresh')
  async refreshCanonicalUniverse(@Param('universe') universe: string) {
    const id = universe.trim().toUpperCase();
    if (id === 'NSE_ALL') {
      const previous = loadActiveUniverseSnapshot('NSE_ALL');
      const result = publishNseAllFromEquityMaster();
      return {
        universeId: 'NSE_ALL',
        published: result.published,
        snapshot: result.snapshot,
        validation: result.validation,
        reason: result.reason,
        lastKnownGoodVersion: result.snapshot?.version ?? previous?.version ?? null,
        retainedLastKnownGood: !result.published && Boolean(result.snapshot ?? previous),
        refreshedAt: Date.now(),
        stale:
          !result.snapshot?.fetchedAt ||
          Date.now() - result.snapshot.fetchedAt > 24 * 60 * 60 * 1000,
      };
    }
    if (id === 'CRYPTO_ALL' || id === 'CRYPTO_SPOT_ALL') {
      const previous = loadActiveUniverseSnapshot('CRYPTO_SPOT_ALL');
      const provider = configuredCryptoUniverseProvider();
      const fetched = await fetchCryptoUniverse(provider);
      const result = publishCanonicalUniverseSnapshot({
        universeId: 'CRYPTO_SPOT_ALL',
        source: fetched.source,
        sourceUrl: fetched.sourceUrl,
        provider: fetched.provider,
        instruments: fetched.instruments,
        sourceCount: fetched.rawRecordCount,
        rawRecordCount: fetched.rawRecordCount,
        rejectedCount: fetched.rejectedCount,
        duplicateCount: fetched.duplicateCount,
        excludedCount: fetched.excludedCount,
        warnings: fetched.warnings,
        providerReportedTotal: fetched.providerReportedTotal ?? fetched.receivedTotal,
        receivedTotal: fetched.receivedTotal,
        pageCount: fetched.pageCount,
      });
      return {
        universeId: 'CRYPTO_SPOT_ALL',
        published: result.published,
        snapshot: result.snapshot,
        validation: result.validation,
        reason: result.reason,
        universeProvider: provider,
        lastKnownGoodVersion: result.snapshot?.version ?? previous?.version ?? null,
        retainedLastKnownGood: !result.published && Boolean(result.snapshot ?? previous),
        refreshedAt: Date.now(),
      };
    }
    if (id === 'CRYPTO_FUTURES_ALL') {
      const previous = loadActiveUniverseSnapshot('CRYPTO_FUTURES_ALL');
      const fetched = await fetchCryptoFuturesUniverse();
      const result = publishCanonicalUniverseSnapshot({
        universeId: 'CRYPTO_FUTURES_ALL',
        source: fetched.source,
        sourceUrl: fetched.sourceUrl,
        provider: fetched.provider,
        instruments: fetched.instruments,
        sourceCount: fetched.rawRecordCount,
        rawRecordCount: fetched.rawRecordCount,
        rejectedCount: fetched.rejectedCount,
        duplicateCount: fetched.duplicateCount,
        excludedCount: fetched.excludedCount,
        warnings: fetched.warnings,
        providerReportedTotal: fetched.providerReportedTotal ?? fetched.receivedTotal,
        receivedTotal: fetched.receivedTotal,
        pageCount: fetched.pageCount,
      });
      return {
        universeId: 'CRYPTO_FUTURES_ALL',
        published: result.published,
        snapshot: result.snapshot,
        validation: result.validation,
        reason: result.reason,
        universeProvider: 'binance-futures',
        lastKnownGoodVersion: result.snapshot?.version ?? previous?.version ?? null,
        retainedLastKnownGood: !result.published && Boolean(result.snapshot ?? previous),
        refreshedAt: Date.now(),
      };
    }
    if (id === 'COMMODITY_ALL') {
      const apiKey = String(process.env.ALPHA_VANTAGE_API_KEY ?? '').trim();
      if (!apiKey) {
        const gate = commodityUniverseGate('COMMODITY_ALL');
        throw new BadRequestException(`${gate.reasonCode}:${gate.detail}`);
      }
      const previous = loadActiveUniverseSnapshot('COMMODITY_ALL');
      try {
        const result = await probeAndPublishCommodityUniverse(apiKey);
        return {
          universeId: 'COMMODITY_ALL',
          published: result.published,
          snapshot: result.snapshot,
          validation: result.validation,
          reason: result.reason,
          universeProvider: 'alpha-vantage',
          lastKnownGoodVersion: result.snapshot?.version ?? previous?.version ?? null,
          retainedLastKnownGood: !result.published && Boolean(result.snapshot ?? previous),
          refreshedAt: Date.now(),
        };
      } catch (err) {
        throw new BadRequestException(
          `UNSUPPORTED_UNIVERSE:${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (id === 'FOREX_ALL') {
      const apiKey = String(process.env.TWELVE_DATA_API_KEY ?? '').trim();
      if (!apiKey) {
        throw new BadRequestException(
          'TWELVE_DATA_API_KEY_MISSING: set TWELVE_DATA_API_KEY to ingest FOREX_ALL',
        );
      }
      const previous = loadActiveUniverseSnapshot('FOREX_ALL');
      const detail = await ingestForexAllUniverse();
      const snapshot = loadActiveUniverseSnapshot('FOREX_ALL');
      return {
        universeId: 'FOREX_ALL',
        published: Boolean(snapshot),
        snapshot,
        reason: detail,
        universeProvider: 'twelve-data',
        lastKnownGoodVersion: snapshot?.version ?? previous?.version ?? null,
        retainedLastKnownGood: !snapshot && Boolean(previous),
        refreshedAt: Date.now(),
      };
    }
    if (id === 'FUTURES_ALL' || id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL') {
      const gate = commodityUniverseGate(
        id as 'FUTURES_ALL' | 'MCX_FUTURES_ALL' | 'CME_FUTURES_ALL',
      );
      throw new BadRequestException(`${gate.reasonCode}:${gate.detail}`);
    }
    throw new BadRequestException(`UNSUPPORTED_UNIVERSE:${id} has no configured refresh provider`);
  }

  @Get('multi-asset/universes/:universe/status')
  canonicalUniverseStatus(@Param('universe') universe: string) {
    const id = universe.trim().toUpperCase();
    const allowed = new Set([
      'NSE_ALL',
      'US_SP500',
      'US_ALL',
      'CRYPTO_ALL',
      'CRYPTO_SPOT_ALL',
      'CRYPTO_FUTURES_ALL',
      'COMMODITY_ALL',
      'FUTURES_ALL',
      'MCX_FUTURES_ALL',
      'CME_FUTURES_ALL',
      'FOREX_ALL',
    ]);
    if (!allowed.has(id)) throw new BadRequestException(`Unknown canonical universe: ${id}`);
    const resolved = resolveGatedCanonicalUniverse(
      id as Parameters<typeof resolveGatedCanonicalUniverse>[0],
    );
    const snapshot = resolved.snapshot;
    return {
      universeId: id,
      supported: resolved.supported,
      reasonCode: resolved.reasonCode,
      reason: resolved.detail,
      activeVersion: snapshot?.version ?? null,
      lifecycle: snapshot?.lifecycle ?? null,
      validationStatus: snapshot?.validationStatus ?? null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      stale: !snapshot?.fetchedAt || Date.now() - snapshot.fetchedAt > 24 * 60 * 60 * 1000,
      lastKnownGoodVersion:
        snapshot?.lifecycle === 'PUBLISH' && snapshot.validationStatus === 'COMPLETE'
          ? snapshot.version
          : null,
    };
  }

  @Get('multi-asset/resolve')
  resolveMultiAssetInstrument(
    @Query('symbol') symbol?: string,
    @Query('universe') universe?: string,
    @Query('hint') hint?: string,
  ) {
    const sym = String(symbol ?? '')
      .trim()
      .toUpperCase();
    if (!sym) throw new BadRequestException('symbol required');
    const adapterHint = hint || adapterHintFromUniverse(universe ?? 'NIFTY50');
    const { instrument, adapter } = resolveInstrumentWithAdapter(sym, adapterHint);
    return {
      instrument,
      adapterId: adapter.id,
      capabilities: adapter.capabilities(),
      temporal: adapter.temporalContext(),
      seriesProvenance: adapter.normalizeSeries([]).seriesProvenance,
    };
  }

  /** Paper Experiment → Outcome → Learning (never Risk/Gate). */
  @Post('paper-experiments')
  createPaperExperimentEndpoint(@Body() body: CreatePaperExperimentDto) {
    const hint = body.adapterHint ?? 'NSE_EQUITY';
    const { instrument, adapter } = resolveInstrumentWithAdapter(body.symbol, hint);
    const temporal = adapter.temporalContext();
    const batch = body.batchId ? this.intelligenceBatches.get(body.batchId) : null;
    if (batch && !batch.symbols.includes(instrument.symbol)) {
      throw new BadRequestException(
        `Instrument ${instrument.symbol} is not in immutable batch ${batch.batchId} membership`,
      );
    }
    return createPaperExperiment({
      instrument,
      adapterId: adapter.id,
      batchId: body.batchId,
      universeVersion: batch?.universeVersion ?? null,
      operatingMode: batch?.mode ?? null,
      predictionSnapshot: batch
        ? {
            analysisTimeframe: batch.analysisTimeframe ?? null,
            predictionHorizon: batch.predictionHorizon ?? null,
            modelVersion: batch.modelVersion,
            featureVersion: batch.featureVersion,
          }
        : null,
      recommendationSnapshot: body.recommendation ? { recommendation: body.recommendation } : null,
      analysisTimeframe: '1d',
      predictionHorizon: body.predictionHorizon ?? '3M',
      sessionContext: temporal.sessionContextId,
      probability: body.probability ?? null,
      confidence: null,
      confidenceStatus: 'UNAVAILABLE',
      confidenceBasis: null,
      thesis: body.thesis ?? null,
      recommendation: body.recommendation ?? null,
      seriesProvenance: adapter.normalizeSeries([]).seriesProvenance,
      note: body.note,
      status: 'QUEUED' as PaperExperimentStatus,
    });
  }

  @Get('paper-experiments')
  listPaperExperimentsEndpoint() {
    return listPaperExperiments();
  }

  @Post('paper-experiments/candidates')
  registerPaperCandidateEndpoint(@Body() body: { fromExperimentIds: string[]; note: string }) {
    return registerCandidateModel({
      fromExperimentIds: body.fromExperimentIds ?? [],
      note: body.note ?? 'Candidate pending walk-forward validation',
    });
  }

  @Get('paper-experiments/:id')
  getPaperExperimentEndpoint(@Param('id') id: string) {
    const row = getPaperExperiment(id);
    if (!row) throw new BadRequestException('Paper experiment not found');
    return row;
  }

  @Post('paper-experiments/:id/outcome')
  recordPaperOutcomeEndpoint(@Param('id') id: string, @Body() body: PaperOutcomeDto) {
    if (!getPaperExperiment(id)) throw new BadRequestException('Paper experiment not found');
    return recordPaperOutcome({
      experimentId: id,
      actualReturn: body.actualReturn ?? null,
      mfe: body.mfe ?? null,
      mae: body.mae ?? null,
      targetReached: body.targetReached ?? null,
      sampleNote: body.sampleNote,
    });
  }

  @Post('paper-experiments/:id/learning')
  appendPaperLearningEndpoint(@Param('id') id: string, @Body() body: LearningNoteDto) {
    if (!getPaperExperiment(id)) throw new BadRequestException('Paper experiment not found');
    return appendLearningNote({ experimentId: id, phase: body.phase, note: body.note });
  }

  @Get('intelligence-batches/:id')
  getIntelligenceBatch(@Param('id') id: string) {
    return this.intelligenceBatches.get(id);
  }

  @Get('intelligence-batches/:id/results')
  getIntelligenceBatchResults(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize = 50,
    @Query('q') q?: string,
    @Query('preset') preset?: string,
    @Query('recommendation') recommendation?: string,
    @Query('thesisState') thesisState?: string,
    @Query('mlAvailable') mlAvailable?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('targetReturn') targetReturn?: string,
    @Query('horizon') horizon?: string,
    @Query('bullRunConfidence') bullRunConfidence?: string,
    @Query('bullRunStage') bullRunStage?: string,
    @Query('integrityStatus') integrityStatus?: string,
    @Query('excludeIntegrity') excludeIntegrity?: string,
    @Query('executionReady') executionReady?: string,
    @Query('dataStatus') dataStatus?: string,
    @Query('sector') sector?: string,
  ) {
    const targetNum =
      targetReturn != null && targetReturn !== '' && Number.isFinite(Number(targetReturn))
        ? Number(targetReturn)
        : undefined;
    const horizonOk = ['1D', '1W', '1M', '3M', '6M', '12M'].includes(String(horizon ?? ''));
    const confOk = ['HIGH', 'MEDIUM', 'LOW'].includes(String(bullRunConfidence ?? ''));
    const integOk = ['NORMAL', 'INVESTIGATE', 'SUSPICIOUS'].includes(String(integrityStatus ?? ''));
    const dataOk = ['LIVE', 'DELAYED', 'STALE', 'OFFLINE', 'UNKNOWN'].includes(
      String(dataStatus ?? ''),
    );
    return this.intelligenceBatches.getResults(id, {
      page,
      pageSize,
      q,
      preset: preset as
        | 'BEST_OPPORTUNITIES'
        | 'HIGH_CONFIDENCE'
        | 'HIGHEST_EXPECTED_RETURN'
        | 'HIGHEST_EXPECTED_R'
        | 'MULTI_HORIZON_ALIGNED'
        | 'BULL_RUN'
        | undefined,
      recommendation: recommendation as 'APPROVE' | 'WAIT' | 'REJECT' | undefined,
      thesisState,
      mlAvailable: mlAvailable === '1' || mlAvailable === 'true',
      sort: sort as
        | 'rank'
        | 'symbol'
        | 'direction'
        | 'expectedReturn'
        | 'upsideProb'
        | 'preferredEntry'
        | 'target'
        | 'expectedR'
        | 'confidence'
        | 'horizon'
        | 'recommendation'
        | undefined,
      order: order === 'desc' ? 'desc' : order === 'asc' ? 'asc' : undefined,
      targetReturn: targetNum,
      horizon: horizonOk ? (horizon as '1D' | '1W' | '1M' | '3M' | '6M' | '12M') : undefined,
      bullRunConfidence: confOk ? (bullRunConfidence as 'HIGH' | 'MEDIUM' | 'LOW') : undefined,
      bullRunStage: bullRunStage || undefined,
      integrityStatus: integOk
        ? (integrityStatus as 'NORMAL' | 'INVESTIGATE' | 'SUSPICIOUS')
        : undefined,
      excludeIntegrity: excludeIntegrity || undefined,
      executionReady:
        executionReady === '1' || executionReady === 'true'
          ? true
          : executionReady === '0' || executionReady === 'false'
            ? false
            : undefined,
      dataStatus: dataOk
        ? (dataStatus as 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN')
        : undefined,
      sector: sector || undefined,
    });
  }

  @Post('intelligence-batches/:id/pause')
  pauseIntelligenceBatch(@Param('id') id: string) {
    return this.intelligenceBatches.pause(id);
  }

  @Post('intelligence-batches/:id/resume')
  resumeIntelligenceBatch(@Param('id') id: string) {
    return this.intelligenceBatches.resume(id);
  }

  @Post('intelligence-batches/:id/cancel')
  cancelIntelligenceBatch(@Param('id') id: string) {
    return this.intelligenceBatches.cancel(id);
  }

  @Post('intelligence-batches/:id/retry')
  retryIntelligenceBatch(@Param('id') id: string) {
    return this.intelligenceBatches.retry(id);
  }

  /** B7 — continuous intelligence events (advisory; never amends orders). */
  @Get('continuous/events')
  listContinuousEvents(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    return this.continuous.listEvents(Math.min(limit, 200));
  }

  @Get('continuous/position-plans')
  listPositionManagementPlans(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    return this.continuous.listPlans(Math.min(limit, 200));
  }

  @Post('continuous/events')
  ingestContinuousEvent(@Body() body: Record<string, unknown>) {
    const eventId = String(body.eventId ?? `evt-${Date.now()}`);
    const symbol = String(body.symbol ?? '').toUpperCase();
    if (!symbol) throw new BadRequestException('symbol required');
    const position =
      body.position && typeof body.position === 'object'
        ? (body.position as {
            positionId: string;
            originalEntry: number;
            currentPrice: number;
            originalTarget?: number;
            originalStop?: number;
            thesisState?: string;
            cutoffReached?: boolean;
            tradeId?: string;
            decisionId?: string;
          })
        : undefined;
    const result = this.continuous.ingest({
      eventId,
      symbol,
      priority: (body.priority as 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5') ?? 'P3',
      trigger:
        (body.trigger as
          | 'PRICE'
          | 'NEWS'
          | 'REGIME'
          | 'THESIS'
          | 'ML'
          | 'CATALYST'
          | 'CUTOFF'
          | 'OTHER') ?? 'OTHER',
      dataStatus:
        (body.dataStatus as 'LIVE' | 'DELAYED' | 'STALE' | 'UNKNOWN' | 'CLOSED_MARKET') ??
        'UNKNOWN',
      message: String(body.message ?? 'reassessment'),
      position,
    });
    // B17 — targeted focus refresh only (never full NIFTY500 / never authorization).
    const globalEventType =
      typeof body.globalEventType === 'string' ? body.globalEventType.trim() : '';
    if (!result.deduplicated && globalEventType) {
      void this.agent.triggerTargetedGlobalEventRefresh(globalEventType, symbol);
    }
    return result;
  }

  @Get('analysis/:symbol')
  analysis(
    @Param('symbol') symbol: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<AgentAnalysis> {
    return this.agent.getAnalysis(symbol, userId, brandId);
  }

  @Get('positions')
  positions(): Promise<{
    positions: AgentManagedPosition[];
    killSwitch: boolean;
    agentTradingEnabled: boolean;
  }> {
    return this.agent.getPositions();
  }

  @Get('positions/:symbol/exit-intelligence')
  exitIntelligence(
    @Param('symbol') symbol: string,
  ): Promise<{ exitIntelligence: import('@stockpred/shared-types').ExitRecommendation | null }> {
    return this.agent.getExitIntelligence(symbol).then((exitIntelligence) => ({
      exitIntelligence,
    }));
  }

  @Get('portfolio')
  portfolio(
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<PortfolioSnapshot> {
    return this.agent.getPortfolio(userId, brandId);
  }

  @Get('transactions')
  transactions(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<{
    transactions: import('./transaction-auditor').AgentTransactionAudit[];
    disclaimer: string;
  }> {
    return this.agent.getTransactions(Math.min(limit, 100), userId, brandId);
  }

  @Get('monitoring-logs')
  monitoringLogs(
    @Query('limit', new DefaultValuePipe(80), ParseIntPipe) limit = 80,
    @Query('symbol') symbol?: string,
  ): Promise<{
    events: unknown[];
    meta: unknown;
    disclaimer: string;
  }> {
    return this.agent.getMonitoringLogs(Math.min(limit, 200), symbol);
  }

  @Post('recommendations/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
    @Headers('x-user-role') userRole?: string,
    @Headers('x-user-views') userViews?: string,
    @Headers('x-user-status') userStatus?: string,
  ): Promise<{ recommendation: AgentRecommendation; trade: unknown }> {
    return this.agent.approveRecommendation(id, userId, body?.quantity, brandId, {
      userRole,
      views: userViews?.split(',').filter(Boolean),
      status: userStatus,
    });
  }

  @Post('recommendations/:id/wait')
  wait(
    @Param('id') id: string,
    @Body() body: WaitDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ recommendation: AgentRecommendation; decision: DecisionLedgerEntry }> {
    return this.agent.waitRecommendation(id, userId, body?.reason);
  }

  @Get('recommendations/:id/wait-intelligence')
  waitIntelligence(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ waitIntelligence: import('@stockpred/shared-types').WaitRecommendation | null }> {
    return this.agent.getWaitIntelligence(id, userId).then((waitIntelligence) => ({
      waitIntelligence,
    }));
  }

  @Get('recommendations/:id/thesis')
  thesis(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ thesis: import('@stockpred/shared-types').StructuredThesis | null }> {
    return this.agent.getThesisIntelligence(id, userId).then((thesis) => ({ thesis }));
  }

  @Post('recommendations/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: RejectDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ recommendation: AgentRecommendation; decision: DecisionLedgerEntry }> {
    return this.agent.rejectRecommendation(id, userId, body?.reason);
  }

  @Post('decisions/outcome')
  recordOutcome(@Body() body: RecordOutcomeDto): {
    recorded: boolean;
    duplicate: boolean;
    decisionId?: string;
  } {
    return this.agent.recordTradeOutcome({
      decisionId: body.decisionId,
      tradeId: body.tradeId,
      orderId: body.orderId,
      positionId: body.positionId,
      symbol: body.symbol,
      exitPrice: body.exitPrice,
      pnl: body.pnl,
      pnlPercent: body.pnlPercent,
      holdingPeriodMs: body.holdingPeriodMs,
      exitReason: body.exitReason,
      closedAt: body.closedAt,
    });
  }

  @Get('soak')
  getSoak(): { soak: import('@stockpred/shared-types').SoakRun | null } {
    return this.agent.getSoakController().getStatus();
  }

  @Post('soak/start')
  startSoak(@Body() body: SoakStartDto): import('@stockpred/shared-types').SoakRun {
    return this.agent.getSoakController().start({
      targetDurationMs: body.targetDurationMs,
    });
  }

  @Post('soak/stop')
  stopSoak(): import('@stockpred/shared-types').SoakRun {
    return this.agent.getSoakController().stop();
  }

  @Post('soak/waive')
  waiveSoak(@Body() body: SoakWaiveDto): import('@stockpred/shared-types').SoakRun {
    return this.agent.getSoakController().waive(body.reason || 'Operator waive');
  }

  @Get('ops')
  getOps(@Query('soakRunId') soakRunId?: string): import('@stockpred/shared-types').SoakOpsMetrics {
    return this.agent.getSoakController().getOpsMetrics(soakRunId);
  }

  /** OH-1 observe-only pipeline latency metrics. */
  @Get('ops/pipeline-metrics')
  getOhPipelineMetrics(): import('@stockpred/shared-types').OhPipelineMetricsSnapshot {
    return this.agent.getOhPipelineMetrics();
  }

  /** OH-2 observe-only execution health. */
  @Get('ops/execution-health')
  getOhExecutionHealth(): import('@stockpred/shared-types').OhExecutionHealthSnapshot {
    return this.agent.getOhExecutionHealth();
  }

  /**
   * OH-3 observe-only reconciliation (ledger ↔ holdings ↔ positions).
   * Detect/report only — never authorizes or mutates positions.
   */
  @Get('ops/reconcile')
  runOhReconciliation(
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<import('@stockpred/shared-types').OhReconciliationReport> {
    return this.agent.runOhReconciliation(userId, brandId);
  }

  /** OH-4 observe-only kill/disarm safety events. */
  @Get('ops/safety-events')
  getOhSafetyEvents(): import('@stockpred/shared-types').OhSafetyEventsSnapshot {
    return this.agent.getOhSafetyEvents();
  }

  /** OH-5 observe-only data quality. */
  @Get('ops/data-quality')
  getOhDataQuality(): import('@stockpred/shared-types').OhDataQualitySnapshot {
    return this.agent.getOhDataQuality();
  }

  /** OH-6 unified operational report (OH-1…OH-5 aggregate). */
  @Get('ops/report')
  getOhOpsReport(
    @Headers('x-user-id') userId?: string,
    @Headers('x-brand-id') brandId?: string,
  ): Promise<import('@stockpred/shared-types').OhOpsReportSnapshot> {
    return this.agent.getOhOpsReport(userId, brandId);
  }

  @Get('calibration')
  getCalibration(
    @Query('soakRunId') soakRunId?: string,
  ): import('@stockpred/shared-types').SoakCalibrationReport {
    return this.agent.getSoakController().getCalibration(soakRunId);
  }

  @Get('soak/compare')
  getSoakCompare(@Query('soakRunId') soakRunId?: string): {
    soakRunId: string | null;
    rows: import('@stockpred/shared-types').SoakVsWalkForwardRow[];
  } {
    return this.agent.getSoakController().getCompare(soakRunId);
  }

  @Get('soak/report')
  getSoakReport(): import('@stockpred/shared-types').PaperSoakReport | null {
    return this.agent.getSoakController().buildReport();
  }

  /**
   * Latest matched historical-prediction-proof artifact (measurement only).
   * Never implies authorization or production readiness.
   */
  @Get('historical-prediction-proof')
  getHistoricalPredictionProof():
    | import('@stockpred/shared-utils').HistoricalPredictionProofReport
    | ReturnType<typeof emptyHistoricalPredictionProofNote> {
    const report = loadHistoricalPredictionProof();
    return report ?? emptyHistoricalPredictionProofNote();
  }

  /**
   * Run matched baseline vs analogue walk-forward on provided closes and persist.
   * Body: { symbol, closes: number[], universe? }. Advisory only.
   */
  @Post('historical-prediction-proof')
  runHistoricalPredictionProof(
    @Body()
    body: {
      symbol?: string;
      closes?: number[];
      universe?: string;
    },
  ): import('@stockpred/shared-utils').HistoricalPredictionProofReport {
    const symbol = String(body?.symbol ?? '').toUpperCase();
    const closes = Array.isArray(body?.closes)
      ? body.closes.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : [];
    if (!symbol || closes.length < 80) {
      throw new BadRequestException(
        'symbol and closes (≥80 finite numbers) required for matched proof run',
      );
    }
    return runAndPersistHistoricalPredictionProof({
      symbol,
      closes,
      universe: body.universe,
    });
  }
}
