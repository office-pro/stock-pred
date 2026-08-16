import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { getCorsOrigins, getEnvNumber } from '@stockpred/shared-utils';
import { AppModule } from './app.module';
import { loadLocalEnv } from './load-env';

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl.replace(/^postgresql:/, 'http:'));
      console.log(
        `[auth-service] database ${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`,
      );
    } catch {
      console.log('[auth-service] DATABASE_URL is set');
    }
  }
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
