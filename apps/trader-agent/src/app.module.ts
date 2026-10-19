import { Module } from '@nestjs/common';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { ContinuousIntelligenceStore } from './agent/continuous-intelligence-store';
import { IntelligenceBatchService } from './agent/intelligence-batch.service';
import { MiCoverageService } from './agent/mi-coverage.service';
import { MiCombinedPreflightService } from './agent/mi-combined-preflight.service';
import { MiBatchSnapshotService } from './agent/mi-batch-snapshot.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AgentController],
  providers: [
    AgentService,
    IntelligenceBatchService,
    ContinuousIntelligenceStore,
    MiCoverageService,
    MiCombinedPreflightService,
    MiBatchSnapshotService,
  ],
})
export class AppModule {}
