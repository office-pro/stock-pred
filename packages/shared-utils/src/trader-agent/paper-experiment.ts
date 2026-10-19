/**
 * Paper Experiment → Outcome → Calibration / Learning boundary.
 * Learning phases: MEASURE | CALIBRATE | VALIDATE.
 * Never mutates Risk / Gate / production model. Promotion requires walk-forward elsewhere.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type {
  AssetClass,
  CapabilityState,
  LearningPhase,
  LearningSegregationKey,
  PaperExperiment,
  PaperExperimentOutcome,
  PaperExperimentStatus,
  VenueId,
} from '@stockpred/shared-types';

const DEFAULT_STORE = join(process.cwd(), 'data', 'paper-experiments.json');

export interface PaperExperimentStoreFile {
  schemaVersion: 'paper-experiments.v1';
  experiments: PaperExperiment[];
  outcomes: PaperExperimentOutcome[];
  /** Calibration observations only — never production weights. */
  calibrationNotes: Array<{
    id: string;
    at: number;
    phase: LearningPhase;
    experimentId: string;
    note: string;
  }>;
  /** Candidate models awaiting walk-forward — never auto-promoted. */
  candidates: Array<{
    candidateId: string;
    createdAt: number;
    fromExperimentIds: string[];
    status: 'DRAFT' | 'WALK_FORWARD_PENDING' | 'REJECTED' | 'PROMOTED_EXTERNAL';
    note: string;
  }>;
}

function emptyStore(): PaperExperimentStoreFile {
  return {
    schemaVersion: 'paper-experiments.v1',
    experiments: [],
    outcomes: [],
    calibrationNotes: [],
    candidates: [],
  };
}

export function loadPaperExperimentStore(path = DEFAULT_STORE): PaperExperimentStoreFile {
  try {
    if (!existsSync(path)) return emptyStore();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PaperExperimentStoreFile;
    if (raw?.schemaVersion !== 'paper-experiments.v1') return emptyStore();
    return {
      ...emptyStore(),
      ...raw,
      experiments: Array.isArray(raw.experiments) ? raw.experiments : [],
      outcomes: Array.isArray(raw.outcomes) ? raw.outcomes : [],
      calibrationNotes: Array.isArray(raw.calibrationNotes) ? raw.calibrationNotes : [],
      candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    };
  } catch {
    return emptyStore();
  }
}

