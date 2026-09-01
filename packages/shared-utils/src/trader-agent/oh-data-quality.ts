/**
 * OH-5 Data Quality — observe → validate → classify → report.
 * Never authorizes, rejects trades, or mutates Risk / Portfolio / Policy / Gate.
 */

import { randomUUID } from 'crypto';
import type {
  OhDataQualityDiagnosticCode,
  OhDataQualitySample,
  OhDataQualitySampleKind,
  OhDataQualitySnapshot,
  OhDataQualityStatus,
} from '@stockpred/shared-types';

const DEFAULT_CAPACITY = 500;

/** Quote older than this vs observation `now` → DATA_STALE (OH-5 only). */
export const OH5_QUOTE_STALE_MS = 60_000;
/** Absolute price gap % vs prior close / prior bar → PRICE_ANOMALY. */
export const OH5_PRICE_GAP_PCT = 15;
/** Fundamentals older than this → FUNDAMENTAL_DATA_STALE. */
export const OH5_FUNDAMENTAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Known candle intervals only — never invent steps for custom TFs. */
export const OH5_KNOWN_CANDLE_INTERVAL_MS: Readonly<Record<string, number>> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export interface OhDataQualityIssue {
  diagnostic: OhDataQualityDiagnosticCode;
  message?: string;
  details?: Record<string, unknown>;
}

export interface OhQuoteLike {
  symbol?: string;
  price?: number | null;
  updatedAt?: number | null;
  previousClose?: number | null;
}

export interface OhCandleLike {
  time?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
}

export interface OhFundamentalsLike {
  missing?: boolean;
  asOfDate?: number | null;
  availableAt?: number | null;
  sector?: string | null;
}

export interface OhMarketContextLike {
  regime?: string | null;
  breadth?: { percentAboveEma50?: number | null } | null;
  niftyChangePercent?: number | null;
  vixLevel?: number | null;
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function gapPct(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0) return Infinity;
  return (Math.abs(to - from) / Math.abs(from)) * 100;
}

/**
 * Pure quote validator. Uses observation `now` + OH5_QUOTE_STALE_MS only —
 * does not read breaker / Risk quote-age state.
 */
export function validateQuoteSample(
  quote: OhQuoteLike | null | undefined,
  now = Date.now(),
): OhDataQualityIssue[] {
  const issues: OhDataQualityIssue[] = [];
  if (quote == null) {
    issues.push({ diagnostic: 'SOURCE_UNAVAILABLE', message: 'quote fetch null' });
    return issues;
  }

  const price = quote.price;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    issues.push({
      diagnostic: 'PRICE_ANOMALY',
      message: 'zero/negative/non-finite price',
      details: { price },
    });
  }

  const updatedAt = quote.updatedAt;
  if (updatedAt == null || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    issues.push({
      diagnostic: 'DATA_STALE',
      message: 'missing updatedAt',
      details: { updatedAt },
    });
  } else {
    const age = now - updatedAt;
    if (age > OH5_QUOTE_STALE_MS) {
      issues.push({
        diagnostic: 'DATA_STALE',
        message: `quote age ${age}ms > ${OH5_QUOTE_STALE_MS}ms`,
        details: { ageMs: age, updatedAt, now },
      });
    }
  }

  if (
    isFinitePositive(price) &&
    isFinitePositive(quote.previousClose) &&
    gapPct(quote.previousClose, price) > OH5_PRICE_GAP_PCT
  ) {
    issues.push({
      diagnostic: 'PRICE_ANOMALY',
      message: `gap vs previousClose > ${OH5_PRICE_GAP_PCT}%`,
      details: {
        price,
        previousClose: quote.previousClose,
        gapPct: gapPct(quote.previousClose, price),
      },
    });
  }

  return issues;
}

/**
 * Pure candle-series validator.
 * MISSING_CANDLE only for known TF intervals; unknown TF → INSUFFICIENT_VALIDATION_CONTEXT.
 */
