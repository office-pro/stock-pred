import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiResponse, AppView, TradeSide, UserRole, withDisclaimer } from '@stockpred/shared-types';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt.guard';
import { identityHeaders, Roles, RolesGuard, Views, ViewsGuard } from '../auth/roles.guard';
import { ProxyService } from './proxy.service';

export class BacktestRequestDto {
  @IsString()
  @MaxLength(20)
  symbol!: string;

  @IsIn([1, 3, 5, 10])
  years!: number;

  @IsOptional()
  @IsNumber()
  @Min(10_000)
  @Max(1_000_000_000)
  initialCapital?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(5)
  riskPerTradePercent?: number;
}

export class ExecuteTradeRequestDto {
  @IsString()
  @MaxLength(20)
  symbol!: string;

  @IsEnum(TradeSide)
  side!: TradeSide;

  @Transform(({ value }) => Math.max(1, Math.round(Number(value))))
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  target?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  stopLoss?: number;
}

export class MlJobStartDto {
  @IsIn([
    'run_all',
    'ingest_fundamentals',
    'ingest_alt_data',
    'ingest_macro',
    'ingest_news',
    'ingest_social',
    'train_all',
    'predict_all',
    'train_manipulation',
    'walk_forward',
    'ml_backtest',
    'ml_lifecycle_full',
    'ml_lifecycle_refresh',
  ])
  kind!: string;

  @IsOptional()
  @IsIn(['nifty50', 'nifty100', 'nifty500', 'smallcap', 'all'])
  universe?: string;

