/**
 * Pure helpers for Intelligence Batch B1 — partition, progress, status transitions.
 * No evaluateTrade / Risk / Portfolio / Policy / Gate / orders.
 */

import type {
  BatchCheckpoint,
  BatchPartition,
  BatchSymbolTask,
  CreateIntelligenceBatchRequest,
  IntelligenceBatch,
  IntelligenceBatchMode,
  IntelligenceBatchProgress,
  IntelligenceBatchStatus,
  IntelligenceBatchType,
  IntelligencePipelineStageProgress,
} from '@stockpred/shared-types';
import {
  INTELLIGENCE_BATCH_FEATURE_VERSION,
  INTELLIGENCE_BATCH_MODEL_VERSION,
  INTELLIGENCE_BATCH_PARTITION_SIZE,
} from '@stockpred/shared-types';

export class IntelligenceBatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntelligenceBatchValidationError';
  }
}

/** B1 executable contract — reserved modes/types rejected. */
export function assertB1ExecutableBatchRequest(req: CreateIntelligenceBatchRequest): {
  batchType: IntelligenceBatchType;
  mode: IntelligenceBatchMode;
} {
  const batchType = req.batchType ?? 'FULL_ANALYSIS';
  const mode = req.mode ?? 'HISTORICAL';
  if (batchType === 'LIVE_CONTINUOUS') {
    throw new IntelligenceBatchValidationError(
      'LIVE_CONTINUOUS is reserved in B1 and is not executable',
    );
  }
  if (mode === 'LIVE' || mode === 'HYBRID') {
    throw new IntelligenceBatchValidationError(
      `${mode} mode is reserved in B1; only HISTORICAL is executable`,
    );
  }
  if (batchType !== 'FULL_ANALYSIS') {
    throw new IntelligenceBatchValidationError(`Unsupported batchType: ${batchType}`);
  }
  if (mode !== 'HISTORICAL') {
    throw new IntelligenceBatchValidationError(`Unsupported mode: ${mode}`);
  }
  return { batchType, mode };
}

export function partitionSymbols(
  symbols: string[],
  partitionSize = INTELLIGENCE_BATCH_PARTITION_SIZE,
): BatchPartition[] {
  const size = Math.max(1, partitionSize);
  const partitions: BatchPartition[] = [];
  for (let i = 0; i < symbols.length; i += size) {
    const slice = symbols.slice(i, i + size);
    const index = partitions.length;
    partitions.push({
      partitionId: `P${String(index + 1).padStart(2, '0')}`,
      index,
      symbolStart: i,
      symbolEnd: i + slice.length - 1,
      symbols: slice,
    });
  }
  return partitions;
}

export function buildInitialTasks(partitions: BatchPartition[]): BatchSymbolTask[] {
  const tasks: BatchSymbolTask[] = [];
  for (const p of partitions) {
    for (const symbol of p.symbols) {
      tasks.push({
        symbol,
        partitionId: p.partitionId,
        status: 'PENDING',
        lifecycleState: 'CANDIDATE',
      });
    }
  }
  return tasks;
}

export function emptyCheckpoint(now = Date.now()): BatchCheckpoint {
  return {
    completedSymbols: [],
    failedSymbols: [],
    currentSymbol: null,
    partitionId: null,
    lastCheckpointAt: now,
  };
}

export function b1PipelineStages(done: number, total: number): IntelligencePipelineStageProgress[] {
  return b2PipelineStages({ analyzedDone: done, analyzedTotal: total });
}

/**
 * B2–B4 stages: analyze + TI + fund/news/social/macro + thesis/wait/exit/integrity.
 * Counts must reflect actual processing — never fabricate 100% because Bn exists.
 * availability ≠ favorability; news/social require alt capabilities (not sentimentScore).
 */
