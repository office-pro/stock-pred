import { Module } from '@nestjs/common';
import { CandleCache } from './candle-cache';
import { FundamentalsStore } from './fundamentals-store';
import { AltDataStore } from './alt-data-store';
import { CorporateStore } from './corporate-store';
import { KafkaProducerService } from './kafka.service';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { RedisService } from './redis.service';
import { B9B17IntelligenceService } from './b9-b17-intelligence.service';

@Module({
  controllers: [MarketController],
  providers: [
    MarketService,
    KafkaProducerService,
    RedisService,
    CandleCache,
    FundamentalsStore,
    AltDataStore,
    CorporateStore,
    B9B17IntelligenceService,
  ],
})
export class MarketModule {}