  /** Optional comma-separated symbols to scope train/predict (stock detail ingest). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  symbols?: string;
}

export class MlPromoteDto {
  @IsString()
  @MaxLength(32)
  horizon!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  modelId?: string;
}

export class BrokerConfigDto {
  @IsString()
  brokerType!: string;

  @IsOptional()
  credentials?: Record<string, string>;
}

export class BrokerTestDto {
  @IsString()
  brokerType!: string;
}

@Controller('api')
@UseGuards(JwtAuthGuard)
export class ApiController {
  constructor(private readonly proxy: ProxyService) {}

  // ------------------------------------------------------------ market data

  @Get('stocks')
  @UseGuards(ViewsGuard)
  @Views(AppView.DASHBOARD, AppView.SCANNER, AppView.STOCK_DETAIL)
  getStocks(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('exchange') exchange?: string,
    @Query('suggestion') suggestion?: string,
    @Query('horizon') horizon?: string,
    @Query('sort') sort?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', '/stocks', {
      params: { page, limit, search, exchange, suggestion, horizon, sort },
    });
  }

  @Get('stocks/:symbol')
  getStock(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}`);
  }

  @Get('stocks/:symbol/anomaly')
  getAnomaly(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/anomaly`);
  }

  @Get('stocks/:symbol/candles')
  getCandles(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = '1d',
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/candles`, {
      params: { timeframe, limit },
    });
  }

  @Get('stocks/:symbol/candles/mtf')
  getMultiTimeframeCandles(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(120), ParseIntPipe) limit = 120,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/candles/mtf`, {
      params: { limit },
    });
  }

  @Get('stocks/:symbol/depth')
  getDepth(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/depth`);
  }

  @Get('stocks/:symbol/compare')
  compare(
    @Param('symbol') symbol: string,
    @Query('benchmark') benchmark = 'NIFTY_50',
    @Query('window', new DefaultValuePipe(60), ParseIntPipe) window = 60,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/compare`, {
      params: { benchmark, window },
    });
  }

  @Get('stocks/:symbol/fundamentals')
  getFundamentals(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/fundamentals`);
  }

  @Post('stocks/:symbol/fundamentals/ingest')
  @UseGuards(JwtAuthGuard)
  ingestFundamentals(
    @Param('symbol') symbol: string,
    @Query('full') full?: string,
  ): Promise<unknown> {
    return this.proxy.post(
      'marketData',
      `/stocks/${encodeURIComponent(symbol)}/fundamentals/ingest`,
      undefined,
      { params: { full }, timeout: 300_000 },
    );
  }

  @Post('stocks/:symbol/technical/refresh')
  @UseGuards(JwtAuthGuard)
  refreshTechnical(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.post(
      'marketData',
      `/stocks/${encodeURIComponent(symbol)}/technical/refresh`,
      undefined,
      { timeout: 300_000 },
    );
  }

  @Get('stocks/:symbol/peer-valuation')
  getPeerValuation(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/peer-valuation`);
  }

  @Get('stocks/:symbol/alt-data')
  getAltData(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}/alt-data`);
  }

  @Post('stocks/:symbol/alt-data/news/ingest')
  @UseGuards(JwtAuthGuard)
  ingestNews(@Param('symbol') symbol: string, @Query('full') full?: string): Promise<unknown> {
    return this.proxy.post(
      'marketData',
      `/stocks/${encodeURIComponent(symbol)}/alt-data/news/ingest`,
      undefined,
      { params: { full }, timeout: 300_000 },
    );
  }

  @Post('stocks/:symbol/alt-data/social/ingest')
  @UseGuards(JwtAuthGuard)
  ingestSocial(@Param('symbol') symbol: string, @Query('full') full?: string): Promise<unknown> {
    return this.proxy.post(
      'marketData',
      `/stocks/${encodeURIComponent(symbol)}/alt-data/social/ingest`,
      undefined,
      { params: { full }, timeout: 300_000 },
    );
  }

  @Post('alt-data/ingest/macro')
  @UseGuards(JwtAuthGuard)
  ingestMacro(
    @Query('full') full?: string,
    @Query('includeIndia') includeIndia?: string,
  ): Promise<unknown> {
    return this.proxy.post('marketData', '/alt-data/ingest/macro', undefined, {
      params: { full, includeIndia },
      timeout: 300_000,
    });
  }

  @Get('fundamentals/panel')
  getFundamentalsPanel(): Promise<unknown> {
    return this.proxy.get('marketData', '/fundamentals/panel');
  }

  @Get('fundamentals/sector-medians')
  getSectorMedians(): Promise<unknown> {
    return this.proxy.get('marketData', '/fundamentals/sector-medians');
  }

  @Get('indices')
  getIndices(): Promise<unknown> {
    return this.proxy.get('marketData', '/indices');
  }

  @Get('market/context')
  getMarketContext(): Promise<unknown> {
    return this.proxy.get('marketData', '/market/context');
  }

  @Get('market/data-contract')
  getMarketDataContract(): Promise<unknown> {
    return this.proxy.get('marketData', '/market/data-contract');
  }

  @Get('market/ml-ti-bridge')
  @UseGuards(JwtAuthGuard)
  getMlTiBridge(): Promise<unknown> {
    return this.proxy.get('marketData', '/market/ml-ti-bridge');
  }

  @Post('market/predictions/refresh')
  @UseGuards(JwtAuthGuard)
  refreshMlPredictions(): Promise<unknown> {
    return this.proxy.post('marketData', '/market/predictions/refresh', {});
  }

  @Get('market/predictions/:symbol')
  @UseGuards(JwtAuthGuard)
  getUsableMlPrediction(
    @Param('symbol') symbol: string,
    @Query('horizon') horizon?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/market/predictions/${encodeURIComponent(symbol)}`, {
      params: horizon ? { horizon } : undefined,
    });
  }

  @Get('scanner')
  getScanner(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(40), ParseIntPipe) limit = 40,
    @Query('minScore', new DefaultValuePipe(55), ParseIntPipe) minScore = 55,
    @Query('sort') sort = 'score',
    @Query('minInvestigate', new DefaultValuePipe(0), ParseIntPipe) minInvestigate = 0,
  ): Promise<unknown> {
    return this.proxy.get('marketData', '/scanner', {
      params: { page, limit, minScore, sort, minInvestigate },
    });
  }

  @Get('indices/:index/candles')
  getIndexCandles(
    @Param('index') index: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/indices/${encodeURIComponent(index)}/candles`, {
      params: { limit },
    });
  }

  // ---------------------------------------------------------- B9–B17 advisory

  @Get('intelligence/sectors')
  listIntelligenceSectors(): Promise<unknown> {
    return this.proxy.get('marketData', '/intelligence/sectors');
  }

  @Get('intelligence/sectors/all')
  allSectorsIntelligence(@Query('limit') limit?: string): Promise<unknown> {
    return this.proxy.get('marketData', '/intelligence/sectors/all', {
      params: limit ? { limit } : undefined,
    });
  }

  @Get('intelligence/sectors/:sector')
  sectorIntelligence(@Param('sector') sector: string): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/sectors/${encodeURIComponent(sector)}`);
  }

  @Get('intelligence/sectors/:sector/members')
  sectorMembers(@Param('sector') sector: string): Promise<unknown> {
    return this.proxy.get(
      'marketData',
      `/intelligence/sectors/${encodeURIComponent(sector)}/members`,
    );
  }

  @Get('intelligence/bull-run/:symbol')
  bullRunIntelligence(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/bull-run/${encodeURIComponent(symbol)}`);
  }

  @Get('intelligence/relationships')
  relationshipIntelligence(
    @Query('left') left?: string,
    @Query('right') right?: string,
    @Query('kind') kind?: string,
    @Query('windowDays') windowDays?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', '/intelligence/relationships', {
      params: { left, right, kind, windowDays },
    });
  }

  @Get('intelligence/inverse/:symbol')
  inverseIntelligence(
    @Param('symbol') symbol: string,
    @Query('peers') peers?: string,
    @Query('downsideThreshold') downsideThreshold?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/inverse/${encodeURIComponent(symbol)}`, {
      params: { peers, downsideThreshold },
    });
  }

  @Get('intelligence/historical/:symbol')
  historicalIntelligence(
    @Param('symbol') symbol: string,
    @Query('dayReturnThreshold') dayReturnThreshold?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/historical/${encodeURIComponent(symbol)}`, {
      params: { dayReturnThreshold },
    });
  }

  @Get('intelligence/cross-asset/:symbol')
  crossAssetIntelligence(
    @Param('symbol') symbol: string,
    @Query('asset') asset?: string,
  ): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/cross-asset/${encodeURIComponent(symbol)}`, {
      params: asset ? { asset } : undefined,
    });
  }

  @Get('intelligence/fno/:symbol')
  fnoIntelligence(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/intelligence/fno/${encodeURIComponent(symbol)}`);
  }

  @Post('intelligence/global-events')
  globalEventIntelligence(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('marketData', '/intelligence/global-events', body);
  }

  // ---------------------------------------------------------------- signals

  @Get('signals')
  async getSignals(
    @Query('all', new DefaultValuePipe(false)) allSignals: boolean,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('signal') signal?: string,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('signalEngine', '/signals', {
        params: { all: allSignals, page, limit, search, signal },
      }),
    );
  }

  @Get('signals/:symbol')
  async getSignalsForSymbol(@Param('symbol') symbol: string): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('signalEngine', `/signals/${encodeURIComponent(symbol)}`),
    );
  }

  @Get('support-resistance/:symbol')
  async getSupportResistance(@Param('symbol') symbol: string): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('signalEngine', `/support-resistance/${encodeURIComponent(symbol)}`),
    );
  }

  // ---------------------------------------------------------------- patterns

  @Get('patterns')
  async getPatterns(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('patternEngine', '/patterns', { params: { limit } }),
    );
  }

  @Get('patterns/:symbol')
  async getPatternsForSymbol(@Param('symbol') symbol: string): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('patternEngine', `/patterns/${encodeURIComponent(symbol)}`),
    );
  }

  @Get('patterns/:symbol/analogs')
  async getPatternAnalogs(
    @Param('symbol') symbol: string,
    @Query('pattern') pattern?: string,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('patternEngine', `/patterns/${encodeURIComponent(symbol)}/analogs`, {
        params: pattern ? { pattern } : undefined,
      }),
    );
  }

  // ------------------------------------------------------------- predictions

  @Get('predictions')
  async getAllPredictions(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('search') search?: string,
    @Query('horizon') horizon?: string,
    @Query('direction') direction?: string,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('mlEngine', '/predictions/all', {
        params: { limit: Math.min(limit, 5000), page, search, horizon, direction },
      }),
    );
  }

  @Get('predictions/accuracy')
  async getPredictionAccuracy(
    @Query('horizon') horizon = 'NEXT_DAY',
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('mlEngine', '/predictions/accuracy', { params: { horizon } }),
    );
  }

  @Get('predictions/:symbol')
  async getPredictions(@Param('symbol') symbol: string): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('mlEngine', `/predictions/${encodeURIComponent(symbol)}`),
    );
  }

  // ---------------------------------------------------------------- ML Lab jobs

  @Get('ml/jobs/current')
  @UseGuards(JwtAuthGuard)
  getMlJob(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/jobs/current');
  }

  @Get('ml/evaluations')
  @UseGuards(JwtAuthGuard)
  getMlEvaluations(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/evaluations');
  }

  @Get('ml/drift')
  @UseGuards(JwtAuthGuard)
  getMlDrift(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/drift');
  }

  @Get('ml/reports')
  @UseGuards(JwtAuthGuard)
  getMlReports(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/reports');
  }

  @Post('ml/jobs')
  @UseGuards(JwtAuthGuard)
  startMlJob(@Body() dto: MlJobStartDto): Promise<unknown> {
    return this.proxy.post('mlEngine', '/jobs', dto);
  }

  @Post('ml/jobs/current/cancel')
  @UseGuards(JwtAuthGuard)
  cancelMlJob(): Promise<unknown> {
    return this.proxy.post('mlEngine', '/jobs/current/cancel');
  }

  @Get('ml/registry')
  @UseGuards(JwtAuthGuard)
  getMlRegistry(
    @Query('horizon') horizon?: string,
    @Query('status') status?: string,
  ): Promise<unknown> {
    return this.proxy.get('mlEngine', '/registry', { params: { horizon, status } });
  }

  @Get('ml/registry/active')
  @UseGuards(JwtAuthGuard)
  getMlRegistryActive(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/registry/active');
  }

  @Post('ml/promote')
  @UseGuards(JwtAuthGuard)
  promoteMlModel(@Body() dto: MlPromoteDto): Promise<unknown> {
    return this.proxy.post('mlEngine', '/promote', dto);
  }

  @Get('ml/overview')
  @UseGuards(JwtAuthGuard)
  getMlOverview(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/overview');
  }

  @Get('ml/lifecycle/latest')
  @UseGuards(JwtAuthGuard)
  getMlLifecycleLatest(): Promise<unknown> {
    return this.proxy.get('mlEngine', '/lifecycle/latest');
  }

  @Get('ml/lifecycle/runs/:runId')
  @UseGuards(JwtAuthGuard)
  getMlLifecycleRun(@Param('runId') runId: string): Promise<unknown> {
    return this.proxy.get('mlEngine', `/lifecycle/runs/${encodeURIComponent(runId)}`);
  }

  // ---------------------------------------------------------------- backtest

  @Post('backtest')
  @UseGuards(JwtAuthGuard)
  async runBacktest(@Body() dto: BacktestRequestDto): Promise<ApiResponse<unknown>> {
    return withDisclaimer(await this.proxy.post('backtest', '/backtest', dto));
  }

  @Post('backtest/scanner')
  @UseGuards(JwtAuthGuard)
  async runScannerBacktest(
    @Body() dto: { symbol: string; minBullScore?: number },
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(await this.proxy.post('backtest', '/backtest/scanner', dto));
  }

  @Get('backtest/history')
  async backtestHistory(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('backtest', '/backtest/history', { params: { limit } }),
    );
  }

  // ----------------------------------------------------------------- trading

  @Post('trade/execute')
  @UseGuards(JwtAuthGuard)
  executeTrade(
    @Body() dto: ExecuteTradeRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('autoTrader', '/trade/execute', dto, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('portfolio')
  @UseGuards(ViewsGuard)
  @Views(AppView.PORTFOLIO)
  getPortfolio(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.get('autoTrader', '/portfolio', {
      headers: identityHeaders(request.user),
    });
  }

  @Get('holdings')
  @UseGuards(ViewsGuard)
  @Views(AppView.PORTFOLIO)
  getHoldings(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.get('autoTrader', '/holdings', {
      headers: identityHeaders(request.user),
    });
  }

  @Get('trades')
  @UseGuards(ViewsGuard)
  @Views(AppView.PORTFOLIO)
  getTrades(
    @Req() request: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<unknown> {
    return this.proxy.get('autoTrader', '/trades', {
      params: { limit },
      headers: identityHeaders(request.user),
    });
  }

  @Post('circuit-breaker/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  resetCircuitBreaker(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.post('autoTrader', '/circuit-breaker/reset', undefined, {
      headers: identityHeaders(request.user),
    });
  }

  // ----------------------------------------------------------- trader agent

  @Get('agent/mode')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentMode(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/mode');
  }

  @Get('agent/human-intel-metrics')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentHumanIntelMetrics(@Query('limit') limit?: string): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/human-intel-metrics', {
      params: { limit: limit ?? '500' },
    });
  }

  @Get('agent/risk-budgets')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentRiskBudgets(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/risk-budgets');
  }

  @Get('agent/walk-forward')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentWalkForward(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/walk-forward');
  }

  @Post('agent/trading-enabled')
  @UseGuards(JwtAuthGuard)
  setAgentTradingEnabled(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/trading-enabled', body);
  }

  @Post('agent/mode')
  @UseGuards(JwtAuthGuard)
  setAgentMode(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/mode', body);
  }

  @Post('agent/live-auto-arm')
  @UseGuards(JwtAuthGuard)
  setAgentLiveAutoArm(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/live-auto-arm', body);
  }

  @Get('agent/p5-evidence-unlock')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentP5EvidenceUnlock(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/p5-evidence-unlock');
  }

  @Post('agent/decision-mode')
  @UseGuards(JwtAuthGuard)
  setAgentDecisionMode(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/decision-mode', body);
  }

  @Get('agent/decisions')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentDecisions(
    @Query('limit') limit?: string,
    @Query('decisionId') decisionId?: string,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/decisions', {
      params: {
        limit: limit ?? 50,
        ...(decisionId ? { decisionId } : {}),
      },
    });
  }

  @Post('agent/decisions/outcome')
  @UseGuards(JwtAuthGuard)
  agentDecisionOutcome(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/decisions/outcome', body);
  }

  @Get('agent/soak')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentSoak(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/soak');
  }

  @Post('agent/soak/start')
  @UseGuards(JwtAuthGuard)
  agentSoakStart(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/soak/start', body);
  }

  @Post('agent/soak/stop')
  @UseGuards(JwtAuthGuard)
  agentSoakStop(): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/soak/stop', {});
  }

  @Post('agent/soak/waive')
  @UseGuards(JwtAuthGuard)
  agentSoakWaive(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/soak/waive', body);
  }

  @Get('agent/ops')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentOps(@Query('soakRunId') soakRunId?: string): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/ops', {
      params: { ...(soakRunId ? { soakRunId } : {}) },
    });
  }

  @Get('agent/calibration')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentCalibration(@Query('soakRunId') soakRunId?: string): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/calibration', {
      params: { ...(soakRunId ? { soakRunId } : {}) },
    });
  }

  @Get('agent/soak/compare')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentSoakCompare(@Query('soakRunId') soakRunId?: string): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/soak/compare', {
      params: { ...(soakRunId ? { soakRunId } : {}) },
    });
  }

  @Get('agent/soak/report')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentSoakReport(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/soak/report');
  }

  @Post('agent/kill-switch')
  @UseGuards(JwtAuthGuard)
  agentKillSwitch(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/kill-switch', body);
  }

  @Get('agent/capabilities')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentCapabilities(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/capabilities');
  }

  @Get('agent/capability-requests')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentCapabilityRequests(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/capability-requests');
  }

  @Post('agent/capability-requests/ack')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  ackCapability(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/capability-requests/ack', body);
  }

  @Get('agent/suggestions')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentSuggestions(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/suggestions');
  }

  @Post('agent/suggestions/:id/ack')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  ackAgentSuggestion(@Param('id') id: string): Promise<unknown> {
    return this.proxy.post('traderAgent', `/agent/suggestions/${encodeURIComponent(id)}/ack`, {});
  }

  @Post('agent/suggestions/:id/reopen')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  reopenAgentSuggestion(@Param('id') id: string): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/suggestions/${encodeURIComponent(id)}/reopen`,
      {},
    );
  }

  @Post('agent/suggestions/:id/implement')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  implementAgentSuggestion(@Param('id') id: string): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/suggestions/${encodeURIComponent(id)}/implement`,
      {},
    );
  }

  @Get('agent/opportunities')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentOpportunities(
    @Query('limit') limit?: string,
    @Req() request?: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/opportunities', {
      params: { limit: limit ?? 20 },
      headers: identityHeaders(request?.user),
    });
  }

  @Get('agent/focus-universe/latest')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentFocusUniverseLatest(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/focus-universe/latest', {
      headers: identityHeaders(request.user),
    });
  }

  @Post('agent/focus-universe/run-offline')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentFocusUniverseRunOffline(
    @Query('limit') limit?: string,
    @Req() request?: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/focus-universe/run-offline?limit=${encodeURIComponent(limit ?? '80')}`,
      {},
      { headers: identityHeaders(request?.user) },
    );
  }

  @Post('agent/intelligence-batches')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentCreateIntelligenceBatch(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/intelligence-batches', body, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/intelligence-batches')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentListIntelligenceBatches(
    @Query('limit') limit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.proxy.get('traderAgent', `/agent/intelligence-batches${q}`, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/intelligence-batches/latest/research-report')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentGetLatestIntelligenceBatchResearchReport(
    @Req() request: AuthenticatedRequest,
    @Query('universe') universe?: string,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', `/agent/intelligence-batches/latest/research-report`, {
      headers: identityHeaders(request.user),
      params: { universe },
    });
  }

  @Get('agent/intelligence-batches/:id/research-report')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentGetIntelligenceBatchResearchReport(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/research-report`,
      { headers: identityHeaders(request.user) },
    );
  }

  @Get('agent/intelligence-batches/:id/results/by-sector')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentGetIntelligenceBatchResultsBySector(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/results/by-sector`,
      { headers: identityHeaders(request.user) },
    );
  }

  @Get('agent/intelligence-batches/:id')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentGetIntelligenceBatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', `/agent/intelligence-batches/${encodeURIComponent(id)}`, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/intelligence-batches/:id/results')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentGetIntelligenceBatchResults(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('preset') preset?: string,
    @Query('recommendation') recommendation?: string,
    @Query('thesisState') thesisState?: string,
    @Query('mlAvailable') mlAvailable?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ): Promise<unknown> {
    return this.proxy.get(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/results`,
      {
        headers: identityHeaders(request.user),
        params: {
          page,
          pageSize,
          q,
          preset,
          recommendation,
          thesisState,
          mlAvailable,
          sort,
          order,
        },
      },
    );
  }

  @Post('agent/intelligence-batches/:id/pause')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentPauseIntelligenceBatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/pause`,
      {},
      { headers: identityHeaders(request.user) },
    );
  }

  @Post('agent/intelligence-batches/:id/resume')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentResumeIntelligenceBatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/resume`,
      {},
      { headers: identityHeaders(request.user) },
    );
  }

  @Post('agent/intelligence-batches/:id/cancel')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentCancelIntelligenceBatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/cancel`,
      {},
      { headers: identityHeaders(request.user) },
    );
  }

  @Post('agent/intelligence-batches/:id/retry')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentRetryIntelligenceBatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/intelligence-batches/${encodeURIComponent(id)}/retry`,
      {},
      { headers: identityHeaders(request.user) },
    );
  }

  @Get('agent/continuous/events')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentContinuousEvents(
    @Query('limit') limit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.proxy.get('traderAgent', `/agent/continuous/events${q}`, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/continuous/position-plans')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentPositionPlans(
    @Query('limit') limit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.proxy.get('traderAgent', `/agent/continuous/position-plans${q}`, {
      headers: identityHeaders(request.user),
    });
  }

  @Post('agent/continuous/events')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentIngestContinuousEvent(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/continuous/events', body, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/analysis/:symbol')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentAnalysis(
    @Param('symbol') symbol: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', `/agent/analysis/${encodeURIComponent(symbol)}`, {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/positions')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentPositions(): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/positions');
  }

  @Get('agent/monitoring-logs')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentMonitoringLogs(
    @Query('limit') limit?: string,
    @Query('symbol') symbol?: string,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/monitoring-logs', {
      params: { limit: limit ?? 80, ...(symbol ? { symbol } : {}) },
    });
  }

  @Get('agent/portfolio')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentPortfolio(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/portfolio', {
      headers: identityHeaders(request.user),
    });
  }

  @Get('agent/transactions')
  @UseGuards(ViewsGuard)
  @Views(AppView.AGENT)
  agentTransactions(
    @Query('limit') limit?: string,
    @Req() request?: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.get('traderAgent', '/agent/transactions', {
      params: { limit: limit ?? 50 },
      headers: identityHeaders(request?.user),
    });
  }

  @Post('agent/recommendations/:id/approve')
  @UseGuards(JwtAuthGuard)
  approveAgentRecommendation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/recommendations/${encodeURIComponent(id)}/approve`,
      body,
      {
        headers: identityHeaders(request.user),
      },
    );
  }

  @Post('agent/recommendations/:id/wait')
  @UseGuards(JwtAuthGuard)
  waitAgentRecommendation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/recommendations/${encodeURIComponent(id)}/wait`,
      body,
      {
        headers: identityHeaders(request.user),
      },
    );
  }

  @Post('agent/recommendations/:id/reject')
  @UseGuards(JwtAuthGuard)
  rejectAgentRecommendation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post(
      'traderAgent',
      `/agent/recommendations/${encodeURIComponent(id)}/reject`,
      body,
      {
        headers: identityHeaders(request.user),
      },
    );
  }

  @Post('agent/broker-ready')
  @UseGuards(JwtAuthGuard)
  agentBrokerReady(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('traderAgent', '/agent/broker-ready', body);
  }

  // ------------------------------------------------------------ notifications

  @Get('notifications')
  getNotifications(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<unknown> {
    return this.proxy.get('notifications', '/notifications', { params: { limit } });
  }

  // ------------------------------------------------------------ broker configuration

  @Post('brokers/config')
  @UseGuards(ViewsGuard)
  @Views(AppView.BROKER_CONFIG)
  async configureBroker(
    @Body() dto: BrokerConfigDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('autoTrader', '/brokers/config', dto, {
      headers: identityHeaders(request.user),
    });
  }

  @Post('brokers/test')
  @UseGuards(ViewsGuard)
  @Views(AppView.BROKER_CONFIG)
  async testBrokerConnection(
    @Body() dto: BrokerTestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('autoTrader', '/brokers/test', dto, {
      headers: identityHeaders(request.user),
    });
  }
}
