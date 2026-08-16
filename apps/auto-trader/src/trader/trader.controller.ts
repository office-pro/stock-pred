import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExecutedTrade, PortfolioSnapshot, TradeSide } from '@stockpred/shared-types';
import { TraderService } from './trader.service';

export class ExecuteTradeDto {
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

@Controller()
export class TraderController {
  constructor(private readonly trader: TraderService) {}

  @Get('portfolio')
  portfolio(): Promise<PortfolioSnapshot> {
    return this.trader.getPortfolio();
  }

  @Get('trades')
  trades(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50): Promise<unknown[]> {
    return this.trader.getTrades(Math.min(limit, 500));
  }

  @Post('trade/execute')
  execute(
    @Body() dto: ExecuteTradeDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<ExecutedTrade> {
    return this.trader.executeManualTrade({
      symbol: dto.symbol,
      side: dto.side,
      quantity: dto.quantity,
      price: dto.price,
      target: dto.target,
      stopLoss: dto.stopLoss,
      userId,
    });
  }

  @Post('circuit-breaker/reset')
  resetBreaker(@Headers('x-user-id') userId?: string): { reset: boolean } {
    this.trader.resetCircuitBreaker(userId ?? 'unknown-admin');
    return { reset: true };
  }

  @Post('brokers/config')
  async configureBroker(
    @Body() dto: BrokerConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    return this.trader.configureBroker(dto.brokerType, dto.credentials);
  }

  @Post('brokers/test')
  async testBroker(@Body() dto: BrokerTestDto): Promise<{ success: boolean; message: string }> {
    return this.trader.testBrokerConnection(dto.brokerType);
  }
}
