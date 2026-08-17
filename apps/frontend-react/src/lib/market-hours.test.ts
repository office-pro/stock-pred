import { isNseRegularSession } from './market-hours';

describe('isNseRegularSession', () => {
  it('is open on a weekday during cash hours (IST)', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
  });

  it('is closed on Saturday', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 15, 5, 30, 0))).toBe(false);
  });
});
