/**
 * Compact intelligence labels from existing IntelligenceSnapshot / AgentAnalysis.
 * Observe-only — never RankingScore, never fabricated fields.
 * undefined = unavailable; never use 0 to mean missing. Availability ≠ favorability.
 */

import type {
  AdvisoryRecommendation,
  ExitRecommendationAction,
  HorizonPrediction,
  IntelligenceBatchContextLabels,
  IntelligenceLifecycleState,
  IntelligenceSnapshot,
  ManipulationBand,
  MLPredictionSnapshot,
  ThesisState,
  TradePlan,
  WaitReevaluateTrigger,
} from '@stockpred/shared-types';
import { toMLPredictionSnapshot } from '@stockpred/shared-types';

const B2_B3_TI_LABEL_KEYS = [
  'regimeCombo',
  'rsBucket',
  'sectorFit',
  'sectorTrend',
  'horizonAgreement',
  'fundamentalScore',
  'macroScore',
  'eventRisk',
] as const;

/**
 * Evidence-based intelligence lifecycle for batch compact context.
 * Processed-by-batch alone does not force SHORTLIST/OPPORTUNITY.
 * MONITORED/DETECTED are not assigned in B4 finalize.
 *
 * Tiered: analysis+snapshot → INTELLIGENCE_ANALYSIS;
 * + B2/B3 TI label → SHORTLIST;
 * + thesisState VALID|WEAKENING|INVALIDATED → OPPORTUNITY.
 */
export function materializeIntelligenceLifecycleState(input: {
  hasAnalysis: boolean;
  hasSnapshot: boolean;
  /** Partial labels after B2/B3 compact (before lifecycle is stamped). */
  labels: IntelligenceBatchContextLabels;
  thesisState?: ThesisState | null;
}): IntelligenceLifecycleState | undefined {
  if (!input.hasAnalysis || !input.hasSnapshot) return undefined;

  const hasTi = B2_B3_TI_LABEL_KEYS.some((k) => {
    const v = input.labels[k];
    return v != null && v !== '';
  });

  const thesisState = input.thesisState;
  if (
    hasTi &&
    (thesisState === 'VALID' || thesisState === 'WEAKENING' || thesisState === 'INVALIDATED')
  ) {
    return 'OPPORTUNITY';
  }

  if (hasTi) return 'SHORTLIST';

  return 'INTELLIGENCE_ANALYSIS';
}

