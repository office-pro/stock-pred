import { isDatabaseUnavailable } from './prisma-errors';

describe('isDatabaseUnavailable', () => {
  it('detects Prisma auth failures', () => {
    expect(
      isDatabaseUnavailable({
        name: 'PrismaClientInitializationError',
        message: 'Authentication failed against database server',
      }),
    ).toBe(true);
  });

  it('ignores ordinary login misses', () => {
    expect(isDatabaseUnavailable(new Error('Invalid credentials'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});
