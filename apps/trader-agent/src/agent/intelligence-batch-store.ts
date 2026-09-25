/**
 * Durable IntelligenceBatch artifacts under agent data/intelligence-batches/.
 * Optimization-only — not authorization.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type {
  BatchResearchReport,
  BatchDataSnapshot,
  IntelligenceBatch,
  IntelligenceBatchResults,
} from '@stockpred/shared-types';

function resolveDataDir(): string {
  const repo = process.env.REPO_ROOT || process.env.STOCKPRED_REPO_ROOT;
  if (repo && existsSync(repo)) {
    return resolve(repo, 'apps/trader-agent/data/intelligence-batches');
  }
  return resolve(__dirname, '..', '..', 'data', 'intelligence-batches');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function intelligenceBatchesDir(): string {
  const dir = resolveDataDir();
  ensureDir(dir);
  return dir;
}

function batchPath(batchId: string): string {
  return join(intelligenceBatchesDir(), `${batchId}.json`);
}

function resultsPath(batchId: string): string {
  return join(intelligenceBatchesDir(), `${batchId}.results.json`);
}

function researchReportPath(batchId: string): string {
  return join(intelligenceBatchesDir(), `${batchId}.research-report.json`);
}

function dataSnapshotPath(batchId: string): string {
  return join(intelligenceBatchesDir(), `${batchId}.data-snapshot.json`);
}

export function writeIntelligenceBatch(batch: IntelligenceBatch): string {
  const path = batchPath(batch.batchId);
  writeFileSync(path, `${JSON.stringify(batch)}\n`, 'utf8');
  return path;
}

export function readIntelligenceBatch(batchId: string): IntelligenceBatch | null {
  const path = batchPath(batchId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IntelligenceBatch;
    if (parsed?.schemaVersion !== 'intelligence-batch.v1' || !Array.isArray(parsed.tasks)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listIntelligenceBatches(limit = 50): IntelligenceBatch[] {
  const dir = intelligenceBatchesDir();
  const files = readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith('.json') &&
        !f.endsWith('.results.json') &&
        !f.endsWith('.research-report.json') &&
        !f.endsWith('.data-snapshot.json'),
    )
    .sort()
    .reverse();
  const out: IntelligenceBatch[] = [];
  for (const file of files.slice(0, Math.max(1, limit))) {
    const batch = readIntelligenceBatch(file.replace(/\.json$/, ''));
    if (batch) out.push(batch);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, limit);
}

export function writeIntelligenceBatchResults(results: IntelligenceBatchResults): string {
  const path = resultsPath(results.batchId);
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return path;
}

export function readIntelligenceBatchResults(batchId: string): IntelligenceBatchResults | null {
  const path = resultsPath(batchId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IntelligenceBatchResults;
    if (parsed?.schemaVersion !== 'intelligence-batch-results.v1') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeIntelligenceBatchResearchReport(report: BatchResearchReport): string {
  const path = researchReportPath(report.batchId);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export function readIntelligenceBatchResearchReport(batchId: string): BatchResearchReport | null {
  const path = researchReportPath(batchId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BatchResearchReport;
    if (
      parsed?.schemaVersion !== 'batch-research-report.v1' &&
      parsed?.schemaVersion !== 'batch-research-report.v2'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Latest COMPLETED/PARTIAL batch research report, optionally filtered by universe. */
export function readLatestIntelligenceBatchResearchReport(
  universe?: string,
): BatchResearchReport | null {
  const batches = listIntelligenceBatches(50).filter(
    (b) =>
      (b.status === 'COMPLETED' || b.status === 'PARTIAL') &&
      (!universe || String(b.universe) === universe),
  );
  for (const b of batches) {
    const report = readIntelligenceBatchResearchReport(b.batchId);
    if (report) return report;
  }
  return null;
}

/**
 * Previous COMPLETED/PARTIAL same-universe research report (excludes current batchId).
 * Used for KPI vsPrevious / compare — never invents deltas.
 */
export function findPriorSameUniverseResearchReport(
  universe: string,
  excludeBatchId: string,
): BatchResearchReport | null {
  const batches = listIntelligenceBatches(50).filter(
    (b) =>
      (b.status === 'COMPLETED' || b.status === 'PARTIAL') &&
      String(b.universe) === String(universe) &&
      b.batchId !== excludeBatchId,
  );
  for (const b of batches) {
    const report = readIntelligenceBatchResearchReport(b.batchId);
    if (report) return report;
  }
  return null;
}

/** On boot: RUNNING/RESUMING → PAUSED so an operator (or resume) continues from checkpoint. */
export function recoverInterruptedBatches(): IntelligenceBatch[] {
  const recovered: IntelligenceBatch[] = [];
  for (const batch of listIntelligenceBatches(200)) {
    if (batch.status === 'RUNNING' || batch.status === 'RESUMING' || batch.status === 'QUEUED') {
      const next: IntelligenceBatch = {
        ...batch,
        status: 'PAUSED',
        updatedAt: Date.now(),
        tasks: batch.tasks.map((t) =>
          t.status === 'RUNNING' ? { ...t, status: 'PENDING', startedAt: undefined } : t,
        ),
      };
      writeIntelligenceBatch(next);
      recovered.push(next);
    }
  }
  return recovered;
}

export function writeBatchDataSnapshot(snapshot: BatchDataSnapshot): string {
  const path = dataSnapshotPath(snapshot.batchId);
  writeFileSync(path, `${JSON.stringify(snapshot)}\n`, 'utf8');
  return path;
}

export function readBatchDataSnapshot(batchId: string): BatchDataSnapshot | null {
  const path = dataSnapshotPath(batchId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BatchDataSnapshot;
    if (parsed?.schemaVersion !== 'batch-data-snapshot.v1' || !Array.isArray(parsed.instruments)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
