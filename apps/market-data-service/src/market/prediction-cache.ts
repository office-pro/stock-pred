import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getEnv } from '@stockpred/shared-utils';
import {
  PredictionHorizon,
  type MlDriftStatus,
  type MlFreshnessStatus,
} from '@stockpred/shared-types';

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

export class PredictionCache {
  private readonly byHorizon = new Map<string, HorizonMap>();

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
    try {
      const fromApi = await this.loadFromEngine();
      if (fromApi > 0) return fromApi;
      return this.loadFromFile();
    } catch (error) {
      console.warn(`[market-data] ML prediction refresh failed: ${(error as Error).message}`);
      return 0;
    }
  }

  private ingest(rows: CachedMlPrediction[]): number {
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

  private async loadFromEngine(): Promise<number> {
    const base = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
    try {
      const [day, week] = await Promise.all([
        axios.get<{ predictions: CachedMlPrediction[] }>(`${base}/predictions/all`, {
          params: { limit: 5000, page: 1, horizon: PredictionHorizon.NEXT_DAY },
          timeout: 8000,
        }),
        axios.get<{ predictions: CachedMlPrediction[] }>(`${base}/predictions/all`, {
          params: { limit: 5000, page: 1, horizon: PredictionHorizon.NEXT_WEEK },
          timeout: 8000,
        }),
      ]);
      return this.ingest([...(day.data.predictions ?? []), ...(week.data.predictions ?? [])]);
    } catch {
      return 0;
    }
  }

  private loadFromFile(): number {
    const modelsDir = getEnv('ML_MODELS_DIR', 'ml-models');
    const candidates = [
      join(process.cwd(), modelsDir, 'latest-predictions.json'),
      join(process.cwd(), '..', '..', 'ml-models', 'latest-predictions.json'),
      join(process.cwd(), 'ml-models', 'latest-predictions.json'),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) return 0;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedMlPrediction[];
      if (!Array.isArray(parsed)) return 0;
      return this.ingest(parsed);
    } catch (error) {
      console.warn(`[market-data] could not read ${path}: ${(error as Error).message}`);
      return 0;
    }
  }
}
