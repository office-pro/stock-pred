import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { TraderModule } from './trader/trader.module';

@Module({
  imports: [TraderModule],
  controllers: [HealthController],
})
export class AppModule {}
