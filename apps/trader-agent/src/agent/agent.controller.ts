import {
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
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
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
  PortfolioSnapshot,
} from '@stockpred/shared-types';
import { AgentService } from './agent.service';

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
  constructor(private readonly agent: AgentService) {}

  @Get('mode')
  getMode(): ReturnType<AgentService['getMode']> {
    return this.agent.getMode();
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
  ): { decisions: DecisionLedgerEntry[]; decisionMode: AgentDecisionMode } {
    return this.agent.getDecisions(Math.min(limit, 200), decisionId);
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
