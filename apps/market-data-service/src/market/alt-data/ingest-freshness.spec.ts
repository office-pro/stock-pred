import {
  FUNDAMENTALS_MAX_AGE_MS,
  isFundamentalsFresh,
  isIstSessionAsOf,
  istSessionUtcDay,
  parseFullFlag,
} from './ingest-freshness';

describe('ingest freshness', () => {
  it('maps pre-UTC-midnight IST onto the India calendar date', () => {
    const beforeUtcMidnight = new Date('2024-08-18T19:00:00.000Z'); // 00:30 IST Aug 19
    expect(istSessionUtcDay(beforeUtcMidnight).toISOString()).toBe('2024-08-19T00:00:00.000Z');
    const afternoonUtc = new Date('2024-08-19T12:00:00.000Z');
    expect(istSessionUtcDay(afternoonUtc).toISOString()).toBe('2024-08-19T00:00:00.000Z');
  });

  it('treats fundamentals as fresh within seven days', () => {
    const now = new Date('2024-08-19T10:00:00.000Z');
    expect(isFundamentalsFresh(new Date(now.getTime() - 3 * 86_400_000), now)).toBe(true);
    expect(isFundamentalsFresh(new Date(now.getTime() - FUNDAMENTALS_MAX_AGE_MS - 1), now)).toBe(
      false,
    );
    expect(isFundamentalsFresh(null, now)).toBe(false);
  });

  it('matches a daily row to today IST session', () => {
    const now = new Date('2024-08-19T12:00:00.000Z');
    expect(isIstSessionAsOf(new Date('2024-08-19T00:00:00.000Z'), now)).toBe(true);
    expect(isIstSessionAsOf(new Date('2024-08-18T00:00:00.000Z'), now)).toBe(false);
  });

  it('parses the full rebuild flag', () => {
    expect(parseFullFlag('1')).toBe(true);
    expect(parseFullFlag('true')).toBe(true);
    expect(parseFullFlag(undefined)).toBe(false);
    expect(parseFullFlag('0')).toBe(false);
  });
});
