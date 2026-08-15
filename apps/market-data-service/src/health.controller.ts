import { Controller, Get } from '@nestjs/common';
import { getOrchestrator } from './market/real-time-orchestrator';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'market-data-service', uptime: process.uptime() };
  }

  @Get('orchestrator')
  orchestrator(): {
    queueSize: number;
    activeTasks: number;
    metrics: { processed: number; failed: number; avgLatency: number };
  } {
    const orch = getOrchestrator();
    return orch.getStatus();
  }
}
