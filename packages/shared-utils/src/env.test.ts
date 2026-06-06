import { getEnv, getEnvBool, getEnvNumber } from './env';

describe('env helpers', () => {
  afterEach(() => {
    delete process.env.STOCKPRED_TEST_VAR;
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
});
