import { Module } from '@nestjs/common';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AgentController],
  providers: [AgentService],
})
export class AppModule {}
