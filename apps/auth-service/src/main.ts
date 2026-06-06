import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { getCorsOrigins, getEnvNumber } from '@stockpred/shared-utils';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: getCorsOrigins(), credentials: true });
  app.enableShutdownHooks();
  const port = getEnvNumber('AUTH_SERVICE_PORT', 3001);
  await app.listen(port);
  console.log(`[auth-service] listening on :${port}`);
}

void bootstrap();