/** Build compact batch labels; omit keys when engines/data did not produce values. */
export function compactIntelligenceBatchContext(input: {
  thesis?: string;
  decision?: string;
  /** Existing analysis.scores.overall only — not RankingScore. */
  overallScore?: number;
  /**
   * B3 scores from analysis — include when capability/data present (any sign).
   * Omit when corresponding data was not observed.
   */
  fundamentalScore?: number | null;
  sentimentScore?: number | null;
  macroScore?: number | null;
  /**
   * @deprecated B3: finite scores alone imply availability (any sign).
   * Kept optional for call-site clarity; ignored for label emission.
   */
  hasFundamentals?: boolean;
  hasMacro?: boolean;
  /** Always allow sentiment label when finite (blended contract); stages stay separate. */
  snapshot?: IntelligenceSnapshot | null;
  /** B4 — T2 / integrity / lifecycle (omit when absent; never invent NONE/HOLD). */
  thesisState?: ThesisState | null;
  waitState?: 'WAIT' | null;
  waitTrigger?: WaitReevaluateTrigger | null;
  exitAdvisory?: ExitRecommendationAction | null;
  integrityStatus?: ManipulationBand | null;
  intelligenceLifecycleState?: IntelligenceLifecycleState | null;
  /** B5 — usable HorizonPrediction or snapshot; compacted only when usable. */
  mlPrediction?: HorizonPrediction | MLPredictionSnapshot | null;
  /** B6 — advisory TradePlan compact fields. */
  tradePlan?: TradePlan | null;
  /** B9–B17 advisory labels — omit when UNAVAILABLE. Never rankingScore. */
  sectorState?: string | null;
  bullRunStage?: string | null;
  bullRunProbability3m?: number | null;
  bullRunV2Cells?: Array<{
    t: number;
    h: '1D' | '1W' | '1M' | '3M' | '6M' | '12M';
    p: number;
    conf?: 'HIGH' | 'MEDIUM' | 'LOW';
  }> | null;
  bullRunDataStatus?: 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN' | null;
  globalEventImpact?: string | null;
  fnoStatus?: string | null;
  /** Quote provenance for TradePlan — omit when VALID. */
  quoteStatus?: 'VALID' | 'MDS_UNAVAILABLE' | 'PRICE_ZERO' | 'MAP_MISS_RECOVERED' | null;
}): IntelligenceBatchContextLabels {
  const labels: IntelligenceBatchContextLabels = {};
  if (input.thesis) labels.thesis = input.thesis;
  if (input.decision) labels.decision = input.decision;
  if (input.overallScore != null && Number.isFinite(input.overallScore)) {
    labels.overallScore = input.overallScore;
  }

  // Any finite score (incl. negative) = observed; omit when null/undefined. Never treat 0 as missing.
  if (input.fundamentalScore != null && Number.isFinite(input.fundamentalScore)) {
    labels.fundamentalScore = input.fundamentalScore;
  }
  if (input.sentimentScore != null && Number.isFinite(input.sentimentScore)) {
    labels.sentimentScore = input.sentimentScore;
  }
  if (input.macroScore != null && Number.isFinite(input.macroScore)) {
    labels.macroScore = input.macroScore;
  }

  const snap = input.snapshot;
  if (snap) {
    const regimeCombo = snap.marketContext?.regimeCombo;
    if (regimeCombo) labels.regimeCombo = String(regimeCombo);

    const rsBucket =
      snap.crossSectionalRs?.rsBucket ?? snap.opportunity?.crossSectionalRs?.rsBucket;
    if (rsBucket) labels.rsBucket = String(rsBucket);

    const sectorFit =
      snap.sectorIntelligence?.sectorFit ?? snap.opportunity?.sectorIntelligence?.sectorFit;
    if (sectorFit) labels.sectorFit = String(sectorFit);

    const sectorTrend =
      snap.sectorIntelligence?.sectorTrend ?? snap.opportunity?.sectorIntelligence?.sectorTrend;
    if (sectorTrend) labels.sectorTrend = String(sectorTrend);

    const horizonAgreement =
      snap.multiHorizonAgreement?.agreement ?? snap.opportunity?.multiHorizonAgreement?.agreement;
    if (horizonAgreement) labels.horizonAgreement = String(horizonAgreement);

    const eventRisk =
      snap.catalystContext?.eventRisk ?? snap.opportunity?.catalystContext?.eventRisk;
    if (eventRisk != null) labels.eventRisk = String(eventRisk);
  }

  if (input.thesisState != null) labels.thesisState = input.thesisState;
  if (input.waitState === 'WAIT') labels.waitState = 'WAIT';
  if (input.waitTrigger != null) labels.waitTrigger = input.waitTrigger;
  if (input.exitAdvisory != null) labels.exitAdvisory = input.exitAdvisory;
  if (input.integrityStatus != null) labels.integrityStatus = input.integrityStatus;
  if (input.intelligenceLifecycleState != null) {
    labels.intelligenceLifecycleState = input.intelligenceLifecycleState;
  }

  applyMlLabels(labels, input.mlPrediction ?? snap?.mlPrediction ?? null);
  applyTradePlanLabels(labels, input.tradePlan ?? null);
  applyB9B17Labels(labels, input);
  if (input.quoteStatus && input.quoteStatus !== 'VALID') {
    labels.quoteStatus = input.quoteStatus;
  }

  return labels;
}

