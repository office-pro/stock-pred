/**
 * Durable FocusUniverseBatch artifacts (JSON). Optimization-only — not authorization.
 * Prefer REPO_ROOT bind-mount (Docker) so the node user can write without EACCES on image layers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { FocusUniverseBatch } from '@stockpred/shared-types';

const LATEST_NAME = 'focus-universe-latest.json';

function resolveDataDir(): string {
  const repo = process.env.REPO_ROOT || process.env.STOCKPRED_REPO_ROOT;
  if (repo && existsSync(repo)) {
    return resolve(repo, 'apps/trader-agent/data');
  }
  return resolve(__dirname, '..', '..', 'data');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function istDateStamp(ms: number): string {
  const ist = new Date(ms + (5 * 60 + 30) * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function focusUniverseLatestPath(): string {
  return join(resolveDataDir(), LATEST_NAME);
}

export function readFocusUniverseLatest(): FocusUniverseBatch | null {
  const path = focusUniverseLatestPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FocusUniverseBatch;
    if (parsed?.schemaVersion !== 'focus-universe.v1' || !Array.isArray(parsed.candidates)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeFocusUniverseBatch(batch: FocusUniverseBatch): {
  latestPath: string;
  datedPath: string;
} {
  const dataDir = resolveDataDir();
  ensureDir(dataDir);
  const latestPath = join(dataDir, LATEST_NAME);
  const datedPath = join(dataDir, `focus-universe-${istDateStamp(batch.generatedAt)}.json`);
  const body = `${JSON.stringify(batch, null, 2)}\n`;
  writeFileSync(latestPath, body, 'utf8');
  writeFileSync(datedPath, body, 'utf8');
  return { latestPath, datedPath };
}
