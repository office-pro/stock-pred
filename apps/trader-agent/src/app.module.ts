import { Module } from '@nestjs/common';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { ContinuousIntelligenceStore } from './agent/continuous-intelligence-store';
import { IntelligenceBatchService } from './agent/intelligence-batch.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AgentController],
  providers: [AgentService, IntelligenceBatchService, ContinuousIntelligenceStore],
})
export class AppModule {}
