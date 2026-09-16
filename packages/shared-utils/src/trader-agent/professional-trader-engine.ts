/**
 * B6 Professional Trader engine — structured advisory assessment + TradePlan.
 * Isolated: never calls evaluateTrade / Risk / Portfolio / Policy / Gate / broker.
 */

import type {
  AgentAnalysis,
  AdvisoryRecommendation,
  IntelligenceSnapshot,
  OpportunityQuality,
  ProfessionalTraderAssessment,
  ProfessionalTraderDirection,
  ProfessionalTraderEvidenceItem,
  TradePlan,
} from '@stockpred/shared-types';
import { INTELLIGENCE_BATCH_FEATURE_VERSION } from '@stockpred/shared-types';

export const PROFESSIONAL_TRADER_ENGINE_VERSION = 'professional-trader.v1';

export interface BuildTradePlanInput {
  now: number;
  opportunityId: string;
  analysis: AgentAnalysis;
  snapshot: IntelligenceSnapshot;
  rankingContextVersion?: string;
  /** When thesis is WAIT-oriented, prefer WAIT recommendation. */
  preferWait?: boolean;
  /** B9–B17 advisory context only — never rankingScore / authorization. */
  advisoryContext?: {
    sectorState?: string | null;
    bullRunStage?: string | null;
    bullRunProbability3m?: number | null;
    globalEventImpact?: string | null;
    fnoStatus?: string | null;
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function directionFromAnalysis(analysis: AgentAnalysis): ProfessionalTraderDirection {
  const d = String(analysis.decision ?? '').toUpperCase();
  if (d === 'BUY' || d === 'LONG' || d === 'STRONG_BUY' || d.startsWith('BUY_ON')) {
    return 'LONG';
  }
  if (d === 'SELL' || d === 'SHORT' || d === 'STRONG_SELL') return 'SHORT';
  return 'FLAT';
}

function qualityFromScore(overall: number | null | undefined): OpportunityQuality {
  if (overall == null || !Number.isFinite(overall)) return 'INSUFFICIENT';
  if (overall >= 75) return 'HIGH';
  if (overall >= 55) return 'MEDIUM';
  if (overall >= 40) return 'LOW';
  return 'INSUFFICIENT';
}

function collectEvidence(
  analysis: AgentAnalysis,
  snapshot: IntelligenceSnapshot,
  advisory?: BuildTradePlanInput['advisoryContext'],
): ProfessionalTraderEvidenceItem[] {
  const items: ProfessionalTraderEvidenceItem[] = [];
  if (snapshot.marketContext?.regimeCombo) {
    items.push({
      code: 'REGIME',
      message: `Regime ${snapshot.marketContext.regimeCombo}`,
      source: 'marketContext.regimeCombo',
      polarity: 'NEUTRAL',
    });
  }
  const rs = snapshot.crossSectionalRs?.rsBucket;
  if (rs) {
    items.push({
      code: 'RS',
      message: `RS ${rs}`,
      source: 'crossSectionalRs.rsBucket',
      polarity: rs === 'LEADERS' ? 'POSITIVE' : 'NEUTRAL',
    });
  }
  const sector = snapshot.sectorIntelligence?.sectorFit;
  if (sector) {
    items.push({
      code: 'SECTOR',
      message: `Sector fit ${sector}`,
      source: 'sectorIntelligence.sectorFit',
      polarity: sector === 'HIGH' ? 'POSITIVE' : 'NEUTRAL',
    });
  }
  if (advisory?.sectorState) {
    items.push({
      code: 'SECTOR_STATE',
      message: `Sector state ${advisory.sectorState}`,
      source: 'b9.sectorState',
      polarity:
        advisory.sectorState === 'LEADING' || advisory.sectorState === 'IMPROVING'
          ? 'POSITIVE'
          : advisory.sectorState === 'LAGGING' || advisory.sectorState === 'WEAKENING'
            ? 'NEGATIVE'
            : 'NEUTRAL',
    });
  }
  if (advisory?.bullRunStage) {
    items.push({
      code: 'BULL_RUN',
      message: `Bull-run stage ${advisory.bullRunStage}`,
      source: 'b10.bullRunStage',
      polarity:
        advisory.bullRunStage === 'FAILED' || advisory.bullRunStage === 'WEAKENING'
          ? 'NEGATIVE'
          : 'POSITIVE',
    });
  }
  if (advisory?.globalEventImpact) {
    items.push({
      code: 'GLOBAL_EVENT',
      message: `Global event impact ${advisory.globalEventImpact}`,
      source: 'b17.globalEventImpact',
      polarity:
        advisory.globalEventImpact === 'POSITIVE'
          ? 'POSITIVE'
          : advisory.globalEventImpact === 'NEGATIVE'
            ? 'NEGATIVE'
            : 'NEUTRAL',
    });
  }
  if (advisory?.fnoStatus) {
    items.push({
      code: 'FNO',
      message: `F&O ${advisory.fnoStatus}`,
      source: 'b15.fnoStatus',
      polarity: 'UNKNOWN',
    });
  }
  if (analysis.scores.fundamental != null && Number.isFinite(analysis.scores.fundamental)) {
    items.push({
      code: 'FUNDAMENTAL',
      message: `Fundamental score ${analysis.scores.fundamental}`,
      source: 'analysis.scores.fundamental',
      polarity: analysis.scores.fundamental >= 0 ? 'POSITIVE' : 'NEGATIVE',
    });
  }
  if (snapshot.mlPrediction?.direction) {
    items.push({
      code: 'ML',
      message: `ML direction ${snapshot.mlPrediction.direction}`,
      source: 'mlPrediction.direction',
      polarity: 'NEUTRAL',
    });
  }
  if (snapshot.catalystContext?.eventRisk) {
    items.push({
      code: 'CATALYST',
      message: `Event risk ${snapshot.catalystContext.eventRisk}`,
      source: 'catalystContext.eventRisk',
      polarity:
        snapshot.catalystContext.eventRisk === 'HIGH'
          ? 'NEGATIVE'
          : snapshot.catalystContext.eventRisk === 'LOW'
            ? 'POSITIVE'
            : 'NEUTRAL',
    });
  }
  return items;
}

function advisoryRecommendation(
  quality: OpportunityQuality,
  preferWait: boolean,
  eventRisk?: string,
): AdvisoryRecommendation {
  if (preferWait) return 'WAIT';
  if (eventRisk === 'HIGH') return 'WAIT';
  if (quality === 'HIGH' || quality === 'MEDIUM') return 'APPROVE';
  if (quality === 'LOW') return 'WAIT';
  return 'REJECT';
}

/** Build structured assessment from existing intelligence — never invents ML/auth. */
export function buildProfessionalTraderAssessment(
  input: BuildTradePlanInput,
): ProfessionalTraderAssessment {
  const { analysis, snapshot, now } = input;
  const overall = analysis.scores.overall;
  const quality = qualityFromScore(overall);
  const ml = snapshot.mlPrediction;
  const calUp = ml?.calibratedProbabilities?.UP;
  const probability =
    calUp != null && Number.isFinite(calUp)
      ? clamp01(calUp)
      : ml?.confidence != null && Number.isFinite(ml.confidence)
        ? clamp01(ml.confidence / 100)
        : overall != null && Number.isFinite(overall)
          ? clamp01(overall / 100)
          : undefined;

  const entry = analysis.setup?.entry;
  const t1 = analysis.setup?.target1;
  const expectedReturnPct =
    entry != null && t1 != null && entry > 0
      ? {
          low: ((t1 - entry) / entry) * 100 * 0.5,
          high: ((t1 - entry) / entry) * 100,
        }
      : ml?.expectedReturn != null && Number.isFinite(ml.expectedReturn)
        ? { low: ml.expectedReturn * 0.5, high: ml.expectedReturn }
        : undefined;

  const risks: string[] = [];
  if (snapshot.catalystContext?.eventRisk === 'HIGH') risks.push('Elevated event risk');
  if (snapshot.regimeCompatibility?.compatibility === 'UNFAVORABLE') {
    risks.push('Regime unfavorable for setup');
  }
  if (ml?.freshnessStatus === 'stale') risks.push('ML prediction stale');

  const invalidation: string[] = [];
  if (analysis.invalidation) invalidation.push(analysis.invalidation);
  if (analysis.setup?.stopLoss != null) {
    invalidation.push(`Stop / invalidation near ${analysis.setup.stopLoss}`);
  }

  const modelVersions = [ml?.modelVersion].filter((v): v is string => !!v);

  return {
    schemaVersion: 'professional-trader.v1',
    symbol: analysis.symbol,
    direction: directionFromAnalysis(analysis),
    opportunityQuality: quality,
    probability,
    expectedReturnPct,
    expectedR: analysis.setup?.riskReward ?? undefined,
    horizon: analysis.setup?.expectedHoldingPeriod ?? ml?.horizon,
    confidence:
      ml?.confidence != null && Number.isFinite(ml.confidence)
        ? ml.confidence
        : overall != null && Number.isFinite(overall)
          ? overall
          : undefined,
    evidence: collectEvidence(analysis, snapshot, input.advisoryContext),
    risks,
    invalidation,
    reasoning: [
      `Opportunity quality ${quality}`,
      analysis.thesis ? `Thesis: ${analysis.thesis}` : 'Thesis from analysis',
      'Advisory only — authorization requires evaluateTrade() chain',
    ],
    provenance: {
      generatedAt: new Date(now).toISOString(),
      dataAsOf: ml?.predictionTimestamp ?? snapshot.sourceDataTimestamp ?? undefined,
      intelligenceVersion: INTELLIGENCE_BATCH_FEATURE_VERSION,
      modelVersions,
    },
  };
}

/** Build advisory TradePlan. Never calls evaluateTrade or brokers. */
export function buildTradePlan(input: BuildTradePlanInput): TradePlan {
  const assessment = buildProfessionalTraderAssessment(input);
  const { analysis, snapshot, now, opportunityId } = input;
  const entry = analysis.setup?.entry;
  const stop = analysis.setup?.stopLoss;
  const t1 = analysis.setup?.target1;
  const t2 = analysis.setup?.target2;
  const t3 = analysis.setup?.target3;
  const rec = advisoryRecommendation(
    assessment.opportunityQuality,
    input.preferWait === true,
    snapshot.catalystContext?.eventRisk,
  );

  const entryRange =
    entry != null && Number.isFinite(entry)
      ? { low: entry * 0.995, high: entry * 1.005 }
      : undefined;

  const expectedPriceRange =
    entry != null && t1 != null
      ? { low: Math.min(entry, t1), high: Math.max(entry, t1) }
      : undefined;

  return {
    schemaVersion: 'trade-plan.v1',
    opportunityId,
    symbol: analysis.symbol,
    direction: assessment.direction,
    entryRange,
    preferredEntry: entry ?? undefined,
    upsideProbability: assessment.probability,
    expectedReturnRange: assessment.expectedReturnPct
      ? {
          lowPct: assessment.expectedReturnPct.low,
          highPct: assessment.expectedReturnPct.high,
        }
      : undefined,
    expectedPriceRange,
    horizon: assessment.horizon,
    targetRange: {
      t1: t1 ?? undefined,
      t2: t2 ?? undefined,
      t3: t3 ?? undefined,
    },
    invalidationPrice: stop ?? undefined,
    expectedR: assessment.expectedR ?? undefined,
    confidence: assessment.confidence,
    cutoffTime: now + 3 * 24 * 60 * 60 * 1000,
    thesis: analysis.thesis,
    catalyst: snapshot.catalystContext?.eventRisk
      ? `eventRisk=${snapshot.catalystContext.eventRisk}`
      : undefined,
    regime: snapshot.marketContext?.regimeCombo,
    exitStrategy: 'Advisory targets/invalidation — execution via evaluateTrade chain only',
    reassessmentRequired: rec === 'WAIT' || snapshot.catalystContext?.eventRisk === 'HIGH',
    recommendation: rec,
    assessment,
    provenance: {
      generatedAt: new Date(now).toISOString(),
      dataAsOf: assessment.provenance.dataAsOf,
      intelligenceVersion: INTELLIGENCE_BATCH_FEATURE_VERSION,
      modelVersions: assessment.provenance.modelVersions ?? [],
      rankingContextVersion: input.rankingContextVersion,
    },
  };
}
