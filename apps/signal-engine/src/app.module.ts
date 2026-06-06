import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SignalsModule } from './signals/signals.module';

@Module({
  imports: [SignalsModule],
  controllers: [HealthController],
})
export class AppModule {}
