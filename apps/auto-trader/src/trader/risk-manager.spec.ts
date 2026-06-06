import { RiskManager } from './risk-manager';

const LIMITS = { perTradeRiskPercent: 1, dailyDrawdownPercent: 3, weeklyDrawdownPercent: 8 };

describe('RiskManager', () => {
  it('stays healthy under small drawdowns', () => {
    const rm = new RiskManager(LIMITS);
    const day = new Date('2026-06-01T09:30:00Z');
    expect(rm.evaluate(1_000_000, day).tripped).toBe(false);
    expect(rm.evaluate(985_000, day).tripped).toBe(false); // -1.5%
    expect(rm.isTripped).toBe(false);
  });

  it('trips the daily breaker at 3% drawdown', () => {
    const rm = new RiskManager(LIMITS);
    const day = new Date('2026-06-01T09:30:00Z');
    rm.evaluate(1_000_000, day);
    const check = rm.evaluate(969_000, day); // -3.1%
    expect(check.tripped).toBe(true);
    expect(check.reason).toContain('DAILY_DRAWDOWN');
  });

  it('clears a daily trip on the next day', () => {
    const rm = new RiskManager(LIMITS);
    rm.evaluate(1_000_000, new Date('2026-06-01T09:30:00Z'));
    rm.evaluate(965_000, new Date('2026-06-01T15:00:00Z'));
    expect(rm.isTripped).toBe(true);
    const next = rm.evaluate(965_000, new Date('2026-06-02T09:30:00Z'));
    expect(next.tripped).toBe(false);
  });

  it('trips the weekly breaker at 8% and persists across days in the week', () => {
    const rm = new RiskManager(LIMITS);
    rm.evaluate(1_000_000, new Date('2026-06-01T09:30:00Z')); // Monday
    const tripped = rm.evaluate(915_000, new Date('2026-06-02T09:30:00Z')); // -8.5% from week anchor
    expect(tripped.tripped).toBe(true);
    expect(tripped.reason).toContain('WEEKLY_DRAWDOWN');
    // Still tripped later in the same week even if equity recovers slightly.
    const later = rm.evaluate(930_000, new Date('2026-06-04T09:30:00Z'));
    expect(later.tripped).toBe(true);
    // New week resets.
    const nextWeek = rm.evaluate(930_000, new Date('2026-06-08T09:30:00Z'));
    expect(nextWeek.tripped).toBe(false);
  });

  it('supports manual reset', () => {
    const rm = new RiskManager(LIMITS);
    const day = new Date('2026-06-01T09:30:00Z');
    rm.evaluate(1_000_000, day);
    rm.evaluate(900_000, day);
    expect(rm.isTripped).toBe(true);
    rm.reset();
    expect(rm.isTripped).toBe(false);
  });
});