function applyB9B17Labels(
  labels: IntelligenceBatchContextLabels,
  input: {
    sectorState?: string | null;
    bullRunStage?: string | null;
    bullRunProbability3m?: number | null;
    bullRunV2Cells?: Array<{
      t: number;
      h: '1D' | '1W' | '1M' | '3M' | '6M' | '12M';
      p: number;
      conf?: 'HIGH' | 'MEDIUM' | 'LOW';
    }> | null;
    bullRunDataStatus?: 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN' | null;
    globalEventImpact?: string | null;
    fnoStatus?: string | null;
  },
): void {
  if (input.sectorState && input.sectorState !== 'UNKNOWN') {
    labels.sectorState = input.sectorState;
  }
  if (input.bullRunStage && input.bullRunStage !== 'UNKNOWN') {
    labels.bullRunStage = input.bullRunStage;
  }
  if (input.bullRunProbability3m != null && Number.isFinite(input.bullRunProbability3m)) {
    labels.bullRunProbability3m = input.bullRunProbability3m;
  }
  if (Array.isArray(input.bullRunV2Cells) && input.bullRunV2Cells.length > 0) {
    labels.bullRunV2Cells = input.bullRunV2Cells.map((c) => ({
      t: c.t,
      h: c.h,
      p: c.p,
      conf: c.conf,
      status: 'AVAILABLE' as const,
    }));
  }
  if (input.bullRunDataStatus) {
    labels.bullRunDataStatus = input.bullRunDataStatus;
  }
  if (input.globalEventImpact && input.globalEventImpact !== 'UNKNOWN') {
    labels.globalEventImpact = input.globalEventImpact;
  }
  if (input.fnoStatus) {
    labels.fnoStatus = input.fnoStatus;
  }
}

/** Usable ML for batch: not missing/incompatible freshness, not incompatible drift. */
export function isUsableMlForBatch(
  ml: HorizonPrediction | MLPredictionSnapshot | null | undefined,
): boolean {
  if (!ml) return false;
  const freshness = ml.freshnessStatus;
  if (freshness === 'missing' || freshness === 'incompatible') return false;
  if (ml.driftStatus === 'incompatible') return false;
  if (!('modelVersion' in ml) || !ml.modelVersion) return false;
  return true;
}

function applyMlLabels(
  labels: IntelligenceBatchContextLabels,
  ml: HorizonPrediction | MLPredictionSnapshot | null,
): void {
  if (!isUsableMlForBatch(ml) || !ml) return;

  if (ml.horizon != null) labels.mlHorizon = String(ml.horizon);
  if (ml.direction != null) labels.mlDirection = String(ml.direction);
  if (ml.confidence != null && Number.isFinite(ml.confidence)) {
    labels.mlConfidence = ml.confidence;
  }

  const probs =
    'calibratedProbabilities' in ml && ml.calibratedProbabilities
      ? ml.calibratedProbabilities
      : 'probabilities' in ml
        ? (ml as HorizonPrediction).probabilities
        : undefined;
  if (probs?.UP != null && Number.isFinite(probs.UP)) labels.mlProbUp = probs.UP;
  if (probs?.DOWN != null && Number.isFinite(probs.DOWN)) labels.mlProbDown = probs.DOWN;
  if (probs?.SIDEWAYS != null && Number.isFinite(probs.SIDEWAYS)) {
    labels.mlProbSideways = probs.SIDEWAYS;
  }

  if (ml.expectedReturn != null && Number.isFinite(ml.expectedReturn)) {
    labels.mlExpectedReturn = ml.expectedReturn;
  }
  if (ml.expectedMfe != null && Number.isFinite(ml.expectedMfe)) {
    labels.mlExpectedMfe = ml.expectedMfe;
  }
  if (ml.expectedMae != null && Number.isFinite(ml.expectedMae)) {
    labels.mlExpectedMae = ml.expectedMae;
  }
  if (ml.modelId) labels.mlModelId = ml.modelId;
  if (ml.modelVersion) labels.mlModelVersion = ml.modelVersion;
  if (ml.featureVersion) labels.mlFeatureVersion = ml.featureVersion;
  if (ml.freshnessStatus) labels.mlFreshnessStatus = String(ml.freshnessStatus);
  if (ml.driftStatus) labels.mlDriftStatus = String(ml.driftStatus);
}

