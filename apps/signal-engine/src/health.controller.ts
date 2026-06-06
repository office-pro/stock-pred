import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'signal-engine', uptime: process.uptime() };
  }
}
