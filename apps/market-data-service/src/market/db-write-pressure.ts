/**
 * Adaptive DB write pressure for MDS CandleCache / bootstrap.
 * Bootstrap (low priority) backs off or pauses; high-priority API writes continue
 * through the existing max-2 limiter.
 */

export type WritePriority = 'high' | 'low';
export type PressureLevel = 'healthy' | 'degraded' | 'paused';

export type PressureSnapshot = {
  level: PressureLevel;
  recentFailures: number;
  consecutiveSuccesses: number;
  bootstrapPaused: boolean;
  lastFailureMs: number | null;
  lastSuccessMs: number | null;
};

export type DbWritePressureOptions = {
  /** Failures in window that enter degraded (default 1). */
  degradeAfterFailures?: number;
  /** Failures in window that pause bootstrap (default 2). */
  pauseAfterFailures?: number;
  /** Sliding window for failure counting (default 60s). */
  failureWindowMs?: number;
  /** Successes needed to leave paused → degraded (default 3). */
  recoverFromPausedSuccesses?: number;
  /** Successes needed to leave degraded → healthy (default 5). */
  recoverToHealthySuccesses?: number;
  /** Extra delay between bootstrap batches when degraded (default 2s). */
  degradedBootstrapDelayMs?: number;
  /** Poll interval while bootstrap is paused (default 2s). */
  pausePollMs?: number;
  /** Quiet time after last failure before recovery can complete (default 10s). */
  quietMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DbWritePressureTracker {
  private level: PressureLevel = 'healthy';
  private failureTimes: number[] = [];
  private consecutiveSuccesses = 0;
  private lastFailureMs: number | null = null;
  private lastSuccessMs: number | null = null;
  private bootstrapGateHeld = false;
  private forceHoldUntilMs: number | null = null;
  private readonly degradeAfterFailures: number;
  private readonly pauseAfterFailures: number;
  private readonly failureWindowMs: number;
  private readonly recoverFromPausedSuccesses: number;
  private readonly recoverToHealthySuccesses: number;
  private readonly degradedBootstrapDelayMs: number;
  private readonly pausePollMs: number;
  private readonly quietMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(opts: DbWritePressureOptions = {}) {
    this.degradeAfterFailures = opts.degradeAfterFailures ?? 1;
    this.pauseAfterFailures = opts.pauseAfterFailures ?? 2;
    this.failureWindowMs = opts.failureWindowMs ?? 60_000;
    this.recoverFromPausedSuccesses = opts.recoverFromPausedSuccesses ?? 3;
    this.recoverToHealthySuccesses = opts.recoverToHealthySuccesses ?? 5;
    this.degradedBootstrapDelayMs = opts.degradedBootstrapDelayMs ?? 2_000;
    this.pausePollMs = opts.pausePollMs ?? 2_000;
    this.quietMs = opts.quietMs ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  getLevel(): PressureLevel {
    return this.level;
  }

  snapshot(): PressureSnapshot {
    this.pruneFailures(this.now());
    return {
      level: this.level,
      recentFailures: this.failureTimes.length,
      consecutiveSuccesses: this.consecutiveSuccesses,
      bootstrapPaused: this.level === 'paused',
      lastFailureMs: this.lastFailureMs,
      lastSuccessMs: this.lastSuccessMs,
    };
  }

  /** Forced pause for runtime validation (MDS_DB_PRESSURE_SIMULATE_MS). */
  async simulatePressure(durationMs: number): Promise<void> {
    if (durationMs <= 0) return;
    const until = this.now() + durationMs;
    this.forceHoldUntilMs = until;
    this.enterPaused('SIMULATE');
    while (this.now() < until) {
      await this.sleep(Math.min(500, until - this.now()));
    }
    this.forceHoldUntilMs = null;
    this.consecutiveSuccesses = this.recoverToHealthySuccesses;
    this.lastFailureMs = this.now() - this.quietMs - 1;
    this.failureTimes = [];
    this.enterHealthy('SIMULATE_CLEAR');
  }

  recordPoolPressureFailure(nowMs: number = this.now()): void {
    if (this.forceHoldUntilMs != null && nowMs < this.forceHoldUntilMs) {
      // Keep simulated hold; still count for observability.
    }
    this.failureTimes.push(nowMs);
    this.lastFailureMs = nowMs;
    this.consecutiveSuccesses = 0;
    this.pruneFailures(nowMs);
    const count = this.failureTimes.length;
    if (count >= this.pauseAfterFailures) {
      this.enterPaused('POOL_TIMEOUT');
    } else if (count >= this.degradeAfterFailures) {
      this.enterDegraded('POOL_TIMEOUT');
    }
  }

  recordWriteSuccess(nowMs: number = this.now()): void {
    this.lastSuccessMs = nowMs;
    this.consecutiveSuccesses += 1;
    this.pruneFailures(nowMs);
    if (this.forceHoldUntilMs != null && nowMs < this.forceHoldUntilMs) {
      // Validation hold: high-priority traffic may succeed, but bootstrap stays paused.
      return;
    }
    const quietOk = this.lastFailureMs == null || nowMs - this.lastFailureMs >= this.quietMs;

    if (this.level === 'paused') {
      if (this.consecutiveSuccesses >= this.recoverFromPausedSuccesses && quietOk) {
        this.enterDegraded('RECOVERING');
      }
      return;
    }
    if (this.level === 'degraded') {
      if (this.consecutiveSuccesses >= this.recoverToHealthySuccesses && quietOk) {
        this.enterHealthy('RECOVERED');
      }
    }
  }

  /**
   * Low-priority (bootstrap) persistence gate.
   * Returns skip when paused so callers remain non-fatal.
   */
  async beforeLowPriorityWrite(): Promise<'proceed' | 'skip'> {
    if (this.level === 'paused') {
      return 'skip';
    }
    if (this.level === 'degraded') {
      await this.sleep(this.degradedBootstrapDelayMs);
    }
    return 'proceed';
  }

  /** Call between bootstrap batches — pauses until pressure clears. */
  async awaitBootstrapGate(): Promise<void> {
    if (this.level === 'healthy') {
      if (this.bootstrapGateHeld) {
        this.bootstrapGateHeld = false;
        this.log('[DB-PRESSURE] bootstrap_resumed reason=HEALTHY');
      }
      return;
    }

    if (this.level === 'degraded') {
      if (this.bootstrapGateHeld) {
        this.bootstrapGateHeld = false;
        this.log('[DB-PRESSURE] bootstrap_resumed reason=DEGRADED_SLOW');
      }
      this.log(
        `[DB-PRESSURE] bootstrap_backoff level=degraded delay_ms=${this.degradedBootstrapDelayMs}`,
      );
      await this.sleep(this.degradedBootstrapDelayMs);
      return;
    }

    // paused
    if (!this.bootstrapGateHeld) {
      this.bootstrapGateHeld = true;
      this.log('[DB-PRESSURE] bootstrap_paused reason=DB_PRESSURE');
    }
    while (this.level === 'paused') {
      await this.sleep(this.pausePollMs);
      const nowMs = this.now();
      if (this.forceHoldUntilMs != null && nowMs < this.forceHoldUntilMs) {
        continue;
      }
      // Time-based recovery if writes are idle (high-priority may still succeed elsewhere).
      this.pruneFailures(nowMs);
      if (
        this.failureTimes.length === 0 &&
        this.lastFailureMs != null &&
        nowMs - this.lastFailureMs >= this.quietMs * 2
      ) {
        this.consecutiveSuccesses = Math.max(
          this.consecutiveSuccesses,
          this.recoverFromPausedSuccesses,
        );
        this.enterDegraded('QUIET_TIMEOUT');
      }
    }
    this.bootstrapGateHeld = false;
    this.log(`[DB-PRESSURE] bootstrap_resumed reason=${String(this.level).toUpperCase()}`);
    if (this.level === 'degraded') {
      await this.sleep(this.degradedBootstrapDelayMs);
    }
  }

  private pruneFailures(nowMs: number): void {
    const cutoff = nowMs - this.failureWindowMs;
    this.failureTimes = this.failureTimes.filter((t) => t >= cutoff);
  }

  private enterDegraded(reason: string): void {
    if (this.level === 'degraded') return;
    const prev = this.level;
    this.level = 'degraded';
    if (prev === 'healthy') {
      this.log(
        `[DB-PRESSURE] pressure_entered level=degraded reason=${reason} ` +
          `recentFailures=${this.failureTimes.length}`,
      );
    } else if (prev === 'paused') {
      this.log(
        `[DB-PRESSURE] pressure_cleared level=degraded reason=${reason} ` +
          `consecutiveSuccesses=${this.consecutiveSuccesses}`,
      );
    }
  }

  private enterPaused(reason: string): void {
    if (this.level === 'paused') return;
    this.level = 'paused';
    this.log(
      `[DB-PRESSURE] pressure_entered level=paused reason=${reason} ` +
        `recentFailures=${this.failureTimes.length}`,
    );
  }

  private enterHealthy(reason: string): void {
    if (this.level === 'healthy') return;
    const prev = this.level;
    this.level = 'healthy';
    this.log(
      `[DB-PRESSURE] pressure_cleared level=healthy reason=${reason} from=${prev} ` +
        `consecutiveSuccesses=${this.consecutiveSuccesses}`,
    );
  }
}
