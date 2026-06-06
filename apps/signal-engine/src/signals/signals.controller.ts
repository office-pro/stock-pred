import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { SupportResistance } from '@stockpred/shared-types';
import { SignalsService } from './signals.service';

@Controller()
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get('signals')
  getRecent(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<unknown[]> {
    return this.signals.getRecentSignals(Math.min(limit, 500));
  }

  @Get('signals/:symbol')
  getForSymbol(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<unknown> {
    return this.signals.getSignalsForSymbol(symbol.toUpperCase(), Math.min(limit, 200));
  }

  @Get('support-resistance/:symbol')
  getSupportResistance(@Param('symbol') symbol: string): SupportResistance {
    return this.signals.getSupportResistance(symbol.toUpperCase());
  }
}
