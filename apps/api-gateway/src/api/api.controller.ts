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
import { ApiResponse, TradeSide, UserRole, withDisclaimer } from '@stockpred/shared-types';
import { AuthenticatedRequest, JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
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
  @IsIn(['train_all', 'predict_all', 'train_manipulation'])
  kind!: string;

  @IsOptional()
  @IsIn(['nifty50', 'nifty100', 'nifty500', 'smallcap', 'all'])
  universe?: string;
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
export class ApiController {
  constructor(private readonly proxy: ProxyService) {}

  // ------------------------------------------------------------ market data

  @Get('stocks')
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

  @Get('indices')
  getIndices(): Promise<unknown> {
    return this.proxy.get('marketData', '/indices');
  }

  @Get('market/context')
  getMarketContext(): Promise<unknown> {
    return this.proxy.get('marketData', '/market/context');
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
  @UseGuards(OptionalJwtAuthGuard)
  executeTrade(
    @Body() dto: ExecuteTradeRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('autoTrader', '/trade/execute', dto, {
      headers: request.user?.sub ? { 'x-user-id': request.user.sub } : undefined,
    });
  }

  @Get('portfolio')
  getPortfolio(): Promise<unknown> {
    return this.proxy.get('autoTrader', '/portfolio');
  }

  @Get('trades')
  getTrades(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50): Promise<unknown> {
    return this.proxy.get('autoTrader', '/trades', { params: { limit } });
  }

  @Post('circuit-breaker/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  resetCircuitBreaker(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.post('autoTrader', '/circuit-breaker/reset', undefined, {
      headers: { 'x-user-id': request.user?.sub ?? 'unknown-admin' },
    });
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
  async configureBroker(@Body() dto: BrokerConfigDto): Promise<unknown> {
    return this.proxy.post('autoTrader', '/brokers/config', dto);
  }

  @Post('brokers/test')
  async testBrokerConnection(@Body() dto: BrokerTestDto): Promise<unknown> {
    return this.proxy.post('autoTrader', '/brokers/test', dto);
  }
}
