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
  AgentLiveArming,
  AgentManagedPosition,
  AgentMode,
  AgentRecommendation,
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

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('mode')
  getMode(): {
    tradingEnabled: boolean;
    mode: AgentMode;
    killSwitch: boolean;
    liveArming: AgentLiveArming;
    disclaimer: string;
  } {
    return this.agent.getMode();
  }

  @Post('trading-enabled')
  setTradingEnabled(@Body() body: TradingEnabledDto): Promise<{ tradingEnabled: boolean }> {
    return this.agent.setTradingEnabled(body.enabled);
  }

  @Post('mode')
  setMode(@Body() body: SetModeDto): { mode: AgentMode; liveArming: AgentLiveArming } {
    return this.agent.setMode(body.mode, body.confirmLive);
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

  @Post('suggestions/:id/implement')
  implementSuggestion(
    @Param('id') id: string,
  ): Promise<import('@stockpred/shared-types').AgentSuggestion> {
    return this.agent.implementSuggestion(id);
  }

  @Get('opportunities')
  opportunities(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20): Promise<{
    mode: AgentMode;
    opportunities: AgentAnalysis[];
    capabilityRequests: AgentCapabilityRequest[];
    disclaimer: string;
  }> {
    return this.agent.getOpportunities(Math.min(limit, 50));
  }

  @Get('analysis/:symbol')
  analysis(@Param('symbol') symbol: string): Promise<AgentAnalysis> {
    return this.agent.getAnalysis(symbol);
  }

  @Get('positions')
  positions(): Promise<{ positions: AgentManagedPosition[]; killSwitch: boolean }> {
    return this.agent.getPositions();
  }

  @Get('portfolio')
  portfolio(): Promise<PortfolioSnapshot> {
    return this.agent.getPortfolio();
  }

  @Post('recommendations/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ recommendation: AgentRecommendation; trade: unknown }> {
    return this.agent.approveRecommendation(id, userId, body?.quantity);
  }
}
