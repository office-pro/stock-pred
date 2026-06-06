import { Module } from '@nestjs/common';
import { CandleStore } from './candle-store';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';

@Module({
  controllers: [SignalsController],
  providers: [SignalsService, CandleStore],
})
export class SignalsModule {}
