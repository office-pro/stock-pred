import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PatternsService } from './patterns.service';

@Controller()
export class PatternsController {
  constructor(private readonly patterns: PatternsService) {}

  @Get('patterns')
  getRecent(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<unknown[]> {
    return this.patterns.getRecentPatterns(Math.min(limit, 500));
  }

  @Get('patterns/:symbol')
  getForSymbol(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<unknown> {
    return this.patterns.getPatternsForSymbol(symbol.toUpperCase(), Math.min(limit, 200));
  }

  @Get('patterns/:symbol/analogs')
  getAnalogs(
    @Param('symbol') symbol: string,
    @Query('pattern') pattern?: string,
  ): Promise<unknown> {
    return this.patterns.getAnalog(symbol.toUpperCase(), pattern);
  }
}