function applyTradePlanLabels(
  labels: IntelligenceBatchContextLabels,
  plan: TradePlan | null,
): void {
  if (!plan) return;
  labels.tradePlanRecommendation = plan.recommendation as AdvisoryRecommendation;
  if (plan.expectedR != null && Number.isFinite(plan.expectedR)) {
    labels.tradePlanExpectedR = plan.expectedR;
  }
  if (plan.confidence != null && Number.isFinite(plan.confidence)) {
    labels.tradePlanConfidence = plan.confidence;
  }
  if (plan.horizon) labels.tradePlanHorizon = plan.horizon;
  if (plan.assessment?.opportunityQuality) {
    labels.opportunityQuality = plan.assessment.opportunityQuality;
  }
  if (plan.direction) labels.tradePlanDirection = plan.direction;
  if (plan.upsideProbability != null && Number.isFinite(plan.upsideProbability)) {
    labels.upsideProbability = plan.upsideProbability;
  }
  if (plan.expectedReturnRange) {
    if (Number.isFinite(plan.expectedReturnRange.lowPct)) {
      labels.expectedReturnLow = plan.expectedReturnRange.lowPct;
    }
    if (Number.isFinite(plan.expectedReturnRange.highPct)) {
      labels.expectedReturnHigh = plan.expectedReturnRange.highPct;
    }
  }
  if (plan.expectedPriceRange) {
    if (Number.isFinite(plan.expectedPriceRange.low)) {
      labels.expectedPriceLow = plan.expectedPriceRange.low;
    }
    if (Number.isFinite(plan.expectedPriceRange.high)) {
      labels.expectedPriceHigh = plan.expectedPriceRange.high;
    }
  }
  if (plan.entryRange) {
    if (Number.isFinite(plan.entryRange.low)) labels.buyZoneLow = plan.entryRange.low;
    if (Number.isFinite(plan.entryRange.high)) labels.buyZoneHigh = plan.entryRange.high;
  }
  if (plan.preferredEntry != null && Number.isFinite(plan.preferredEntry)) {
    labels.preferredEntry = plan.preferredEntry;
  }
  if (plan.targetRange?.t1 != null && Number.isFinite(plan.targetRange.t1)) {
    labels.target1 = plan.targetRange.t1;
  }
  if (plan.targetRange?.t2 != null && Number.isFinite(plan.targetRange.t2)) {
    labels.target2 = plan.targetRange.t2;
  }
  if (plan.targetRange?.t3 != null && Number.isFinite(plan.targetRange.t3)) {
    labels.target3 = plan.targetRange.t3;
  }
  if (plan.invalidationPrice != null && Number.isFinite(plan.invalidationPrice)) {
    labels.invalidationPrice = plan.invalidationPrice;
  }
  if (plan.exitStrategy) labels.exitStrategy = plan.exitStrategy;
  applyTradePlanCompleteness(labels, plan);
}

const TRADE_PLAN_GEOMETRY_FIELDS = [
  'preferredEntry',
  'buyZoneLow',
  'expectedReturnLow',
  'target1',
  'tradePlanExpectedR',
  'invalidationPrice',
] as const;

