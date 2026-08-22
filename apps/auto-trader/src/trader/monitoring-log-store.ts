import { randomUUID } from 'crypto';

export type MonitoringAction =
  | 'CHECK'
  | 'HOLD'
  | 'TRAIL'
  | 'UPDATE_LEVELS'
  | 'PARTIAL_EXIT'
  | 'FULL_EXIT'
  | 'CLASSIC_STOP'
  | 'CLASSIC_TARGET';

export interface MonitoringLogEvent {
  id: string;
  ts: number;
  symbol: string;
  bookKey: string;
  userId: string | null;
  mode: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
  action: MonitoringAction;
  policy: string;
  note: string;
  price: number;
  stopLoss: number;
  target: number;
  quantity?: number;
  reason?: string;
}

export interface MonitoringLogMeta {
  agentTradingEnabled: boolean;
  tickSource: string;
  expectedTickIntervalMs: number;
  holdSampleIntervalMs: number;
  lastTickAt: number | null;
  ticksReceived: number;
  ticksLastMinute: number;
  checksLogged: number;
  openLotsHint: number;
}

const HOLD_SAMPLE_MS = 15_000;
const MAX_EVENTS = 500;

/** In-memory ring buffer of agent/classic exit-monitoring decisions. */
export class MonitoringLogStore {
  private readonly events: MonitoringLogEvent[] = [];
  private readonly lastHoldLog = new Map<string, number>();
  private readonly lastActionKey = new Map<string, string>();
  private ticksReceived = 0;
  private lastTickAt: number | null = null;
  private readonly tickTimestamps: number[] = [];
  private checksLogged = 0;

  recordTick(): void {
    const now = Date.now();
    this.ticksReceived += 1;
    this.lastTickAt = now;
    this.tickTimestamps.push(now);
    const cutoff = now - 60_000;
    while (this.tickTimestamps.length > 0 && this.tickTimestamps[0]! < cutoff) {
      this.tickTimestamps.shift();
    }
  }

  /**
   * Log a monitoring decision. HOLD/CHECK are sampled; state changes always log.
   */
  push(input: Omit<MonitoringLogEvent, 'id' | 'ts'> & { force?: boolean }): void {
    const sampleKey = `${input.bookKey}::${input.symbol}`;
    const actionKey = `${sampleKey}::${input.action}::${input.policy}::${input.stopLoss}::${input.target}`;
    const now = Date.now();
    const isHoldLike = input.action === 'HOLD' || input.action === 'CHECK';

    if (isHoldLike && !input.force) {
      const last = this.lastHoldLog.get(sampleKey) ?? 0;
      if (now - last < HOLD_SAMPLE_MS) return;
      this.lastHoldLog.set(sampleKey, now);
    } else if (!isHoldLike) {
      const prev = this.lastActionKey.get(sampleKey);
      if (prev === actionKey && !input.force) return;
      this.lastActionKey.set(sampleKey, actionKey);
    }

    const event: MonitoringLogEvent = {
      id: randomUUID(),
      ts: now,
      symbol: input.symbol,
      bookKey: input.bookKey,
      userId: input.userId,
      mode: input.mode,
      action: input.action,
      policy: input.policy,
      note: input.note,
      price: input.price,
      stopLoss: input.stopLoss,
      target: input.target,
      quantity: input.quantity,
      reason: input.reason,
    };
    this.events.unshift(event);
    this.checksLogged += 1;
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  list(limit = 100, symbol?: string): MonitoringLogEvent[] {
    const rows = symbol
      ? this.events.filter((row) => row.symbol.toUpperCase() === symbol.toUpperCase())
      : this.events;
    return rows.slice(0, Math.min(Math.max(limit, 1), 200));
  }

  meta(agentTradingEnabled: boolean, openLotsHint: number): MonitoringLogMeta {
    return {
      agentTradingEnabled,
      tickSource: 'Kafka market.ticks (from market-data)',
      expectedTickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 1000),
      holdSampleIntervalMs: HOLD_SAMPLE_MS,
      lastTickAt: this.lastTickAt,
      ticksReceived: this.ticksReceived,
      ticksLastMinute: this.tickTimestamps.length,
      checksLogged: this.checksLogged,
      openLotsHint,
    };
  }
}
