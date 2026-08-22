import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  DEFAULT_SOAK_KILL_THRESHOLDS,
  type SoakConfigSnapshot,
  type SoakRun,
  type SoakState,
} from '@stockpred/shared-types';

function defaultSoakPath(): string {
  const fromEnv = process.env.AGENT_SOAK_PATH;
  if (fromEnv) return resolve(fromEnv);
  return resolve(__dirname, '../../data/soak-run.json');
}

interface SoakFile {
  current: SoakRun | null;
  history: SoakRun[];
}

function nextSoakRunId(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `SOAK-${y}-${m}-${d}-${seq}`;
}

/** Persist current PAPER soak run + short history. */
export class SoakStore {
  private readonly path: string;

  constructor(path = defaultSoakPath()) {
    this.path = path;
  }

  private read(): SoakFile {
    try {
      if (!existsSync(this.path)) return { current: null, history: [] };
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SoakFile>;
      return {
        current: parsed.current ?? null,
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      return { current: null, history: [] };
    }
  }

  private write(file: SoakFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(file, null, 2), 'utf8');
  }

  getCurrent(): SoakRun | null {
    return this.read().current;
  }

  getActiveRunId(): string | undefined {
    const cur = this.getCurrent();
    return cur?.state === 'RUNNING' ? cur.soakRunId : undefined;
  }

  start(input: {
    baseline: SoakRun['baseline'];
    decisionMode: string;
    operatingMode: string;
    riskBudgets: Record<string, number>;
    targetDurationMs?: number;
    killThresholds?: Partial<SoakConfigSnapshot['killThresholds']>;
  }): SoakRun {
    const file = this.read();
    if (file.current?.state === 'RUNNING') {
      throw new Error(`Soak already RUNNING: ${file.current.soakRunId}`);
    }
    const targetDurationMs = input.targetDurationMs ?? 7 * 24 * 60 * 60 * 1000;
    const killThresholds = {
      ...DEFAULT_SOAK_KILL_THRESHOLDS,
      ...input.killThresholds,
    };
    const configSnapshot: SoakConfigSnapshot = {
      decisionMode: input.decisionMode,
      operatingMode: input.operatingMode,
      riskBudgets: input.riskBudgets,
      killThresholds,
      targetDurationMs,
    };
    const run: SoakRun = {
      soakRunId: nextSoakRunId(),
      state: 'RUNNING',
      startedAt: Date.now(),
      targetDurationMs,
      baseline: input.baseline,
      configSnapshot,
      consecutiveVetoWindows: 0,
      consecutiveStaleWindows: 0,
      consecutiveDataFailWindows: 0,
    };
    file.current = run;
    this.write(file);
    return run;
  }

  update(mutator: (run: SoakRun) => SoakRun): SoakRun | null {
    const file = this.read();
    if (!file.current) return null;
    file.current = mutator({ ...file.current });
    this.write(file);
    return file.current;
  }

  finish(
    state: Extract<SoakState, 'PASSED' | 'KILLED' | 'WAIVED'>,
    patch: Partial<SoakRun> = {},
  ): SoakRun {
    const file = this.read();
    if (!file.current || file.current.state !== 'RUNNING') {
      throw new Error('No RUNNING soak to finish');
    }
    const finished: SoakRun = {
      ...file.current,
      ...patch,
      state,
      endedAt: Date.now(),
    };
    file.history = [finished, ...file.history].slice(0, 50);
    file.current = finished;
    this.write(file);
    return finished;
  }
}
