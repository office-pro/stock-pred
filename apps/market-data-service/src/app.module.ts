import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MarketModule } from './market/market.module';

@Module({
  imports: [MarketModule],
  controllers: [HealthController],
})
export class AppModule {}
