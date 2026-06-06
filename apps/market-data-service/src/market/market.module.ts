import { Module } from '@nestjs/common';
import { CandleCache } from './candle-cache';
import { KafkaProducerService } from './kafka.service';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { RedisService } from './redis.service';

@Module({
  controllers: [MarketController],
  providers: [MarketService, KafkaProducerService, RedisService, CandleCache],
})
export class MarketModule {}