export function savePaperExperimentStore(
  store: PaperExperimentStoreFile,
  path = DEFAULT_STORE,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

export function createPaperExperiment(
  input: Omit<PaperExperiment, 'experimentId' | 'createdAt' | 'status'> & {
    status?: PaperExperimentStatus;
  },
  path = DEFAULT_STORE,
): PaperExperiment {
  const store = loadPaperExperimentStore(path);
  const experiment: PaperExperiment = {
    ...input,
    experimentId: `pex-${randomUUID()}`,
    createdAt: Date.now(),
    status: input.status ?? 'QUEUED',
    confidenceStatus: input.confidenceStatus ?? ('UNAVAILABLE' as CapabilityState),
    universeVersion: input.universeVersion ?? null,
    decisionId: input.decisionId ?? null,
    operatingMode: input.operatingMode ?? null,
    predictionSnapshot: input.predictionSnapshot ?? null,
    recommendationSnapshot: input.recommendationSnapshot ?? null,
  };
  store.experiments.unshift(experiment);
  savePaperExperimentStore(store, path);
  return experiment;
}

export function listPaperExperiments(path = DEFAULT_STORE): PaperExperiment[] {
  return loadPaperExperimentStore(path).experiments;
}

export function getPaperExperiment(
  experimentId: string,
  path = DEFAULT_STORE,
): PaperExperiment | null {
  return (
    loadPaperExperimentStore(path).experiments.find((e) => e.experimentId === experimentId) ?? null
  );
}

export function updatePaperExperimentStatus(
  experimentId: string,
  status: PaperExperimentStatus,
  path = DEFAULT_STORE,
): PaperExperiment | null {
  const store = loadPaperExperimentStore(path);
  const idx = store.experiments.findIndex((e) => e.experimentId === experimentId);
  if (idx < 0) return null;
  store.experiments[idx] = { ...store.experiments[idx]!, status };
  savePaperExperimentStore(store, path);
  return store.experiments[idx]!;
}

export function recordPaperOutcome(
  outcome: Omit<PaperExperimentOutcome, 'evaluatedAt'> & { evaluatedAt?: number },
  path = DEFAULT_STORE,
): PaperExperimentOutcome {
  const store = loadPaperExperimentStore(path);
  const row: PaperExperimentOutcome = {
    ...outcome,
    evaluatedAt: outcome.evaluatedAt ?? Date.now(),
  };
  store.outcomes.unshift(row);
  const exp = store.experiments.find((e) => e.experimentId === outcome.experimentId);
  if (exp) exp.status = 'COMPLETED';
  savePaperExperimentStore(store, path);
  return row;
}

/** MEASURE / CALIBRATE / VALIDATE only — never touches Risk or Gate. */
export function appendLearningNote(
  input: { experimentId: string; phase: LearningPhase; note: string },
  path = DEFAULT_STORE,
): { id: string; phase: LearningPhase } {
  const store = loadPaperExperimentStore(path);
  const id = `learn-${randomUUID()}`;
  store.calibrationNotes.unshift({
    id,
    at: Date.now(),
    phase: input.phase,
    experimentId: input.experimentId,
    note: input.note,
  });
  savePaperExperimentStore(store, path);
  return { id, phase: input.phase };
}

export function registerCandidateModel(
  input: { fromExperimentIds: string[]; note: string },
  path = DEFAULT_STORE,
): { candidateId: string; status: 'WALK_FORWARD_PENDING' } {
  const store = loadPaperExperimentStore(path);
  const candidateId = `cand-${randomUUID()}`;
  store.candidates.unshift({
    candidateId,
    createdAt: Date.now(),
    fromExperimentIds: input.fromExperimentIds,
    status: 'WALK_FORWARD_PENDING',
    note: input.note,
  });
  savePaperExperimentStore(store, path);
  return { candidateId, status: 'WALK_FORWARD_PENDING' };
}

/** Hard invariant: Learning must never return Risk/Gate mutation hooks. */
export function learningTouchesRiskOrGate(): false {
  return false;
}

/** Learning dimensions — no automatic NSE→BTC (or cross-venue) calibration. */
export function learningSegregationKey(input: {
  engine: string;
  instrument: { assetClass: AssetClass; venue: VenueId };
  horizon: string;
  regime?: string | null;
  modelVersion?: string | null;
}): LearningSegregationKey {
  return {
    engine: input.engine,
    assetClass: input.instrument.assetClass,
    venue: input.instrument.venue,
    horizon: input.horizon,
    regime: input.regime ?? null,
    modelVersion: input.modelVersion ?? null,
  };
}

export function learningKeysCompatible(
  a: LearningSegregationKey,
  b: LearningSegregationKey,
): boolean {
  return (
    a.engine === b.engine &&
    a.assetClass === b.assetClass &&
    a.venue === b.venue &&
    a.horizon === b.horizon
  );
}

/** paperExperiment.batchId must resolve the exact batch snapshot when present. */
export function assertPaperExperimentBatchLineage(input: {
  experimentBatchId?: string | null;
  batchId: string;
  experimentUniverseVersion?: string | null;
  batchUniverseVersion?: string | null;
}): { ok: boolean; detail: string } {
  if (input.experimentBatchId && input.experimentBatchId !== input.batchId) {
    return { ok: false, detail: 'batchId_mismatch' };
  }
  if (
    input.experimentUniverseVersion &&
    input.batchUniverseVersion &&
    input.experimentUniverseVersion !== input.batchUniverseVersion
  ) {
    return { ok: false, detail: 'universeVersion_mismatch' };
  }
  return { ok: true, detail: 'lineage_ok' };
}
