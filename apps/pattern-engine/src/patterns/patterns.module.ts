import { Module } from '@nestjs/common';
import { CandleStore } from './candle-store';
import { PatternsController } from './patterns.controller';
import { PatternsService } from './patterns.service';

@Module({
  controllers: [PatternsController],
  providers: [PatternsService, CandleStore],
})
export class PatternsModule {}
