import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getEnv } from '@stockpred/shared-utils';
import {
  PredictionHorizon,
  type MlDriftStatus,
  type MlFreshnessStatus,
} from '@stockpred/shared-types';
import {
  EngineRefreshGuard,
  ML_ENGINE_REQUEST_TIMEOUT_MS,
  classifyEngineFailureType,
} from './engine-refresh-guard';

export interface CachedMlPrediction {
  symbol: string;
  horizon: string;
  direction: string;
  confidence: number;
  expectedMove: number;
  modelVersion?: string;
  /** Registry ACTIVE model id (M4). */
  modelId?: string;
  probabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
  /** Calibrated probs — distinct from confidence (M2/M4). */
  calibratedProbabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
  predictionTimestamp?: string;
  sourceDataTimestamp?: string | null;
  expiresAt?: string;
  featureVersion?: string;
  datasetVersion?: string;
  freshnessStatus?: MlFreshnessStatus;
  /** M4 drift stamp; `incompatible` makes the row unusable. */
  driftStatus?: MlDriftStatus;
  /** Path heads for Trade Intelligence Expected-R (advisory; may be null). */
  expectedReturn?: number | null;
  expectedMfe?: number | null;
  expectedMae?: number | null;
}

export type MlCacheUnusableReason =
  | 'CACHE_MISSING'
  | 'INVALID_PAYLOAD'
  | 'NO_MODEL_VERSION'
  | 'EXPIRED'
  | 'UNUSABLE_FRESHNESS'
  | 'UNUSABLE_DRIFT';

type HorizonMap = Map<string, CachedMlPrediction>;

