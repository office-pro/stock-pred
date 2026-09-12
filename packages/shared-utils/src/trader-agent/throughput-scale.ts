/**
 * Phase 8 — throughput scale helpers (not a new authorization path).
 * Parallelism is for analysis/prep only; accept/authorize stays sequential upstream.
 */

export interface ScaleThroughputConfig {
  /** Max market quotes considered per opportunity cycle. */
  maxSymbolsScanned: number;
  /** Max pending opportunities retained after rank. */
  maxOpportunities: number;
  /** Max autonomous accepts per cycle (sequential). */
  maxAutonomousAcceptsPerCycle: number;
  /** Max concurrent symbol analysis workers. */
  analysisConcurrency: number;
  /** Extra strategy/scanner tags fed into Intelligence inputs only. */
  strategyTags: string[];
}

export const DEFAULT_SCALE_CONFIG: ScaleThroughputConfig = {
  maxSymbolsScanned: 120,
  maxOpportunities: 40,
  maxAutonomousAcceptsPerCycle: 8,
  analysisConcurrency: 4,
  strategyTags: [],
};

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseStrategyTags(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,|\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 32);
}

/**
 * Load scale knobs from env (or overrides). Caps are raised vs legacy hardcodes
 * but still must be bound by P2 budgets + P7 breakers at accept time.
 */
export function loadScaleConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ScaleThroughputConfig> = {},
): ScaleThroughputConfig {
  return {
    maxSymbolsScanned: parsePositiveInt(
      env.AGENT_MAX_SYMBOLS_SCANNED,
      DEFAULT_SCALE_CONFIG.maxSymbolsScanned,
      10,
      500,
    ),
    maxOpportunities: parsePositiveInt(
      env.AGENT_MAX_OPPORTUNITIES,
      DEFAULT_SCALE_CONFIG.maxOpportunities,
      5,
      200,
    ),
    maxAutonomousAcceptsPerCycle: parsePositiveInt(
      env.AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE,
      DEFAULT_SCALE_CONFIG.maxAutonomousAcceptsPerCycle,
      1,
      50,
    ),
    analysisConcurrency: parsePositiveInt(
      env.AGENT_ANALYSIS_CONCURRENCY,
      DEFAULT_SCALE_CONFIG.analysisConcurrency,
      1,
      16,
    ),
    strategyTags: parseStrategyTags(env.AGENT_STRATEGY_TAGS),
    ...overrides,
  };
}

/**
 * Bounded concurrency map — for analysis/prep only.
 * Does not authorize trades.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}

export function tenantKey(userId: string, brandId?: string | null): string {
  return `${userId}::${brandId ?? '_'}`;
}

export interface TenantBreakerCounters {
  dayKey: string;
  dailyAutoAcceptCount: number;
  consecutiveVetoCount: number;
  /**
   * Global-only metric — not populated per-tenant.
   * Use AgentService global autoPnlDrawdownPct for observability/enforcement.
   */
  autoPnlDrawdownPct: number;
}

export function emptyTenantBreakerCounters(dayKey = utcDayKey()): TenantBreakerCounters {
  return {
    dayKey,
    dailyAutoAcceptCount: 0,
    consecutiveVetoCount: 0,
    autoPnlDrawdownPct: 0,
  };
}

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** In-memory per-tenant breaker counter store (stop metrics only). */
export class TenantBreakerStore {
  private readonly byTenant = new Map<string, TenantBreakerCounters>();

  get(userId: string, brandId?: string | null): TenantBreakerCounters {
    const key = tenantKey(userId, brandId);
    const day = utcDayKey();
    let row = this.byTenant.get(key);
    if (!row || row.dayKey !== day) {
      row = emptyTenantBreakerCounters(day);
      this.byTenant.set(key, row);
    }
    return row;
  }

  recordAutoAccept(userId: string, brandId?: string | null): void {
    const row = this.get(userId, brandId);
    row.dailyAutoAcceptCount += 1;
    row.consecutiveVetoCount = 0;
  }

  recordVeto(userId: string, brandId?: string | null): void {
    const row = this.get(userId, brandId);
    row.consecutiveVetoCount += 1;
  }

  /** Test helper / desk: snapshot without mutating day roll. */
  snapshot(userId: string, brandId?: string | null): TenantBreakerCounters {
    return { ...this.get(userId, brandId) };
  }
}

export interface CycleTimingMetrics {
  scanMs: number;
  analysisMs: number;
  acceptMs: number;
  symbolsScanned: number;
  opportunitiesBuilt: number;
  autonomousAttempted: number;
  autonomousAccepted: number;
}