export function b2PipelineStages(input: {
  analyzedDone: number;
  analyzedTotal: number;
  tiTotal?: number;
  regimeDone?: number;
  rsDone?: number;
  sectorDone?: number;
  multiHorizonDone?: number;
  fundamentalDone?: number;
  newsDone?: number;
  socialDone?: number;
  macroDone?: number;
  thesisDone?: number;
  waitDone?: number;
  exitDone?: number;
  /** Research batches: Exit requires open position — not an empty provider. */
  exitRequiresOpenPosition?: boolean;
  integrityDone?: number;
  mlDone?: number;
  professionalAnalysisDone?: number;
}): IntelligencePipelineStageProgress[] {
  const analyzedDone = input.analyzedDone;
  const analyzedTotal = input.analyzedTotal;
  const tiTotal = input.tiTotal ?? 0;
  const tiActive = tiTotal > 0;

  const available = (
    id: IntelligencePipelineStageProgress['id'],
    done: number,
    total: number,
  ): IntelligencePipelineStageProgress => ({
    id,
    availability: 'available',
    done,
    total,
  });
  const na = (id: IntelligencePipelineStageProgress['id']): IntelligencePipelineStageProgress => ({
    id,
    availability: 'Not available',
    done: 0,
    total: 0,
  });
  const cohortStage = (
    id: IntelligencePipelineStageProgress['id'],
    done: number,
  ): IntelligencePipelineStageProgress => (tiActive ? available(id, done, tiTotal) : na(id));

  const exitStage = (): IntelligencePipelineStageProgress => {
    // Research / intelligence batch has no open-position cohort → Exit N/A.
    if (input.exitRequiresOpenPosition !== false) {
      return {
        id: 'exit',
        availability: 'prerequisite_missing',
        done: 0,
        total: 0,
        unavailableReason: 'REQUIRES_OPEN_POSITION',
      };
    }
    return cohortStage('exit', input.exitDone ?? 0);
  };

  return [
    available('marketData', analyzedDone, analyzedTotal),
    available('technical', analyzedDone, analyzedTotal),
    cohortStage('fundamental', input.fundamentalDone ?? 0),
    cohortStage('news', input.newsDone ?? 0),
    cohortStage('social', input.socialDone ?? 0),
    cohortStage('macro', input.macroDone ?? 0),
    cohortStage('regime', input.regimeDone ?? 0),
    cohortStage('relativeStrength', input.rsDone ?? 0),
    cohortStage('sector', input.sectorDone ?? 0),
    cohortStage('multiHorizon', input.multiHorizonDone ?? 0),
    cohortStage('thesis', input.thesisDone ?? 0),
    cohortStage('wait', input.waitDone ?? 0),
    exitStage(),
    cohortStage('integrity', input.integrityDone ?? 0),
    cohortStage('ml', input.mlDone ?? 0),
    cohortStage('professionalAnalysis', input.professionalAnalysisDone ?? 0),
  ];
}

export type TiEnrichmentCounts = {
  tiTotal: number;
  regimeDone: number;
  rsDone: number;
  sectorDone: number;
  multiHorizonDone: number;
  fundamentalDone?: number;
  newsDone?: number;
  socialDone?: number;
  macroDone?: number;
  thesisDone?: number;
  waitDone?: number;
  exitDone?: number;
  integrityDone?: number;
  mlDone?: number;
  professionalAnalysisDone?: number;
  /** Research batches default true — Exit N/A without open position. */
  exitRequiresOpenPosition?: boolean;
};

export function computeProgress(
  tasks: BatchSymbolTask[],
  ti?: TiEnrichmentCounts,
): IntelligenceBatchProgress {
  const total = tasks.length;
  const processed = tasks.filter((t) => t.status === 'DONE' || t.status === 'SKIPPED').length;
  const failed = tasks.filter((t) => t.status === 'FAILED').length;
  const pending = Math.max(0, total - processed - failed);
  const percent =
    total === 0 ? 100 : Math.min(100, Math.round(((processed + failed) / total) * 100));
  return {
    processed,
    pending,
    failed,
    totalEligible: total,
    total,
    percent,
    stages: b2PipelineStages({
      analyzedDone: processed,
      analyzedTotal: total,
      tiTotal: ti?.tiTotal,
      regimeDone: ti?.regimeDone,
      rsDone: ti?.rsDone,
      sectorDone: ti?.sectorDone,
      multiHorizonDone: ti?.multiHorizonDone,
      fundamentalDone: ti?.fundamentalDone,
      newsDone: ti?.newsDone,
      socialDone: ti?.socialDone,
      macroDone: ti?.macroDone,
      thesisDone: ti?.thesisDone,
      waitDone: ti?.waitDone,
      exitDone: ti?.exitDone,
      exitRequiresOpenPosition: ti?.exitRequiresOpenPosition ?? true,
      integrityDone: ti?.integrityDone,
      mlDone: ti?.mlDone,
      professionalAnalysisDone: ti?.professionalAnalysisDone,
    }),
  };
}

