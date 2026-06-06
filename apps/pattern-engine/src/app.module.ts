import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PatternsModule } from './patterns/patterns.module';

@Module({
  imports: [PatternsModule],
  controllers: [HealthController],
})
export class AppModule {}
