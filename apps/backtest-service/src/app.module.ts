import { Module } from '@nestjs/common';
import { BacktestController } from './backtest.controller';
import { BacktestService } from './backtest.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [BacktestController, HealthController],
  providers: [BacktestService],
})
export class AppModule {}
