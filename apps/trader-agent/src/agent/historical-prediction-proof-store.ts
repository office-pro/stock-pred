/**
 * Persist / load matched historical-prediction-proof reports.
 * Advisory measurement only — does not modify Risk / Portfolio / Policy / Gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { HistoricalPredictionProofReport } from '@stockpred/shared-utils';
import { runMatchedHistoricalPredictionProof } from '@stockpred/shared-utils';

function defaultLatestPath(): string {
  const env = process.env.HISTORICAL_PREDICTION_PROOF_PATH;
  if (env) return resolve(env);
  return resolve(__dirname, '../../data/historical-prediction-proof-latest.json');
}

export function loadHistoricalPredictionProof(): HistoricalPredictionProofReport | null {
  const path = defaultLatestPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HistoricalPredictionProofReport;
  } catch {
    return null;
  }
}

export function saveHistoricalPredictionProof(report: HistoricalPredictionProofReport): string {
  const path = defaultLatestPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
  const stamped = join(
    dirname(path),
    `historical-prediction-proof-${report.symbol}-${Date.now()}.json`,
  );
  writeFileSync(stamped, JSON.stringify(report, null, 2), 'utf8');
  return path;
}

/** Run matched proof on provided closes and persist. */
export function runAndPersistHistoricalPredictionProof(input: {
  symbol: string;
  closes: number[];
  universe?: string;
}): HistoricalPredictionProofReport {
  const report = runMatchedHistoricalPredictionProof(input);
  saveHistoricalPredictionProof(report);
  return report;
}

export function emptyHistoricalPredictionProofNote(): {
  status: 'UNAVAILABLE';
  improvementClaim: { status: 'IMPROVEMENT_NOT_VERIFIED'; message: string };
  message: string;
} {
  return {
    status: 'UNAVAILABLE',
    improvementClaim: {
      status: 'IMPROVEMENT_NOT_VERIFIED',
      message:
        'IMPROVEMENT NOT VERIFIED — no matched walk-forward proof artifact on disk. Run POST /agent/historical-prediction-proof with closes, or the shared-utils proof harness.',
    },
    message: 'No historical-prediction-proof-latest.json. Protocol exists; improvement not proven.',
  };
}