/** Derive COMPLETE | PARTIAL | UNAVAILABLE from persisted labels — never invent values. */
export function applyTradePlanCompleteness(
  labels: IntelligenceBatchContextLabels,
  plan: TradePlan | null,
): void {
  if (!plan) {
    labels.tradePlanStatus = 'UNAVAILABLE';
    applyTradePlanExecutionReady(labels);
    return;
  }
  const missing: string[] = [];
  if (labels.preferredEntry == null && labels.buyZoneLow == null) missing.push('preferredEntry');
  if (labels.expectedReturnLow == null && labels.expectedReturnHigh == null) {
    missing.push('expectedReturnRange');
  }
  if (labels.target1 == null) missing.push('targetRange');
  if (labels.tradePlanExpectedR == null) missing.push('expectedR');
  if (labels.invalidationPrice == null) missing.push('invalidationPrice');
  if (labels.buyZoneLow == null && labels.buyZoneHigh == null) missing.push('entryRange');

  if (missing.length === 0 && labels.tradePlanRecommendation != null) {
    labels.tradePlanStatus = 'COMPLETE';
    applyTradePlanExecutionReady(labels);
    return;
  }
  const hasAny =
    labels.tradePlanRecommendation != null ||
    labels.upsideProbability != null ||
    labels.tradePlanConfidence != null ||
    TRADE_PLAN_GEOMETRY_FIELDS.some((k) => labels[k] != null);
  if (!hasAny) {
    labels.tradePlanStatus = 'UNAVAILABLE';
    applyTradePlanExecutionReady(labels);
    return;
  }
  labels.tradePlanStatus = 'PARTIAL';
  if (missing.length > 0) labels.tradePlanMissingFields = missing;
  applyTradePlanExecutionReady(labels);
}

/**
 * APPROVE + COMPLETE → executionReady candidate (still must pass evaluateTrade…).
 * APPROVE + PARTIAL → advisory only; never treat as execution-ready.
 */
export function applyTradePlanExecutionReady(labels: IntelligenceBatchContextLabels): void {
  const complete = labels.tradePlanStatus === 'COMPLETE';
  const approve = labels.tradePlanRecommendation === 'APPROVE';
  if (complete && approve) {
    labels.tradePlanExecutionReady = true;
    return;
  }
  if (labels.tradePlanRecommendation != null || labels.tradePlanStatus != null) {
    labels.tradePlanExecutionReady = false;
  }
}

/** Normalize HorizonPrediction into snapshot for IntelligenceSnapshot when possible. */
export function mlSnapshotForBatch(
  prediction: HorizonPrediction | null | undefined,
): MLPredictionSnapshot | undefined {
  if (!prediction || !isUsableMlForBatch(prediction)) return undefined;
  const snap = toMLPredictionSnapshot(prediction);
  if (snap) return snap;
  // Usable prediction missing modelId/timestamp — still attach a minimal audit snapshot.
  if (!prediction.modelVersion) return undefined;
  return {
    schemaVersion: 'ml-prediction-snapshot.v1',
    modelId: prediction.modelId ?? 'unknown',
    modelVersion: prediction.modelVersion,
    featureVersion: prediction.featureVersion ?? 'unknown',
    datasetVersion: prediction.datasetVersion,
    horizon: String(prediction.horizon),
    predictionTimestamp:
      prediction.predictionTimestamp ?? new Date(prediction.generatedAt).toISOString(),
    expiresAt: prediction.expiresAt,
    freshnessStatus: prediction.freshnessStatus ?? 'fresh',
    driftStatus: prediction.driftStatus ?? 'insufficient_data',
    direction: prediction.direction,
    confidence: prediction.confidence,
    calibratedProbabilities: prediction.calibratedProbabilities,
    expectedReturn: prediction.expectedReturn,
    expectedMfe: prediction.expectedMfe,
    expectedMae: prediction.expectedMae,
  };
}

