/**
 * OH-2 Execution Health — observe → classify → report → alert.
 * Never authorizes, resizes, or modifies Risk / Portfolio / Policy / Gate.
 */

import { randomUUID } from 'crypto';
import type {
  OhExecutionDiagnosticCode,
  OhExecutionHealthSnapshot,
  OhExecutionHealthStatus,
  OhExecutionLifecycleSample,
} from '@stockpred/shared-types';

const DEFAULT_CAPACITY = 500;
/** Pending submit without ACK beyond this → ORDER_STUCK (observe-only). */
export const OH2_STUCK_ORDER_MS = 60_000;
/** Fill slower than this → FILL_DELAYED (observe-only). */
export const OH2_FILL_DELAYED_MS = 15_000;
/** Absolute price deviation % → PRICE_DEVIATION diagnostic. */
export const OH2_PRICE_DEVIATION_PCT = 1.0;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function collectMs(
  samples: OhExecutionLifecycleSample[],
  key: 'submitAckMs' | 'fillMs' | 'e2eMs',
): number[] {
  const out: number[] = [];
  for (const s of samples) {
    const v = s[key];
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

export interface OhExecutionClassifyInput {
  samples: OhExecutionLifecycleSample[];
  brokerConnected: boolean | null;
  failureStreak: number;
  pendingOpenCount: number;
  now?: number;
}

/**
 * Pure classifier — never feeds Risk / Portfolio / Policy / Gate.
 */
export function classifyExecutionHealth(input: OhExecutionClassifyInput): {
  status: OhExecutionHealthStatus;
  diagnostics: OhExecutionDiagnosticCode[];
} {
  const diagnostics = new Set<OhExecutionDiagnosticCode>();
  const samples = input.samples;

  if (input.brokerConnected === false) {
    diagnostics.add('BROKER_DISCONNECTED');
  }

  if (input.failureStreak >= 3) {
    diagnostics.add('EXECUTION_FAILURE');
  }

  if (input.pendingOpenCount > 0) {
    // Stuck pending is also counted via sample diagnostics below
  }

  for (const s of samples) {
    if (s.diagnostic) diagnostics.add(s.diagnostic);
    if (s.phase === 'REJECT') diagnostics.add('REJECTED_ORDER');
    if (s.phase === 'CANCEL') diagnostics.add('CANCELLED_ORDER');
    if (s.fillMs != null && s.fillMs >= OH2_FILL_DELAYED_MS) {
      diagnostics.add('FILL_DELAYED');
    }
    if (
      s.expectedQty != null &&
      s.actualQty != null &&
      Number.isFinite(s.expectedQty) &&
      Number.isFinite(s.actualQty) &&
      s.expectedQty !== s.actualQty
    ) {
      diagnostics.add('QTY_MISMATCH');
    }
  }

  let status: OhExecutionHealthStatus = 'HEALTHY';
  if (
    diagnostics.has('BROKER_DISCONNECTED') ||
    diagnostics.has('BROKER_TIMEOUT') ||
    (input.brokerConnected === false && samples.length === 0)
  ) {
    status = 'UNAVAILABLE';
  } else if (diagnostics.size > 0 || input.failureStreak > 0 || input.pendingOpenCount > 0) {
    status = 'DEGRADED';
  }

  return { status, diagnostics: [...diagnostics] };
}

interface PendingOrder {
  decisionId: string;
  symbol?: string;
  submittedAt: number;
  expectedQty?: number;
  expectedPrice?: number;
}

/**
 * In-memory OH-2 collector. Safe no-op on bad input; never throws into trading path.
 */
export class OhExecutionHealthCollector {
  private readonly capacity: number;
  private readonly samples: OhExecutionLifecycleSample[] = [];
  private readonly pending = new Map<string, PendingOrder>();
  private failureStreak = 0;
  private brokerConnected: boolean | null = null;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(50, capacity);
  }

  setBrokerConnected(connected: boolean | null): void {
    try {
      this.brokerConnected = connected;
    } catch {
      /* observe-only */
    }
  }

  noteFailureStreak(streak: number): void {
    try {
      this.failureStreak = Math.max(0, streak);
    } catch {
      /* observe-only */
    }
  }

  /** Mark submit started — used for stuck-order detection. */
  noteSubmitStarted(input: {
    decisionId: string;
    symbol?: string;
    expectedQty?: number;
    expectedPrice?: number;
  }): void {
    try {
      if (!input.decisionId) return;
      this.pending.set(input.decisionId, {
        decisionId: input.decisionId,
        symbol: input.symbol,
        submittedAt: Date.now(),
        expectedQty: input.expectedQty,
        expectedPrice: input.expectedPrice,
      });
    } catch {
      /* observe-only */
    }
  }

  record(
    sample: Omit<OhExecutionLifecycleSample, 'sampleId' | 'recordedAt'> & {
      sampleId?: string;
      recordedAt?: number;
    },
  ): void {
    try {
      const row: OhExecutionLifecycleSample = {
        sampleId: sample.sampleId ?? randomUUID(),
        recordedAt: sample.recordedAt ?? Date.now(),
        phase: sample.phase,
        decisionId: sample.decisionId,
        orderId: sample.orderId,
        positionId: sample.positionId,
        symbol: sample.symbol,
        submitAckMs: sample.submitAckMs,
        fillMs: sample.fillMs,
        e2eMs: sample.e2eMs,
        expectedQty: sample.expectedQty,
        actualQty: sample.actualQty,
        expectedPrice: sample.expectedPrice,
        fillPrice: sample.fillPrice,
        priceDeviationPct: sample.priceDeviationPct,
        ok: sample.ok,
        diagnostic: sample.diagnostic,
        message: sample.message,
      };
      this.samples.push(row);
      while (this.samples.length > this.capacity) this.samples.shift();

      if (row.decisionId && (row.phase === 'BROKER_ACK' || row.phase === 'FILL')) {
        this.pending.delete(row.decisionId);
      }
      if (
        row.decisionId &&
        (row.phase === 'ERROR' || row.phase === 'REJECT' || row.phase === 'CANCEL')
      ) {
        this.pending.delete(row.decisionId);
      }
    } catch {
      /* observe-only — never break trading */
    }
  }

  /** Scan pending submits older than stuck threshold. */
  scanStuckOrders(now = Date.now(), stuckMs = OH2_STUCK_ORDER_MS): OhExecutionLifecycleSample[] {
    const stuck: OhExecutionLifecycleSample[] = [];
    try {
      for (const [decisionId, p] of this.pending) {
        if (now - p.submittedAt >= stuckMs) {
          const sample: OhExecutionLifecycleSample = {
            sampleId: randomUUID(),
            recordedAt: now,
            phase: 'ERROR',
            decisionId,
            symbol: p.symbol,
            expectedQty: p.expectedQty,
            expectedPrice: p.expectedPrice,
            e2eMs: now - p.submittedAt,
            ok: false,
            diagnostic: 'ORDER_STUCK',
            message: `No broker ACK within ${stuckMs}ms`,
          };
          this.samples.push(sample);
          stuck.push(sample);
          this.pending.delete(decisionId);
        }
      }
      while (this.samples.length > this.capacity) this.samples.shift();
    } catch {
      /* observe-only */
    }
    return stuck;
  }

  snapshot(recentLimit = 25): OhExecutionHealthSnapshot {
    this.scanStuckOrders();
    const classified = classifyExecutionHealth({
      samples: this.samples,
      brokerConnected: this.brokerConnected,
      failureStreak: this.failureStreak,
      pendingOpenCount: this.pending.size,
    });

    const submitAck = collectMs(this.samples, 'submitAckMs');
    const fill = collectMs(this.samples, 'fillMs');
    const e2e = collectMs(this.samples, 'e2eMs');

    let submits = 0;
    let acks = 0;
    let fills = 0;
    let rejects = 0;
    let cancels = 0;
    let errors = 0;
    let duplicates = 0;
    let stuck = 0;
    for (const s of this.samples) {
      if (s.phase === 'SUBMIT') submits += 1;
      if (s.phase === 'BROKER_ACK') acks += 1;
      if (s.phase === 'FILL') fills += 1;
      if (s.phase === 'REJECT') rejects += 1;
      if (s.phase === 'CANCEL') cancels += 1;
      if (s.phase === 'ERROR') errors += 1;
      if (s.diagnostic === 'DUPLICATE_ATTEMPT') duplicates += 1;
      if (s.diagnostic === 'ORDER_STUCK') stuck += 1;
    }

    return {
      schemaVersion: 'oh-execution-health.v1',
      generatedAt: Date.now(),
      observeOnly: true,
      status: classified.status,
      diagnostics: classified.diagnostics,
      brokerConnected: this.brokerConnected,
      failureStreak: this.failureStreak,
      openPendingOrders: this.pending.size,
      sampleCount: this.samples.length,
      recent: this.samples.slice(-Math.max(1, Math.min(100, recentLimit))).reverse(),
      latency: {
        submitAckP50Ms: percentile(submitAck, 0.5),
        submitAckP95Ms: percentile(submitAck, 0.95),
        fillP50Ms: percentile(fill, 0.5),
        fillP95Ms: percentile(fill, 0.95),
        e2eP50Ms: percentile(e2e, 0.5),
        e2eP95Ms: percentile(e2e, 0.95),
      },
      counts: { submits, acks, fills, rejects, cancels, errors, duplicates, stuck },
    };
  }

  clear(): void {
    this.samples.length = 0;
    this.pending.clear();
    this.failureStreak = 0;
  }
}

/** Map axios/network errors to OH-2 diagnostics (observe-only). */
export function diagnosticFromExecutionError(error: unknown): OhExecutionDiagnosticCode {
  if (!error || typeof error !== 'object') return 'EXECUTION_FAILURE';
  const err = error as {
    code?: string;
    message?: string;
    isAxiosError?: boolean;
    response?: { status?: number };
  };
  const code = (err.code ?? '').toUpperCase();
  const msg = (err.message ?? '').toLowerCase();
  if (code === 'ECONNABORTED' || msg.includes('timeout')) return 'BROKER_TIMEOUT';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    msg.includes('network') ||
    (!err.response && err.isAxiosError)
  ) {
    return 'BROKER_DISCONNECTED';
  }
  return 'EXECUTION_FAILURE';
}

export function priceDeviationPct(expected: number, actual: number): number | null {
  if (!(expected > 0) || !(actual > 0)) return null;
  return (Math.abs(actual - expected) / expected) * 100;
}
