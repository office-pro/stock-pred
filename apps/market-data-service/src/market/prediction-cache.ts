import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getEnv } from '@stockpred/shared-utils';
import { PredictionHorizon } from '@stockpred/shared-types';

export interface CachedMlPrediction {
  symbol: string;
  horizon: string;
  direction: string;
  confidence: number;
  expectedMove: number;
  modelVersion?: string;
  probabilities?: { UP?: number; DOWN?: number; SIDEWAYS?: number };
}

type HorizonMap = Map<string, CachedMlPrediction>;

export class PredictionCache {
  private readonly byHorizon = new Map<string, HorizonMap>();

  get(symbol: string, horizon: string): CachedMlPrediction | undefined {
    return this.byHorizon.get(horizon)?.get(symbol);
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
      map.set(row.symbol, row);
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
