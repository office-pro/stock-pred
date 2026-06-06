import { RiskLimits } from '@stockpred/shared-types';

export interface RiskCheck {
  tripped: boolean;
  reason: string | null;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO week key (year-week). */
function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

/**
 * Drawdown circuit breaker (spec: 1% per-trade risk, 3% daily DD, 8% weekly DD).
 * Anchors equity at the start of each day/week; trips when the drawdown
 * from the anchor exceeds the configured limit. Trading stays disabled
 * until the breaker resets (new period, or manual admin reset).
 */
export class RiskManager {
  private dayAnchor: { key: string; equity: number } | null = null;
  private weekAnchor: { key: string; equity: number } | null = null;
  private trippedReason: string | null = null;

  constructor(readonly limits: RiskLimits) {}

  get isTripped(): boolean {
    return this.trippedReason !== null;
  }

  get reason(): string | null {
    return this.trippedReason;
  }

  /** Feed the latest portfolio equity; returns the current breaker state. */
  evaluate(equity: number, now: Date): RiskCheck {
    const dk = dayKey(now);
    const wk = weekKey(now);

    if (!this.dayAnchor || this.dayAnchor.key !== dk) {
      this.dayAnchor = { key: dk, equity };
      // A new day clears a daily trip (weekly trips persist for the week).
      if (this.trippedReason?.startsWith('DAILY')) this.trippedReason = null;
    }
    if (!this.weekAnchor || this.weekAnchor.key !== wk) {
      this.weekAnchor = { key: wk, equity };
      if (this.trippedReason?.startsWith('WEEKLY')) this.trippedReason = null;
    }

    if (this.trippedReason === null) {
      const dailyDd =
        this.dayAnchor.equity > 0
          ? ((this.dayAnchor.equity - equity) / this.dayAnchor.equity) * 100
          : 0;
      const weeklyDd =
        this.weekAnchor.equity > 0
          ? ((this.weekAnchor.equity - equity) / this.weekAnchor.equity) * 100
          : 0;
      if (weeklyDd >= this.limits.weeklyDrawdownPercent) {
        this.trippedReason = `WEEKLY_DRAWDOWN ${weeklyDd.toFixed(2)}% >= ${this.limits.weeklyDrawdownPercent}%`;
      } else if (dailyDd >= this.limits.dailyDrawdownPercent) {
        this.trippedReason = `DAILY_DRAWDOWN ${dailyDd.toFixed(2)}% >= ${this.limits.dailyDrawdownPercent}%`;
      }
    }

    return { tripped: this.isTripped, reason: this.trippedReason };
  }

  /** Manual reset (admin action, audited by the caller). */
  reset(): void {
    this.trippedReason = null;
    this.dayAnchor = null;
    this.weekAnchor = null;
  }
}
