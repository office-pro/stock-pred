import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getEnv } from '@stockpred/shared-utils';

export interface CachedManipulationScore {
  symbol: string;
  investigateProbability: number;
  modelVersion: string;
}

/** Optional tabular-model overlay for the statistical unusual-activity snapshot. */
export class ManipulationCache {
  private readonly bySymbol = new Map<string, CachedManipulationScore>();

  get(symbol: string): CachedManipulationScore | undefined {
    return this.bySymbol.get(symbol);
  }

  async refresh(): Promise<number> {
    try {
      const fromApi = await this.loadFromEngine();
      if (fromApi > 0) return fromApi;
      return this.loadFromFile();
    } catch (error) {
      console.warn(`[market-data] manipulation score refresh failed: ${(error as Error).message}`);
      return 0;
    }
  }

  private ingest(rows: CachedManipulationScore[]): number {
    this.bySymbol.clear();
    for (const row of rows) {
      if (!row.symbol || row.investigateProbability == null) continue;
      this.bySymbol.set(row.symbol, row);
    }
    return this.bySymbol.size;
  }

  private async loadFromEngine(): Promise<number> {
    const base = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
    try {
      const response = await axios.get<{ scores: CachedManipulationScore[] }>(
        `${base}/manipulation/all`,
        { params: { limit: 5000 }, timeout: 8000 },
      );
      return this.ingest(response.data.scores ?? []);
    } catch {
      return 0;
    }
  }

  private loadFromFile(): number {
    const modelsDir = getEnv('ML_MODELS_DIR', 'ml-models');
    const candidates = [
      join(process.cwd(), modelsDir, 'manipulation', 'latest.json'),
      join(process.cwd(), '..', '..', 'ml-models', 'manipulation', 'latest.json'),
      join(process.cwd(), 'ml-models', 'manipulation', 'latest.json'),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) return 0;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedManipulationScore[];
      if (!Array.isArray(parsed)) return 0;
      return this.ingest(parsed);
    } catch (error) {
      console.warn(`[market-data] could not read ${path}: ${(error as Error).message}`);
      return 0;
    }
  }
}
