import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiController } from './api/api.controller';
import { AuthProxyController } from './api/auth-proxy.controller';
import { ProxyService } from './api/proxy.service';
import { JwtAuthGuard } from './auth/jwt.guard';
import { RolesGuard } from './auth/roles.guard';
import { EventsGateway } from './events/events.gateway';
import { KafkaBridgeService } from './events/kafka-bridge.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Rate limiting (security spec): 120 requests/min per client by default.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [ApiController, AuthProxyController, HealthController],
  providers: [
    ProxyService,
    EventsGateway,
    KafkaBridgeService,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
