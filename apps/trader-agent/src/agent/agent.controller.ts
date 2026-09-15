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
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
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
  DecisionLedgerEntry,
  FocusUniverseBatch,
  PortfolioSnapshot,
} from '@stockpred/shared-types';
import { AgentService } from './agent.service';
import { ContinuousIntelligenceStore } from './continuous-intelligence-store';
import { IntelligenceBatchService } from './intelligence-batch.service';

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

class CreateIntelligenceBatchDto {
  @IsIn(['NIFTY50', 'NIFTY100', 'NIFTY150', 'NIFTY500', 'ALL', 'CUSTOM', 'SECTOR', 'SINGLE_STOCK'])
  universe!:
    | 'NIFTY50'
    | 'NIFTY100'
    | 'NIFTY150'
    | 'NIFTY500'
    | 'ALL'
    | 'CUSTOM'
    | 'SECTOR'
    | 'SINGLE_STOCK';

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
    | 'CUSTOM';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbols?: string[];

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
    return this.intelligenceBatches.create(body);
  }

  @Get('intelligence-batches')
  listIntelligenceBatches(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    return this.intelligenceBatches.list(Math.min(limit, 200));
  }

  @Get('intelligence-batches/latest/research-report')
  getLatestIntelligenceBatchResearchReport(@Query('universe') universe?: string) {
    return this.intelligenceBatches.getLatestResearchReport(universe);
  }

  @Get('intelligence-batches/:id/research-report')
  getIntelligenceBatchResearchReport(@Param('id') id: string) {
    return this.intelligenceBatches.getResearchReport(id);
  }

  @Get('intelligence-batches/:id/results/by-sector')
  getIntelligenceBatchResultsBySector(@Param('id') id: string) {
    return this.intelligenceBatches.getResultsBySector(id);
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
  ): Promise<{ recommendation: AgentRecommendation; trade: unknown }> {
    return this.agent.approveRecommendation(id, userId, body?.quantity, brandId);
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
}
