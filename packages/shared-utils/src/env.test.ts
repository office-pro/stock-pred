import {
  getAppEnv,
  getEnv,
  getEnvBool,
  getEnvNumber,
  getKafkaBrokers,
  getKafkaClientId,
  getKafkaSecurityProtocol,
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

  it('requires database and redis URLs', () => {
    expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL/);
    expect(() => requireRedisUrl()).toThrow(/REDIS_URL/);
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(requireDatabaseUrl()).toBe('postgresql://u:p@h/db');
    expect(requireRedisUrl()).toBe('redis://localhost:6379');
  });

  it('parses Kafka brokers and defaults', () => {
    expect(getKafkaBrokers()).toEqual(['localhost:29092']);
    process.env.KAFKA_BROKERS = 'a:9092, b:9092';
    expect(getKafkaBrokers()).toEqual(['a:9092', 'b:9092']);
    expect(getKafkaClientId()).toBe('stockpred');
    expect(getKafkaSecurityProtocol()).toBe('PLAINTEXT');
  });
});