export function validateCandleSeries(
  candles: OhCandleLike[] | null | undefined,
  timeframe: string,
): OhDataQualityIssue[] {
  const issues: OhDataQualityIssue[] = [];
  const bars = Array.isArray(candles) ? candles : [];
  const knownStep = OH5_KNOWN_CANDLE_INTERVAL_MS[timeframe];

  if (knownStep == null) {
    issues.push({
      diagnostic: 'INSUFFICIENT_VALIDATION_CONTEXT',
      message: `unknown timeframe ${timeframe}; gap check skipped`,
      details: { timeframe },
    });
  }

  if (bars.length === 0) {
    if (knownStep != null) {
      issues.push({
        diagnostic: 'MISSING_CANDLE',
        message: 'empty candle series',
        details: { timeframe },
      });
    }
    return issues;
  }

  const seen = new Set<number>();
  let prevTime: number | null = null;
  let prevClose: number | null = null;

  for (let i = 0; i < bars.length; i++) {
    const c = bars[i];
    const o = c?.open;
    const h = c?.high;
    const l = c?.low;
    const cl = c?.close;
    const t = c?.time;

    const ohlc = [o, h, l, cl];
    const allFinite = ohlc.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!allFinite || ohlc.some((v) => (v as number) <= 0)) {
      issues.push({
        diagnostic: 'OHLC_INVALID',
        message: 'non-finite or non-positive OHLC',
        details: { index: i, open: o, high: h, low: l, close: cl },
      });
    } else {
      const open = o as number;
      const high = h as number;
      const low = l as number;
      const close = cl as number;
      if (high < Math.max(open, close) || low > Math.min(open, close)) {
        issues.push({
          diagnostic: 'OHLC_INVALID',
          message: 'high/low inconsistent with open/close',
          details: { index: i, open, high, low, close },
        });
      }
    }

    if (t == null || !Number.isFinite(t)) {
      issues.push({
        diagnostic: 'TIMESTAMP_ANOMALY',
        message: 'missing candle time',
        details: { index: i, time: t },
      });
      continue;
    }

    if (seen.has(t)) {
      issues.push({
        diagnostic: 'DUPLICATE_DATA',
        message: 'duplicate candle timestamp',
        details: { index: i, time: t },
      });
    } else {
      seen.add(t);
    }

    if (prevTime != null) {
      if (t < prevTime) {
        issues.push({
          diagnostic: 'TIMESTAMP_ANOMALY',
          message: 'out-of-order candle timestamps',
          details: { index: i, time: t, prevTime },
        });
      } else if (knownStep != null && t > prevTime) {
        const delta = t - prevTime;
        const gap = timeframe === '1d' ? delta > knownStep * 3 : delta > knownStep * 1.5;
        if (gap) {
          issues.push({
            diagnostic: 'MISSING_CANDLE',
            message: 'unexpected candle gap',
            details: { index: i, deltaMs: delta, expectedMs: knownStep, timeframe },
          });
        }
      }

      if (
        isFinitePositive(prevClose) &&
        isFinitePositive(cl) &&
        gapPct(prevClose, cl) > OH5_PRICE_GAP_PCT
      ) {
        issues.push({
          diagnostic: 'PRICE_ANOMALY',
          message: `inter-bar gap > ${OH5_PRICE_GAP_PCT}%`,
          details: { index: i, prevClose, close: cl, gapPct: gapPct(prevClose, cl) },
        });
      }
    }

    prevTime = t;
    if (isFinitePositive(cl)) prevClose = cl;
  }

  return issues;
}

/** Missing / empty fundamentals ≠ healthy. */
export function validateFundamentals(
  view: OhFundamentalsLike | null | undefined,
  now = Date.now(),
): OhDataQualityIssue[] {
  const issues: OhDataQualityIssue[] = [];
  if (view == null || view.missing === true) {
    issues.push({
      diagnostic: 'CONTEXT_MISSING',
      message: 'fundamentals missing',
    });
    return issues;
  }

  const asOf = view.asOfDate ?? view.availableAt;
  if (asOf == null || !Number.isFinite(asOf) || asOf <= 0) {
    issues.push({
      diagnostic: 'FUNDAMENTAL_DATA_STALE',
      message: 'fundamentals missing asOfDate',
      details: { asOfDate: view.asOfDate, availableAt: view.availableAt },
    });
  } else if (now - asOf > OH5_FUNDAMENTAL_STALE_MS) {
    issues.push({
      diagnostic: 'FUNDAMENTAL_DATA_STALE',
      message: `fundamentals age > ${OH5_FUNDAMENTAL_STALE_MS}ms`,
      details: { asOf, ageMs: now - asOf },
    });
  }

  return issues;
}

