import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { getCorsOrigins, getEnvNumber } from '@stockpred/shared-utils';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: getCorsOrigins(), credentials: true });
  app.enableShutdownHooks();
  const port = getEnvNumber('NOTIFICATION_SERVICE_PORT', 3007);
  await app.listen(port);
  console.log(`[notification-service] listening on :${port}`);
}

void bootstrap();
