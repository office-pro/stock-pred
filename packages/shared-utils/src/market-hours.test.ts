import { isNseRegularSession } from './market-hours';

describe('isNseRegularSession', () => {
  it('is open on a weekday during cash hours (IST)', () => {
    // Friday 14 Aug 2026, 10:00 IST = 04:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 4, 30, 0))).toBe(true);
  });

  it('opens at 09:15 IST and stays closed just before', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 44, 0))).toBe(false);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 3, 45, 0))).toBe(true);
  });

  it('closes after 15:30 IST', () => {
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 0, 0))).toBe(true);
    expect(isNseRegularSession(Date.UTC(2026, 7, 14, 10, 1, 0))).toBe(false);
  });

  it('is closed on weekends', () => {
    // Saturday 15 Aug 2026, 11:00 IST = 05:30 UTC
    expect(isNseRegularSession(Date.UTC(2026, 7, 15, 5, 30, 0))).toBe(false);
    // Sunday 16 Aug 2026, 11:00 IST
    expect(isNseRegularSession(Date.UTC(2026, 7, 16, 5, 30, 0))).toBe(false);
  });
});