/** Missing market context ≠ healthy. */
export function validateMarketContext(
  ctx: OhMarketContextLike | null | undefined,
): OhDataQualityIssue[] {
  const issues: OhDataQualityIssue[] = [];
  if (ctx == null) {
    issues.push({ diagnostic: 'CONTEXT_MISSING', message: 'market context null' });
    return issues;
  }
  if (ctx.regime == null || String(ctx.regime).trim() === '') {
    issues.push({ diagnostic: 'CONTEXT_MISSING', message: 'regime missing' });
  }
  if (ctx.breadth == null) {
    issues.push({ diagnostic: 'CONTEXT_MISSING', message: 'breadth missing' });
  }
  if (ctx.niftyChangePercent == null || !Number.isFinite(ctx.niftyChangePercent)) {
    issues.push({ diagnostic: 'CONTEXT_MISSING', message: 'niftyChangePercent missing' });
  }
  return issues;
}

/**
 * Only when two comparable quotes exist for the same symbol.
 * Do not invent multi-feed infrastructure.
 */
export function detectConflictingFeeds(a: OhQuoteLike, b: OhQuoteLike): OhDataQualityIssue[] {
  const issues: OhDataQualityIssue[] = [];
  const pa = a.price;
  const pb = b.price;
  if (!isFinitePositive(pa) || !isFinitePositive(pb)) return issues;
  if (gapPct(pa, pb) > OH5_PRICE_GAP_PCT) {
    issues.push({
      diagnostic: 'CONFLICTING_FEEDS',
      message: `comparable quotes disagree > ${OH5_PRICE_GAP_PCT}%`,
      details: { priceA: pa, priceB: pb, gapPct: gapPct(pa, pb) },
    });
  }
  return issues;
}

export interface OhDataQualityClassifyInput {
  samples: OhDataQualitySample[];
  sourceReachable: boolean | null;
}

export function classifyDataQuality(input: OhDataQualityClassifyInput): {
  status: OhDataQualityStatus;
  diagnostics: OhDataQualityDiagnosticCode[];
} {
  const diagnostics = new Set<OhDataQualityDiagnosticCode>();
  for (const s of input.samples) {
    if (s.diagnostic) diagnostics.add(s.diagnostic);
  }

  let status: OhDataQualityStatus = 'HEALTHY';
  if (input.sourceReachable === false || diagnostics.has('SOURCE_UNAVAILABLE')) {
    status = 'UNAVAILABLE';
  } else if (diagnostics.size > 0) {
    status = 'DEGRADED';
  }

  return { status, diagnostics: [...diagnostics] };
}

function emptyDiagnosticCounts(): Record<OhDataQualityDiagnosticCode, number> {
  return {
    DATA_STALE: 0,
    MISSING_CANDLE: 0,
    TIMESTAMP_ANOMALY: 0,
    DUPLICATE_DATA: 0,
    OHLC_INVALID: 0,
    PRICE_ANOMALY: 0,
    FUNDAMENTAL_DATA_STALE: 0,
    CONTEXT_MISSING: 0,
    SOURCE_UNAVAILABLE: 0,
    SYMBOL_MAPPING_FAILED: 0,
    CONFLICTING_FEEDS: 0,
    INSUFFICIENT_VALIDATION_CONTEXT: 0,
  };
}

/**
 * In-memory OH-5 collector. Safe no-op on bad input; never throws into trading path.
 */
