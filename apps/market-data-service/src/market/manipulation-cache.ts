import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getEnv } from '@stockpred/shared-utils';
import {
  EngineRefreshGuard,
  ML_ENGINE_REQUEST_TIMEOUT_MS,
  classifyEngineFailureType,
} from './engine-refresh-guard';

export interface CachedManipulationScore {
  symbol: string;
  investigateProbability: number;
  modelVersion: string;
}

/** Optional tabular-model overlay for the statistical unusual-activity snapshot. */
export class ManipulationCache {
  private readonly bySymbol = new Map<string, CachedManipulationScore>();
  private readonly refreshGuard = new EngineRefreshGuard();

  get(symbol: string): CachedManipulationScore | undefined {
    return this.bySymbol.get(symbol);
  }

  size(): number {
    return this.bySymbol.size;
  }

  async refresh(): Promise<number> {
    const gate = this.refreshGuard.tryBegin();
    if (!gate.ok) {
      console.log(
        `[MANIP-CACHE] refresh_skipped reason=${gate.reason}` +
          (gate.reason === 'COOLDOWN' ? ` remaining_ms=${gate.remainingMs}` : ''),
      );
      return this.size();
    }

    const started = Date.now();
    console.log(
      `[MANIP-CACHE] refresh_start source=engine_then_file timeout_ms=${ML_ENGINE_REQUEST_TIMEOUT_MS}`,
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
          `[MANIP-CACHE] refresh_failed failure_type=${failureType} duration_ms=${Date.now() - started} ` +
            `cooldown_until=${new Date(cooldownUntilMs).toISOString()} error=${(error as Error).message}`,
        );
      }

      if (!engineFailed && fromApi > 0) {
        console.log(
          `[MANIP-CACHE] refresh_success source=engine loaded=${fromApi} duration_ms=${Date.now() - started}`,
        );
        return fromApi;
      }

      if (!engineFailed) {
        console.log(`[MANIP-CACHE] engine=0 falling_back=file`);
      } else {
        console.log(`[MANIP-CACHE] engine_failed falling_back=file_or_cache`);
      }

      const fromFile = this.loadFromFile();
      console.log(
        `[MANIP-CACHE] refresh_success source=file loaded=${fromFile} duration_ms=${Date.now() - started}` +
          (engineFailed ? ' after_engine_failure=true' : ''),
      );
      return fromFile;
    } catch (error) {
      console.warn(
        `[MANIP-CACHE] refresh_failed failure_type=ERROR duration_ms=${Date.now() - started} ` +
          `error=${(error as Error).message}`,
      );
      return this.size();
    } finally {
      this.refreshGuard.end();
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

  /** Throws on transport/timeout so callers can enter cooldown. Empty payload is not a failure. */
  private async loadFromEngine(): Promise<number> {
    const base = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
    const response = await axios.get<{ scores: CachedManipulationScore[] }>(
      `${base}/manipulation/all`,
      { params: { limit: 5000 }, timeout: ML_ENGINE_REQUEST_TIMEOUT_MS },
    );
    return this.ingest(response.data.scores ?? []);
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
