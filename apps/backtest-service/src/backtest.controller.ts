import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BacktestResult, BacktestYears, ScannerBacktestSummary } from '@stockpred/shared-types';
import { BacktestService } from './backtest.service';

export class BacktestDto {
  @IsString()
  @MaxLength(20)
  symbol!: string;

  @IsIn([1, 3, 5, 10])
  years!: BacktestYears;

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

export class ScannerBacktestDto {
  @IsString()
  @MaxLength(20)
  symbol!: string;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(95)
  minBullScore?: number;
}

@Controller()
export class BacktestController {
  constructor(private readonly backtest: BacktestService) {}

  @Post('backtest')
  run(@Body() dto: BacktestDto): Promise<BacktestResult> {
    return this.backtest.run(dto);
  }

  @Post('backtest/scanner')
  runScanner(@Body() dto: ScannerBacktestDto): Promise<ScannerBacktestSummary> {
    return this.backtest.runScanner(dto.symbol, dto.minBullScore ?? 70);
  }

  @Get('backtest/history')
  history(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20): Promise<unknown[]> {
    return this.backtest.getHistory(Math.min(limit, 100));
  }
}
