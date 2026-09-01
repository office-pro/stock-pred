/**
 * OH-1 pipeline metrics — in-memory ring buffer.
 * Observe-only: records timings; never authorizes or mutates decisions.
 */

import type {
  OhPipelineMetricsSnapshot,
  OhPipelineSample,
  OhPipelineStage,
  OhStageStats,
  OhStageTimingMs,
} from '@stockpred/shared-types';

const DEFAULT_CAPACITY = 500;

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

function stageStats(samples: OhPipelineSample[], stage: OhPipelineStage): OhStageStats {
  const values: number[] = [];
  for (const s of samples) {
    const hit = s.stages.find((x) => x.stage === stage);
    if (hit) values.push(hit.ms);
  }
  values.sort((a, b) => a - b);
  const mean = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    stage,
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? values[values.length - 1] : null,
    meanMs: mean,
  };
}

const ALL_STAGES: OhPipelineStage[] = [
  'evaluateTrade',
  'tiFetch',
  'intelligenceSnapshot',
  'evaluateRisk',
  'evaluatePortfolio',
  'applyDecisionPolicy',
  'pipelineTotal',
  'earlyLiveCaps',
  'priceDeviation',
  'duplicateCheck',
  'gateRevalidate',
  'brokerExecute',
  'approveTotal',
];

export class OhPipelineMetricsCollector {
  private readonly capacity: number;
  private readonly samples: OhPipelineSample[] = [];
  private lastQuoteAgeMs: number | null = null;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(50, capacity);
  }

  record(sample: OhPipelineSample): void {
    this.samples.push(sample);
    if (sample.quoteAgeMs != null && Number.isFinite(sample.quoteAgeMs)) {
      this.lastQuoteAgeMs = sample.quoteAgeMs;
    }
    while (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  noteQuoteAge(ms: number | null | undefined): void {
    if (ms != null && Number.isFinite(ms)) this.lastQuoteAgeMs = ms;
  }

  snapshot(recentLimit = 25): OhPipelineMetricsSnapshot {
    const recent = this.samples.slice(-Math.max(1, Math.min(100, recentLimit))).reverse();
    return {
      schemaVersion: 'oh-pipeline-metrics.v1',
      generatedAt: Date.now(),
      sampleCount: this.samples.length,
      capacity: this.capacity,
      stages: ALL_STAGES.map((s) => stageStats(this.samples, s)),
      recent,
      lastQuoteAgeMs: this.lastQuoteAgeMs,
    };
  }

  clear(): void {
    this.samples.length = 0;
  }
}

export async function timeAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

export function timeSync<T>(fn: () => T): { value: T; ms: number } {
  const t0 = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t0 };
}

export function ohStage(stageName: OhPipelineStage, ms: number): OhStageTimingMs {
  return { stage: stageName, ms };
}
