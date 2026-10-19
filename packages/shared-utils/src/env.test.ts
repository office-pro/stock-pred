import {
  getAppEnv,
  getEnv,
  getEnvBool,
  getEnvNumber,
  getKafkaBrokers,
  getKafkaClientId,
  getKafkaSecurityProtocol,
  getRedisMode,
  getRedisUrl,
  requireDatabaseUrl,
  requireRedisUrl,
} from './env';

describe('env helpers', () => {
  afterEach(() => {
    delete process.env.STOCKPRED_TEST_VAR;
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_MODE;
    delete process.env.REDIS_LOCAL_URL;
    delete process.env.REDIS_CLOUD_URL;
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_CLIENT_ID;
    delete process.env.KAFKA_SECURITY_PROTOCOL;
  });

  it('reads existing variables', () => {
    process.env.STOCKPRED_TEST_VAR = 'hello';
    expect(getEnv('STOCKPRED_TEST_VAR')).toBe('hello');
  });

  it('falls back and throws appropriately', () => {
    expect(getEnv('STOCKPRED_TEST_VAR', 'fallback')).toBe('fallback');
    expect(() => getEnv('STOCKPRED_TEST_VAR')).toThrow(/Missing required/);
  });

  it('parses numbers with validation', () => {
    process.env.STOCKPRED_TEST_VAR = '42';
    expect(getEnvNumber('STOCKPRED_TEST_VAR', 0)).toBe(42);
    process.env.STOCKPRED_TEST_VAR = 'oops';
    expect(() => getEnvNumber('STOCKPRED_TEST_VAR', 0)).toThrow(/not a number/);
    delete process.env.STOCKPRED_TEST_VAR;
    expect(getEnvNumber('STOCKPRED_TEST_VAR', 7)).toBe(7);
  });

  it('parses booleans', () => {
    process.env.STOCKPRED_TEST_VAR = 'true';
    expect(getEnvBool('STOCKPRED_TEST_VAR', false)).toBe(true);
    process.env.STOCKPRED_TEST_VAR = '0';
    expect(getEnvBool('STOCKPRED_TEST_VAR', true)).toBe(false);
    delete process.env.STOCKPRED_TEST_VAR;
    expect(getEnvBool('STOCKPRED_TEST_VAR', true)).toBe(true);
  });

  it('resolves APP_ENV without provider-specific logic', () => {
    process.env.APP_ENV = 'staging';
    expect(getAppEnv()).toBe('staging');
    delete process.env.APP_ENV;
    process.env.NODE_ENV = 'production';
    expect(getAppEnv()).toBe('production');
  });

  it('requires database URL independently of Redis', () => {
    expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    expect(requireDatabaseUrl()).toBe('postgresql://u:p@h/db');
  });

  it('default REDIS_MODE resolves local Redis', () => {
    expect(getRedisMode()).toBe('default');
    expect(getRedisUrl()).toBe('redis://localhost:6379');
    process.env.REDIS_LOCAL_URL = 'redis://redis:6379';
    expect(getRedisUrl()).toBe('redis://redis:6379');
    expect(requireRedisUrl()).toBe('redis://redis:6379');
  });

  it('test-cloud REDIS_MODE resolves REDIS_CLOUD_URL', () => {
    process.env.REDIS_MODE = 'test-cloud';
    process.env.REDIS_CLOUD_URL = 'rediss://default:token@example.upstash.io:6379';
    expect(getRedisMode()).toBe('test-cloud');
    expect(getRedisUrl()).toBe('rediss://default:token@example.upstash.io:6379');
  });

  it('rejects invalid REDIS_MODE', () => {
    process.env.REDIS_MODE = 'prod';
    expect(() => getRedisMode()).toThrow(/Invalid REDIS_MODE/);
    expect(() => getRedisUrl()).toThrow(/Invalid REDIS_MODE/);
  });

  it('test-cloud without REDIS_CLOUD_URL throws', () => {
    process.env.REDIS_MODE = 'test-cloud';
    expect(() => getRedisUrl()).toThrow(/REDIS_CLOUD_URL/);
  });

  it('REDIS_MODE does not alter DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://local/db';
    process.env.REDIS_MODE = 'default';
    expect(requireDatabaseUrl()).toBe('postgresql://local/db');
    expect(getRedisUrl()).toBe('redis://localhost:6379');

    process.env.REDIS_MODE = 'test-cloud';
    process.env.REDIS_CLOUD_URL = 'rediss://cloud/redis';
    expect(requireDatabaseUrl()).toBe('postgresql://local/db');
    expect(getRedisUrl()).toBe('rediss://cloud/redis');
  });

  it('parses Kafka brokers and defaults', () => {
    expect(getKafkaBrokers()).toEqual(['localhost:29092']);
    process.env.KAFKA_BROKERS = 'a:9092, b:9092';
    expect(getKafkaBrokers()).toEqual(['a:9092', 'b:9092']);
    expect(getKafkaClientId()).toBe('stockpred');
    expect(getKafkaSecurityProtocol()).toBe('PLAINTEXT');
  });
});