/** Max numeric provenance among known TI/quote timestamps (ms). */
export function resolveTiDataAsOf(
  times: Array<string | number | null | undefined>,
): number | undefined {
  let max = 0;
  for (const t of times) {
    if (t == null) continue;
    const n = typeof t === 'number' ? t : Date.parse(String(t));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max > 0 ? max : undefined;
}

export type BatchPresenceFlags = {
  fundamental: boolean;
  news: boolean;
  social: boolean;
  macro: boolean;
  thesis?: boolean;
  wait?: boolean;
  exit?: boolean;
  integrity?: boolean;
  ml?: boolean;
  professionalAnalysis?: boolean;
};

/**
 * Derive presence from usedCapabilities and/or finite scores.
 * Favorability irrelevant; news/social never inferred from sentimentScore.
 */
export function presenceFromUsedCapabilities(
  used: string[] | undefined | null,
  scores?: {
    fundamental?: number | null;
    macro?: number | null;
  },
  extras?: {
    thesis?: boolean;
    wait?: boolean;
    exit?: boolean;
    integrity?: boolean;
    ml?: boolean;
    professionalAnalysis?: boolean;
  },
): BatchPresenceFlags {
  const set = new Set((used ?? []).map((c) => c.toLowerCase()));
  const fundScorePresent = scores?.fundamental != null && Number.isFinite(scores.fundamental);
  const macroScorePresent = scores?.macro != null && Number.isFinite(scores.macro);
  return {
    fundamental: set.has('fundamentals') || fundScorePresent,
    news: set.has('alt-news'),
    social: set.has('alt-social'),
    macro: set.has('alt-macro') || macroScorePresent,
    thesis: extras?.thesis === true,
    wait: extras?.wait === true,
    exit: extras?.exit === true,
    integrity: extras?.integrity === true || set.has('manipulation'),
    ml: extras?.ml === true,
    professionalAnalysis: extras?.professionalAnalysis === true,
  };
}

/**
 * Count enrichment labels over rows. tiTotal MUST be the DONE cohort size when provided —
 * never use rankingCandidates.length as the coverage denominator.
 */
export function countTiEnrichmentFromLabels(
  rows: Array<{
    intelligenceContext?: IntelligenceBatchContextLabels;
    presence?: BatchPresenceFlags;
  }>,
  options?: { tiTotal?: number },
): {
  tiTotal: number;
  regimeDone: number;
  rsDone: number;
  sectorDone: number;
  multiHorizonDone: number;
  fundamentalDone: number;
  newsDone: number;
  socialDone: number;
  macroDone: number;
  thesisDone: number;
  waitDone: number;
  exitDone: number;
  integrityDone: number;
  mlDone: number;
  professionalAnalysisDone: number;
} {
  const tiTotal =
    options?.tiTotal != null && Number.isFinite(options.tiTotal)
      ? Math.max(0, Math.floor(options.tiTotal))
      : rows.length;
  let regimeDone = 0;
  let rsDone = 0;
  let sectorDone = 0;
  let multiHorizonDone = 0;
  let fundamentalDone = 0;
  let newsDone = 0;
  let socialDone = 0;
  let macroDone = 0;
  let thesisDone = 0;
  let waitDone = 0;
  let exitDone = 0;
  let integrityDone = 0;
  let mlDone = 0;
  let professionalAnalysisDone = 0;
  for (const row of rows) {
    const c = row.intelligenceContext;
    if (c?.regimeCombo) regimeDone += 1;
    if (c?.rsBucket) rsDone += 1;
    if (c?.sectorFit || c?.sectorTrend) sectorDone += 1;
    if (c?.horizonAgreement) multiHorizonDone += 1;
    if (c?.thesisState != null) thesisDone += 1;
    if (c?.waitTrigger != null || c?.waitState === 'WAIT') waitDone += 1;
    if (c?.exitAdvisory != null) exitDone += 1;
    if (c?.integrityStatus != null) integrityDone += 1;
    if (c?.mlModelVersion != null || c?.mlDirection != null) mlDone += 1;
    if (c?.tradePlanRecommendation != null || c?.opportunityQuality != null) {
      professionalAnalysisDone += 1;
    }
    const p = row.presence;
    if (p?.fundamental) fundamentalDone += 1;
    if (p?.news) newsDone += 1;
    if (p?.social) socialDone += 1;
    if (p?.macro) macroDone += 1;
  }
  return {
    tiTotal,
    regimeDone,
    rsDone,
    sectorDone,
    multiHorizonDone,
    fundamentalDone,
    newsDone,
    socialDone,
    macroDone,
    thesisDone,
    waitDone,
    exitDone,
    integrityDone,
    mlDone,
    professionalAnalysisDone,
  };
}
