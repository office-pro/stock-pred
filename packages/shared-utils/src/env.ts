/** Environment access helpers - secrets must only ever come from env vars. */

export type AppEnv = 'development' | 'production' | 'test' | 'staging';

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} is not a number: ${value}`);
  }
  return parsed;
}

export function getEnvBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * CORS_ORIGIN supports a comma-separated list so the built frontend (:8080)
 * and the Vite dev server (:5173) can both talk to the services.
 */
export function getCorsOrigins(fallback = 'http://localhost:8080,http://localhost:5173'): string[] {
  return getEnv('CORS_ORIGIN', fallback)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Logical app environment (prefer APP_ENV, else NODE_ENV). Provider-agnostic. */
export function getAppEnv(fallback: AppEnv = 'development'): AppEnv {
  const raw = (process.env.APP_ENV || process.env.NODE_ENV || fallback).toLowerCase();
  if (raw === 'production' || raw === 'test' || raw === 'staging' || raw === 'development') {
    return raw;
  }
  return fallback;
}

/** Required Postgres URL (local Docker, managed cloud, etc. — config only). */
export function requireDatabaseUrl(): string {
  return getEnv('DATABASE_URL');
}

/** Required Redis URL (local Docker, managed cloud, etc. — config only). */
export function requireRedisUrl(): string {
  return getEnv('REDIS_URL');
}

/** Comma-separated Kafka brokers → array. */
export function getKafkaBrokers(fallback = 'localhost:29092'): string[] {
  return getEnv('KAFKA_BROKERS', fallback)
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

export function getKafkaClientId(fallback = 'stockpred'): string {
  return getEnv('KAFKA_CLIENT_ID', fallback);
}

/** PLAINTEXT locally; SASL_SSL (etc.) via env for managed Kafka later. */
export function getKafkaSecurityProtocol(fallback = 'PLAINTEXT'): string {
  return getEnv('KAFKA_SECURITY_PROTOCOL', fallback);
}

export function getKafkaUsername(): string | undefined {
  const value = process.env.KAFKA_USERNAME;
  return value && value.length > 0 ? value : undefined;
}

export function getKafkaPassword(): string | undefined {
  const value = process.env.KAFKA_PASSWORD;
  return value && value.length > 0 ? value : undefined;
}
