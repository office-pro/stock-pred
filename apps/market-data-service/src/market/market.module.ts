import { Module } from '@nestjs/common';
import { CandleCache } from './candle-cache';
import { FundamentalsStore } from './fundamentals-store';
import { AltDataStore } from './alt-data-store';
import { KafkaProducerService } from './kafka.service';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { RedisService } from './redis.service';

@Module({
  controllers: [MarketController],
  providers: [
    MarketService,
    KafkaProducerService,
    RedisService,
    CandleCache,
    FundamentalsStore,
    AltDataStore,
  ],
})
export class MarketModule {}
