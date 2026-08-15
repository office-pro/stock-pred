import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { SupportResistance } from '@stockpred/shared-types';
import { SignalsService } from './signals.service';

@Controller()
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get('signals')
  async getSignals(
    @Query('all', new DefaultValuePipe(false)) allSignals: boolean,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('signal') signal?: string,
  ): Promise<unknown> {
    return this.signals.getSignalsPaginated(page, Math.min(limit, 500), search, signal, allSignals);
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
