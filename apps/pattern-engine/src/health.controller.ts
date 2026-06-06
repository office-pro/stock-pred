import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'pattern-engine', uptime: process.uptime() };
  }
}
