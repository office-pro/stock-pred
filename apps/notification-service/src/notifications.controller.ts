import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('health')
  health(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'notification-service', uptime: process.uptime() };
  }

  @Get('notifications')
  list(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50): Promise<unknown[]> {
    return this.notifications.getNotifications(Math.min(limit, 200));
  }
}