export class OhDataQualityCollector {
  private readonly capacity: number;
  private readonly samples: OhDataQualitySample[] = [];
  private sourceReachable: boolean | null = null;
  private lastQuoteAgeMs: number | null = null;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(50, capacity);
  }

  noteSourceReachable(reachable: boolean | null): void {
    try {
      this.sourceReachable = reachable;
    } catch {
      /* observe-only */
    }
  }

  /** Collector-owned quote age — never writes agent.lastQuoteAgeMs. */
  noteQuoteAge(ageMs: number | null): void {
    try {
      this.lastQuoteAgeMs = ageMs != null && Number.isFinite(ageMs) ? Math.max(0, ageMs) : null;
    } catch {
      /* observe-only */
    }
  }

  record(
    partial: Omit<OhDataQualitySample, 'sampleId' | 'recordedAt'> & {
      sampleId?: string;
      recordedAt?: number;
    },
  ): void {
    try {
      if (!partial?.kind) return;
      const sample: OhDataQualitySample = {
        sampleId: partial.sampleId ?? randomUUID(),
        recordedAt: partial.recordedAt ?? Date.now(),
        kind: partial.kind,
        symbol: partial.symbol,
        timeframe: partial.timeframe,
        decisionId: partial.decisionId,
        ok: Boolean(partial.ok),
        diagnostic: partial.diagnostic,
        message: partial.message,
        details: partial.details,
      };
      this.samples.push(sample);
      while (this.samples.length > this.capacity) this.samples.shift();
    } catch {
      /* observe-only */
    }
  }

  /** Record validation issues (or a single ok sample when empty). */
  recordIssues(
    kind: OhDataQualitySampleKind,
    issues: OhDataQualityIssue[],
    meta?: { symbol?: string; timeframe?: string; decisionId?: string },
  ): void {
    try {
      const list = Array.isArray(issues) ? issues : [];
      if (!list.length) {
        this.record({
          kind,
          ok: true,
          symbol: meta?.symbol,
          timeframe: meta?.timeframe,
          decisionId: meta?.decisionId,
        });
        return;
      }
      for (const issue of list) {
        this.record({
          kind,
          ok: false,
          diagnostic: issue.diagnostic,
          message: issue.message,
          details: issue.details,
          symbol: meta?.symbol,
          timeframe: meta?.timeframe,
          decisionId: meta?.decisionId,
        });
      }
    } catch {
      /* observe-only */
    }
  }

  snapshot(recentLimit = 50): OhDataQualitySnapshot {
    try {
      const classified = classifyDataQuality({
        samples: this.samples,
        sourceReachable: this.sourceReachable,
      });
      const diagCounts = emptyDiagnosticCounts();
      let ok = 0;
      let error = 0;
      for (const s of this.samples) {
        if (s.ok) ok += 1;
        else error += 1;
        if (s.diagnostic) diagCounts[s.diagnostic] = (diagCounts[s.diagnostic] ?? 0) + 1;
      }
      const n = Math.max(1, Math.min(200, recentLimit));
      return {
        schemaVersion: 'oh-data-quality.v1',
        generatedAt: Date.now(),
        observeOnly: true,
        status: classified.status,
        diagnostics: classified.diagnostics,
        lastQuoteAgeMs: this.lastQuoteAgeMs,
        sourceReachable: this.sourceReachable,
        sampleCount: this.samples.length,
        recent: this.samples.slice(-n).reverse(),
        counts: { ...diagCounts, ok, error },
      };
    } catch {
      return {
        schemaVersion: 'oh-data-quality.v1',
        generatedAt: Date.now(),
        observeOnly: true,
        status: 'UNAVAILABLE',
        diagnostics: ['SOURCE_UNAVAILABLE'],
        lastQuoteAgeMs: null,
        sourceReachable: this.sourceReachable,
        sampleCount: 0,
        recent: [],
        counts: { ...emptyDiagnosticCounts(), ok: 0, error: 0 },
      };
    }
  }

  clear(): void {
    try {
      this.samples.length = 0;
      this.sourceReachable = null;
      this.lastQuoteAgeMs = null;
    } catch {
      /* observe-only */
    }
  }
}