export function createIntelligenceBatchSkeleton(input: {
  batchId: string;
  universe: IntelligenceBatch['universe'];
  batchType: IntelligenceBatchType;
  mode: IntelligenceBatchMode;
  symbols: string[];
  instrumentSet?: IntelligenceBatch['instrumentSet'];
  now?: number;
  partitionSize?: number;
  scanKind?: IntelligenceBatch['scanKind'];
  sector?: string;
  inverseDownsideThreshold?: number;
  globalEventType?: string;
  universeVersion?: string;
  membershipSource?: string;
  eligibleCount?: number;
  sourceCount?: number;
  adapterVersion?: string;
  providerSelection?: string;
  analysisTimeframe?: string;
  analysisPeriod?: IntelligenceBatch['analysisPeriod'];
  analysisResolution?: IntelligenceBatch['analysisResolution'];
  analysisWindow?: IntelligenceBatch['analysisWindow'];
  predictionHorizon?: string;
  sessionContext?: string;
}): IntelligenceBatch {
  const now = input.now ?? Date.now();
  const partitions = partitionSymbols(input.symbols, input.partitionSize);
  const tasks = buildInitialTasks(partitions);
  return {
    schemaVersion: 'intelligence-batch.v1',
    batchId: input.batchId,
    universe: input.universe,
    batchType: input.batchType,
    mode: input.mode,
    status: 'CREATED',
    lifecycleStage: 'UNIVERSE_RESOLVED',
    symbols: input.symbols,
    instrumentSet: input.instrumentSet,
    universeVersion: input.universeVersion,
    membershipSource: input.membershipSource,
    eligibleCount: input.eligibleCount ?? input.symbols.length,
    sourceCount: input.sourceCount,
    adapterVersion: input.adapterVersion ?? 'asset-adapter.v1',
    providerSelection: input.providerSelection,
    analysisTimeframe: input.analysisTimeframe ?? input.analysisPeriod,
    analysisPeriod: input.analysisPeriod,
    analysisResolution: input.analysisResolution,
    analysisWindow: input.analysisWindow,
    predictionHorizon: input.predictionHorizon,
    sessionContext: input.sessionContext,
    partitions,
    tasks,
    checkpoint: emptyCheckpoint(now),
    progress: computeProgress(tasks),
    featureVersion: INTELLIGENCE_BATCH_FEATURE_VERSION,
    modelVersion: INTELLIGENCE_BATCH_MODEL_VERSION,
    createdAt: now,
    updatedAt: now,
    scanKind: input.scanKind,
    sector: input.sector,
    inverseDownsideThreshold: input.inverseDownsideThreshold,
    globalEventType: input.globalEventType,
  };
}

const TERMINAL: ReadonlySet<IntelligenceBatchStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export function canPause(status: IntelligenceBatchStatus): boolean {
  return status === 'RUNNING' || status === 'RESUMING' || status === 'QUEUED';
}

export function canResume(status: IntelligenceBatchStatus): boolean {
  return status === 'PAUSED' || status === 'PARTIAL';
}

export function canCancel(status: IntelligenceBatchStatus): boolean {
  return !TERMINAL.has(status);
}

export function canRetry(status: IntelligenceBatchStatus): boolean {
  return (
    status === 'FAILED' || status === 'PARTIAL' || status === 'COMPLETED' || status === 'PAUSED'
  );
}

/** Apply checkpoint lists from task statuses (skip DONE/FAILED on resume). */
export function refreshCheckpointFromTasks(
  tasks: BatchSymbolTask[],
  currentSymbol: string | null,
  now = Date.now(),
): BatchCheckpoint {
  const completedSymbols = tasks.filter((t) => t.status === 'DONE').map((t) => t.symbol);
  const failedSymbols = tasks.filter((t) => t.status === 'FAILED').map((t) => t.symbol);
  const running = tasks.find((t) => t.status === 'RUNNING');
  return {
    completedSymbols,
    failedSymbols,
    currentSymbol: currentSymbol ?? running?.symbol ?? null,
    partitionId: running?.partitionId ?? null,
    lastCheckpointAt: now,
  };
}

export function pendingTasksForResume(tasks: BatchSymbolTask[]): BatchSymbolTask[] {
  return tasks.filter((t) => t.status === 'PENDING' || t.status === 'FAILED');
}

export function markFailedTasksPending(tasks: BatchSymbolTask[]): BatchSymbolTask[] {
  return tasks.map((t) =>
    t.status === 'FAILED'
      ? {
          ...t,
          status: 'PENDING' as const,
          error: undefined,
          startedAt: undefined,
          completedAt: undefined,
        }
      : t,
  );
}
