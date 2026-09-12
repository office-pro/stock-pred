/**
 * P8 load harness — invariant-based throughput validation.
 * Wraps existing mapPool from throughput-scale.ts (no alternate implementation).
 */
import { mapPool } from './throughput-scale';

export type P8HarnessVerdict = 'PASS' | 'FAIL';

export interface P8TimingDiagnostics {
  p50: number;
  p95: number;
  p99: number;
}

export interface P8AnalysisHarnessResult {
  outputs: number[];
  peakConcurrency: number;
  processedCount: number;
  orderPreserved: boolean;
  timingMs: P8TimingDiagnostics;
  verdict: P8HarnessVerdict;
  failures: string[];
}

export interface P8AcceptHarnessResult {
  attempted: number;
  accepted: number;
  acceptedIds: string[];
  sequential: boolean;
  noDuplicates: boolean;
  verdict: P8HarnessVerdict;
  failures: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function timingDiagnostics(samples: number[]): P8TimingDiagnostics {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * Synthetic analysis load via existing mapPool.
 * PASS/FAIL on invariants only — timing is diagnostic.
 */
export async function runP8AnalysisHarness(input: {
  symbolCount: number;
  concurrency: number;
  workerDelayMs?: number;
}): Promise<P8AnalysisHarnessResult> {
  const failures: string[] = [];
  const symbols = Array.from({ length: input.symbolCount }, (_, i) => i);
  let live = 0;
  let peak = 0;
  const durations: number[] = [];

  const outputs = await mapPool(symbols, input.concurrency, async (n, index) => {
    live += 1;
    peak = Math.max(peak, live);
    const start = Date.now();
    if (input.workerDelayMs) {
      await new Promise((r) => setTimeout(r, input.workerDelayMs));
    }
    durations.push(Date.now() - start);
    live -= 1;
    return n * 10 + index;
  });

  const orderPreserved = outputs.every((v, i) => v === symbols[i] * 10 + i);
  const processedCount = outputs.length;

  if (peak > input.concurrency) {
    failures.push(`peakConcurrency ${peak} > configured ${input.concurrency}`);
  }
  if (processedCount !== input.symbolCount) {
    failures.push(`processed ${processedCount} !== expected ${input.symbolCount}`);
  }
  if (!orderPreserved) {
    failures.push('result ordering not preserved');
  }

  return {
    outputs,
    peakConcurrency: peak,
    processedCount,
    orderPreserved,
    timingMs: timingDiagnostics(durations),
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

/**
 * Sequential accept simulation — enforces per-cycle cap without authorization.
 */
export function runP8AcceptHarness(input: {
  candidates: readonly string[];
  acceptsPerCycle: number;
}): P8AcceptHarnessResult {
  const failures: string[] = [];
  const acceptedIds: string[] = [];
  const seen = new Set<string>();
  let sequential = true;
  let lastAcceptedAt = -1;

  for (const id of input.candidates) {
    if (acceptedIds.length >= input.acceptsPerCycle) break;
    const now = acceptedIds.length;
    if (now < lastAcceptedAt) sequential = false;
    lastAcceptedAt = now;
    if (seen.has(id)) {
      failures.push(`duplicate acceptance of ${id}`);
      continue;
    }
    seen.add(id);
    acceptedIds.push(id);
  }

  const noDuplicates = acceptedIds.length === new Set(acceptedIds).size;
  if (acceptedIds.length > input.acceptsPerCycle) {
    failures.push(`accepted ${acceptedIds.length} > cap ${input.acceptsPerCycle}`);
  }
  if (!sequential) {
    failures.push('acceptance was not sequential');
  }
  if (!noDuplicates) {
    failures.push('duplicate candidate accepted');
  }

  return {
    attempted: input.candidates.length,
    accepted: acceptedIds.length,
    acceptedIds,
    sequential,
    noDuplicates,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}
