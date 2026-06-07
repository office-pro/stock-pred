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
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt.guard';
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

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
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
  getStocks(): Promise<unknown> {
    return this.proxy.get('marketData', '/stocks');
  }

  @Get('stocks/:symbol')
  getStock(@Param('symbol') symbol: string): Promise<unknown> {
    return this.proxy.get('marketData', `/stocks/${encodeURIComponent(symbol)}`);
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
    @Query('benchmark') benchmark = 'NIFTY_MIDCAP_100',
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
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(await this.proxy.get('signalEngine', '/signals', { params: { limit } }));
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

  // ------------------------------------------------------------- predictions

  @Get('predictions')
  async getAllPredictions(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('mlEngine', '/predictions/all', { params: { limit } }),
    );
  }

  @Get('predictions/:symbol')
  async getPredictions(@Param('symbol') symbol: string): Promise<ApiResponse<unknown>> {
    return withDisclaimer(
      await this.proxy.get('mlEngine', `/predictions/${encodeURIComponent(symbol)}`),
    );
  }

  // ---------------------------------------------------------------- backtest

  @Post('backtest')
  @UseGuards(JwtAuthGuard)
  async runBacktest(@Body() dto: BacktestRequestDto): Promise<ApiResponse<unknown>> {
    return withDisclaimer(await this.proxy.post('backtest', '/backtest', dto));
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRADER, UserRole.ADMIN)
  executeTrade(
    @Body() dto: ExecuteTradeRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.proxy.post('autoTrader', '/trade/execute', dto, {
      headers: { 'x-user-id': request.user.sub },
    });
  }

  @Get('portfolio')
  @UseGuards(JwtAuthGuard)
  getPortfolio(): Promise<unknown> {
    return this.proxy.get('autoTrader', '/portfolio');
  }

  @Get('trades')
  @UseGuards(JwtAuthGuard)
  getTrades(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50): Promise<unknown> {
    return this.proxy.get('autoTrader', '/trades', { params: { limit } });
  }

  @Post('circuit-breaker/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  resetCircuitBreaker(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.proxy.post('autoTrader', '/circuit-breaker/reset', undefined, {
      headers: { 'x-user-id': request.user.sub },
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