function parseExpiry(expiresAt?: string): Date | null {
  if (!expiresAt) return null;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/** Compute freshness from expiresAt (and optional explicit status). */
export function resolveMlFreshness(
  prediction: CachedMlPrediction | undefined,
  now: Date = new Date(),
): MlFreshnessStatus {
  if (!prediction) return 'missing';
  if (prediction.freshnessStatus === 'incompatible') return 'incompatible';
  const expires = parseExpiry(prediction.expiresAt);
  if (!expires) {
    // Legacy rows without TTL: treat as missing provenance (do not silently trust).
    return 'missing';
  }
  return now.getTime() <= expires.getTime() ? 'fresh' : 'stale';
}

/** Only fresh, drift-compatible predictions may influence Trade Intelligence / advisory. */
export function isUsableMlPrediction(
  prediction: CachedMlPrediction | undefined,
  now: Date = new Date(),
): prediction is CachedMlPrediction {
  if (!prediction) return false;
  // incompatible drift ⇒ unusable (same as stale). insufficient_data alone does not reject.
  if (prediction.driftStatus === 'incompatible') return false;
  return resolveMlFreshness(prediction, now) === 'fresh';
}

/** Explain why a cached row is unusable — never invent a prediction. */
export function mlUnusableReason(
  prediction: CachedMlPrediction | undefined,
  now: Date = new Date(),
): MlCacheUnusableReason | null {
  if (!prediction) return 'CACHE_MISSING';
  if (!prediction.symbol || !prediction.horizon) return 'INVALID_PAYLOAD';
  if (!prediction.modelVersion) return 'NO_MODEL_VERSION';
  if (prediction.driftStatus === 'incompatible') return 'UNUSABLE_DRIFT';
  const freshness = resolveMlFreshness(prediction, now);
  if (freshness === 'stale') return 'EXPIRED';
  if (freshness !== 'fresh') return 'UNUSABLE_FRESHNESS';
  return null;
}

function countLoadStats(rows: CachedMlPrediction[], now: Date = new Date()) {
  let valid = 0;
  let invalid = 0;
  let missingModelVersion = 0;
  let missingFeatureVersion = 0;
  let expired = 0;
  let usable = 0;
  for (const row of rows) {
    if (!row?.symbol || !row?.horizon) {
      invalid += 1;
      continue;
    }
    valid += 1;
    if (!row.modelVersion) missingModelVersion += 1;
    if (!row.featureVersion) missingFeatureVersion += 1;
    const stamped = { ...row, freshnessStatus: resolveMlFreshness(row, now) };
    if (stamped.freshnessStatus === 'stale') expired += 1;
    if (isUsableMlPrediction(stamped, now)) usable += 1;
  }
  return { valid, invalid, missingModelVersion, missingFeatureVersion, expired, usable };
}

export class PredictionCache {
  private readonly byHorizon = new Map<string, HorizonMap>();
  private readonly refreshGuard = new EngineRefreshGuard();

  get(symbol: string, horizon: string): CachedMlPrediction | undefined {
    const row = this.byHorizon.get(horizon)?.get(symbol);
    if (!row) return undefined;
    return { ...row, freshnessStatus: resolveMlFreshness(row) };
  }

  /** Same as get, but returns undefined unless freshness is fresh. */
  getUsable(
    symbol: string,
    horizon: string,
    now: Date = new Date(),
  ): CachedMlPrediction | undefined {
    const row = this.get(symbol, horizon);
    return isUsableMlPrediction(row, now) ? row : undefined;
  }

  /** Diagnostic get: logs found/usable/reason for sampled lookups. */
  getWithDiagnostics(
    symbol: string,
    horizon: string,
    now: Date = new Date(),
    logSample = false,
  ): {
    row: CachedMlPrediction | undefined;
    usable: boolean;
    reason: MlCacheUnusableReason | null;
  } {
    const row = this.get(symbol, horizon);
    const reason = mlUnusableReason(row, now);
    const usable = reason == null && !!row;
    if (logSample) {
      if (usable && row) {
        console.log(
          `[ML-CACHE][GET] symbol=${symbol} found=true modelVersion=${row.modelVersion ?? ''} ` +
            `featureVersion=${row.featureVersion ?? ''} expiresAt=${row.expiresAt ?? ''} ` +
            `freshnessStatus=${row.freshnessStatus ?? ''} driftStatus=${row.driftStatus ?? ''} usable=true`,
        );
      } else {
        console.log(
          `[ML-CACHE][GET][UNUSABLE] symbol=${symbol} found=${!!row} reason=${reason ?? 'CACHE_MISSING'}`,
        );
      }
    }
    return { row: usable ? row : undefined, usable, reason };
  }

  size(): number {
    let n = 0;
    for (const map of this.byHorizon.values()) n += map.size;
    return n;
  }

  /** Observational rollup for ML Lab TI bridge — does not change usability rules. */
  summarizeTiBridge(now: Date = new Date()): {
    total: number;
    usable: number;
    rejected: {
      stale: number;
      incompatible: number;
      missingExpiry: number;
      other: number;
    };
    byHorizon: Record<string, { total: number; usable: number; rejected: number }>;
    usableSamples: CachedMlPrediction[];
    rejectedSamples: Array<CachedMlPrediction & { rejectReason: string }>;
  } {
    const rejected = { stale: 0, incompatible: 0, missingExpiry: 0, other: 0 };
    const byHorizon: Record<string, { total: number; usable: number; rejected: number }> = {};
    const usableSamples: CachedMlPrediction[] = [];
    const rejectedSamples: Array<CachedMlPrediction & { rejectReason: string }> = [];
    let total = 0;
    let usable = 0;

    for (const [horizon, map] of this.byHorizon.entries()) {
      const bucket = byHorizon[horizon] ?? { total: 0, usable: 0, rejected: 0 };
      for (const row of map.values()) {
        const stamped = { ...row, freshnessStatus: resolveMlFreshness(row, now) };
        total += 1;
        bucket.total += 1;
        if (isUsableMlPrediction(stamped, now)) {
          usable += 1;
          bucket.usable += 1;
          if (usableSamples.length < 8) usableSamples.push(stamped);
          continue;
        }
        // False branch of `prediction is CachedMlPrediction` narrows to never — keep a typed copy.
        const rejectedRow: CachedMlPrediction = stamped;
        bucket.rejected += 1;
        let reason = 'other';
        if (rejectedRow.driftStatus === 'incompatible') {
          reason = 'incompatible';
          rejected.incompatible += 1;
        } else if (rejectedRow.freshnessStatus === 'stale') {
          reason = 'stale';
          rejected.stale += 1;
        } else if (rejectedRow.freshnessStatus === 'missing' || !rejectedRow.expiresAt) {
          reason = 'missingExpiry';
          rejected.missingExpiry += 1;
        } else {
          rejected.other += 1;
        }
        if (rejectedSamples.length < 8) {
          rejectedSamples.push({ ...rejectedRow, rejectReason: reason });
        }
      }
      byHorizon[horizon] = bucket;
    }

    return { total, usable, rejected, byHorizon, usableSamples, rejectedSamples };
  }

  async refresh(): Promise<number> {
    const gate = this.refreshGuard.tryBegin();
    if (!gate.ok) {
      console.log(
        `[ML-CACHE] refresh_skipped reason=${gate.reason}` +
          (gate.reason === 'COOLDOWN' ? ` remaining_ms=${gate.remainingMs}` : ''),
      );
      return this.size();
    }

    const started = Date.now();
    console.log(
      `[ML-CACHE] refresh_start source=engine_then_file timeout_ms=${ML_ENGINE_REQUEST_TIMEOUT_MS}`,
    );
    try {
      let engineFailed = false;
      let fromApi = 0;
      try {
        fromApi = await this.loadFromEngine();
      } catch (error) {
        engineFailed = true;
        const failureType = classifyEngineFailureType(error);
        const { cooldownUntilMs } = this.refreshGuard.markFailure();
        console.warn(
          `[ML-CACHE] refresh_failed failure_type=${failureType} duration_ms=${Date.now() - started} ` +
            `cooldown_until=${new Date(cooldownUntilMs).toISOString()} error=${(error as Error).message}`,
        );
      }

      if (!engineFailed && fromApi > 0) {
        const bridge = this.summarizeTiBridge();
        console.log(`[ML-CACHE][REFRESH] engine_loaded=${fromApi} usable=${bridge.usable}`);
        if (bridge.usable > 0) {
          console.log(
            `[ML-CACHE] refresh_success source=engine loaded=${fromApi} duration_ms=${Date.now() - started}`,
          );
          return fromApi;
        }
        console.log(`[ML-CACHE][REFRESH] engine_unusable falling_back=file`);
      } else if (!engineFailed) {
        console.log(`[ML-CACHE][REFRESH] engine=0 falling_back=file`);
      } else {
        console.log(`[ML-CACHE][REFRESH] engine_failed falling_back=file_or_cache`);
      }

      const fromFile = this.loadFromFile();
      console.log(
        `[ML-CACHE] refresh_success source=file loaded=${fromFile} duration_ms=${Date.now() - started}` +
          (engineFailed ? ' after_engine_failure=true' : ''),
      );
      return fromFile;
    } catch (error) {
      console.warn(
        `[ML-CACHE] refresh_failed failure_type=ERROR duration_ms=${Date.now() - started} ` +
          `error=${(error as Error).message}`,
      );
      return this.size();
    } finally {
      this.refreshGuard.end();
    }
  }

  private ingest(rows: CachedMlPrediction[], source: string): number {
    const stats = countLoadStats(rows);
    console.log(
      `[ML-CACHE][LOAD][SUMMARY] source=${source} loaded=${rows.length} usable=${stats.usable} ` +
        `expired=${stats.expired} invalid=${stats.invalid} ` +
        `missingModelVersion=${stats.missingModelVersion} missingFeatureVersion=${stats.missingFeatureVersion}`,
    );
    this.byHorizon.clear();
    for (const row of rows) {
      if (!row.symbol || !row.horizon) continue;
      let map = this.byHorizon.get(row.horizon);
      if (!map) {
        map = new Map();
        this.byHorizon.set(row.horizon, map);
      }
      map.set(row.symbol, {
        ...row,
        freshnessStatus: resolveMlFreshness(row),
      });
    }
    return rows.length;
  }

  /** Throws on transport/timeout so callers can enter cooldown. Empty payload is not a failure. */
  private async loadFromEngine(): Promise<number> {
    const base = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
    const [day, week] = await Promise.all([
      axios.get<{ predictions: CachedMlPrediction[] }>(`${base}/predictions/all`, {
        params: { limit: 5000, page: 1, horizon: PredictionHorizon.NEXT_DAY },
        timeout: ML_ENGINE_REQUEST_TIMEOUT_MS,
      }),
      axios.get<{ predictions: CachedMlPrediction[] }>(`${base}/predictions/all`, {
        params: { limit: 5000, page: 1, horizon: PredictionHorizon.NEXT_WEEK },
        timeout: ML_ENGINE_REQUEST_TIMEOUT_MS,
      }),
    ]);
    const rows = [...(day.data.predictions ?? []), ...(week.data.predictions ?? [])];
    const stats = countLoadStats(rows);
    console.log(
      `[ML-CACHE][LOAD] file=engine:/predictions/all fileExists=true records=${rows.length} ` +
        `valid=${stats.valid} invalid=${stats.invalid} missingModelVersion=${stats.missingModelVersion} ` +
        `missingFeatureVersion=${stats.missingFeatureVersion} expired=${stats.expired}`,
    );
    if (rows.length === 0) return 0;
    return this.ingest(rows, 'engine');
  }

  private loadFromFile(): number {
    const modelsDir = getEnv('ML_MODELS_DIR', 'ml-models');
    const candidates = [
      join(process.cwd(), modelsDir, 'latest-predictions.json'),
      join(process.cwd(), '..', '..', 'ml-models', 'latest-predictions.json'),
      join(process.cwd(), 'ml-models', 'latest-predictions.json'),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) {
      console.log(
        `[ML-CACHE][LOAD] file=latest-predictions.json fileExists=false records=0 ` +
          `candidates=${candidates.join('|')}`,
      );
      console.log(
        `[ML-CACHE][LOAD][SUMMARY] source=file loaded=0 usable=0 expired=0 invalid=0 ` +
          `missingModelVersion=0 missingFeatureVersion=0`,
      );
      return 0;
    }
    try {
      const bytes = statSync(path).size;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedMlPrediction[];
      if (!Array.isArray(parsed)) {
        console.log(
          `[ML-CACHE][LOAD] file=${path} fileExists=true bytes=${bytes} records=0 invalid=non_array`,
        );
        return 0;
      }
      const stats = countLoadStats(parsed);
      console.log(
        `[ML-CACHE][LOAD] file=${path} fileExists=true bytes=${bytes} records=${parsed.length} ` +
          `valid=${stats.valid} invalid=${stats.invalid} missingModelVersion=${stats.missingModelVersion} ` +
          `missingFeatureVersion=${stats.missingFeatureVersion} expired=${stats.expired}`,
      );
      return this.ingest(parsed, 'file');
    } catch (error) {
      console.warn(`[ML-CACHE][LOAD] file=${path} parse_failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
