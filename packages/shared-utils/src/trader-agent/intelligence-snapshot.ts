/**
 * Observe-only Trade Intelligence builder (Phase 4 / T1).
 *
 * CRITICAL: The snapshot object must NEVER be passed into evaluateRisk /
 * evaluatePortfolio / applyDecisionPolicy / Gate. Intelligence may enrich
 * evaluateTrade *inputs* via analysis composition upstream; Risk/Portfolio/
 * Policy/Gate remain absolute and snapshot-blind.
 */
import {
  INTELLIGENCE_ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  type AgentAnalysis,
  type HorizonPrediction,
  type IntelligenceSnapshot,
  type MLPredictionSnapshot,
  type StrategyTag,
  type TradeDecision,
  toMLPredictionSnapshot,
} from '@stockpred/shared-types';
import { assessMarketRegime, scannerRegimeFromRiskLabel } from './market-regime-engine';
import { assessStockOpportunity, computeGeometricExpectedR } from './stock-opportunity-model';
import { assessCrossSectionalRs, assessSectorIntelligence } from './cross-sectional-rs-engine';
import { assessMultiHorizonAgreement, inferTradeHorizon } from './multi-horizon-agreement-engine';
import {
  assessRegimeCompatibility,
  buildMarketRegimeDimensions,
} from './regime-compatibility-engine';
import { assessCatalystContext, type CatalystEventCandidate } from './catalyst-context-engine';
import type {
  MarketReactionContext,
  TiChartHorizon,
  TiTradeHorizon,
} from '@stockpred/shared-types';

function inferStrategyTag(analysis: AgentAnalysis, decision: TradeDecision): StrategyTag {
  const blob = `${decision.strategy} ${analysis.thesis} ${analysis.action}`.toUpperCase();
  if (blob.includes('BREAKOUT')) return 'BREAKOUT';
  if (blob.includes('MEAN') || blob.includes('REVERSION')) return 'MEAN_REVERSION';
  if (blob.includes('MOMENTUM')) return 'MOMENTUM';
  if (blob.includes('VALUE')) return 'VALUE';
  if (blob.includes('EVENT') || blob.includes('NEWS')) return 'EVENT_DRIVEN';
  if (blob.includes('TREND')) return 'TREND_FOLLOWING';
  if (decision.strategy) return 'COMPOSITE';
  return 'UNKNOWN';
}

function clampScore(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface BuildIntelligenceSnapshotInput {
  analysis: AgentAnalysis;
  decision: TradeDecision;
  sourceDataTimestamp?: string | number;
  now?: number;
  /** Usable ML prediction only â€” omit when stale/incompatible/missing. */
  mlPrediction?: HorizonPrediction | MLPredictionSnapshot | null;
  /** Optional market context from MDS (scanner regime / VIX / breadth). */
  marketContext?: {
    scannerRegime?: string;
    vixLevel?: number | null;
    niftyChangePercent?: number | null;
    breadthPercentAboveEma50?: number | null;
    asOf?: string | number;
  };
  /** T1.4 optional cross-sectional / sector inputs (observe-only). */
  crossSectional?: {
    rsVsNifty50?: number | null;
    peerRsValues?: number[] | null;
    sector?: string | null;
    sectorMedianRs?: number | null;
    peVsMedianPct?: number | null;
    pbVsMedianPct?: number | null;
    asOf?: string | number;
  };
  /** T1.5 optional multi-horizon closes (observe-only). */
  multiHorizon?: {
    tradeHorizon?: TiTradeHorizon;
    intendedSide?: 'LONG' | 'SHORT';
    closesByHorizon?: Partial<Record<TiChartHorizon, number[] | null | undefined>>;
    sourceDataTimestamp?: string;
    asOf?: string | number;
  };
  /** T1.7 optional catalyst / event candidates (observe-only; look-ahead filtered). */
  catalyst?: {
    candidates?: CatalystEventCandidate[];
    marketReaction?: MarketReactionContext;
    /** Defaults to sourceDataTimestamp / now when omitted. */
    decisionTimestamp?: string | number;
    /** Observed alt-data time when known — not invent a new schema; feeds assessCatalystContext.asOf. */
    asOf?: string | number;
  };
}

/**
 * Build a best-effort IntelligenceSnapshot from existing analysis + T1 alpha.
 * Missing fields are omitted â€” observation does not require completeness.
 */
export function buildIntelligenceSnapshot(
  input: BuildIntelligenceSnapshotInput,
): IntelligenceSnapshot {
  const now = input.now ?? Date.now();
  const { analysis, decision } = input;
  const entry = decision.setup.entry;
  const stop = decision.setup.stopLoss;
  const target = decision.setup.target1;
  const riskPerShare =
    entry != null && stop != null && entry > 0 && stop > 0 ? Math.abs(entry - stop) : null;
  const rewardPerShare =
    entry != null && target != null && entry > 0 && target > 0 ? Math.abs(target - entry) : null;
  const rewardR =
    riskPerShare && riskPerShare > 0 && rewardPerShare != null
      ? rewardPerShare / riskPerShare
      : undefined;

  const technical = clampScore(analysis.scores.technical);
  const fundamental = clampScore(analysis.scores.fundamental);
  const sentiment = clampScore(analysis.scores.sentiment);
  const momentum = clampScore(analysis.scores.technical);
  const overall = clampScore(decision.signalScore);

  const regimeAssessment = assessMarketRegime({
    scannerRegime:
      input.marketContext?.scannerRegime ?? scannerRegimeFromRiskLabel(analysis.marketRegime),
    vixLevel: input.marketContext?.vixLevel,
    niftyChangePercent: input.marketContext?.niftyChangePercent,
    breadthPercentAboveEma50: input.marketContext?.breadthPercentAboveEma50,
    asOf: input.marketContext?.asOf ?? now,
  });

  const mlPrediction: MLPredictionSnapshot | undefined =
    input.mlPrediction == null
      ? undefined
      : 'schemaVersion' in input.mlPrediction || 'modelVersion' in input.mlPrediction
        ? 'schemaVersion' in input.mlPrediction
          ? (input.mlPrediction as MLPredictionSnapshot)
          : toMLPredictionSnapshot(input.mlPrediction as HorizonPrediction)
        : toMLPredictionSnapshot(input.mlPrediction as HorizonPrediction);

  const opportunity = assessStockOpportunity({
    ml: input.mlPrediction ?? mlPrediction,
    directionRegime: regimeAssessment.directionRegime,
    holdingPeriodSessions: 5,
  });

  const expectedValue = computeGeometricExpectedR({
    rewardR,
    riskR: rewardR != null ? 1 : null,
    expectedMfe: opportunity?.expectedMfe ?? mlPrediction?.expectedMfe,
    expectedMae: opportunity?.expectedMae ?? mlPrediction?.expectedMae,
    pUp: opportunity?.pUp,
    pDown: opportunity?.pDown,
    probabilitySource: opportunity?.probabilitySource ?? 'HEURISTIC',
    side: 'LONG',
  });

  const expectedValueFilled =
    expectedValue.expectedValueR != null
      ? expectedValue
      : overall != null && rewardR != null
        ? computeGeometricExpectedR({
            rewardR,
            riskR: 1,
            pUp: Math.min(0.85, Math.max(0.35, overall / 100)),
            pDown: Math.min(0.55, Math.max(0.15, 1 - overall / 100 - 0.1)),
            probabilitySource: 'HEURISTIC',
            side: 'LONG',
          })
        : expectedValue;

  const crossSectionalRs = input.crossSectional
    ? assessCrossSectionalRs({
        rsVsNifty50: input.crossSectional.rsVsNifty50,
        peerRsValues: input.crossSectional.peerRsValues,
        asOf: input.crossSectional.asOf ?? now,
      })
    : undefined;

  const sectorIntelligence = input.crossSectional
    ? assessSectorIntelligence({
        sector: input.crossSectional.sector,
        sectorMedianRs: input.crossSectional.sectorMedianRs,
        stockRsVsNifty50: input.crossSectional.rsVsNifty50,
        peVsMedianPct: input.crossSectional.peVsMedianPct,
        pbVsMedianPct: input.crossSectional.pbVsMedianPct,
        rsBucket: crossSectionalRs?.rsBucket,
        asOf: input.crossSectional.asOf ?? now,
      })
    : undefined;

  const multiHorizonAgreement = input.multiHorizon
    ? assessMultiHorizonAgreement({
        tradeHorizon:
          input.multiHorizon.tradeHorizon ??
          inferTradeHorizon(analysis.setup?.expectedHoldingPeriod),
        intendedSide: input.multiHorizon.intendedSide ?? 'LONG',
        closesByHorizon: input.multiHorizon.closesByHorizon,
        sourceDataTimestamp: input.multiHorizon.sourceDataTimestamp,
        asOf: input.multiHorizon.asOf ?? now,
      })
    : undefined;

  const strategyTag = inferStrategyTag(analysis, decision);
  const tradeHorizon =
    input.multiHorizon?.tradeHorizon ??
    multiHorizonAgreement?.tradeHorizon ??
    inferTradeHorizon(analysis.setup?.expectedHoldingPeriod);
  const regimeDimensions = buildMarketRegimeDimensions({
    regime: regimeAssessment,
    sectorTrend: sectorIntelligence?.sectorTrend,
    sourceDataTimestamp:
      input.marketContext?.asOf != null
        ? typeof input.marketContext.asOf === 'number'
          ? new Date(input.marketContext.asOf).toISOString()
          : String(input.marketContext.asOf)
        : undefined,
  });
  const regimeCompatibility = assessRegimeCompatibility({
    setupStyle: strategyTag,
    intendedSide: input.multiHorizon?.intendedSide ?? 'LONG',
    tradeHorizon,
    dimensions: regimeDimensions,
    sourceDataTimestamp: regimeDimensions.provenance?.sourceDataTimestamp,
    asOf: regimeAssessment.asOf,
  });

  const intendedSide = input.multiHorizon?.intendedSide ?? 'LONG';
  const catalystDecisionTs =
    input.catalyst?.decisionTimestamp ??
    input.sourceDataTimestamp ??
    decision.quoteTimestamp ??
    now;
  const catalystContext = input.catalyst
    ? assessCatalystContext({
        intendedSide,
        tradeHorizon,
        decisionTimestamp: catalystDecisionTs,
        candidates: input.catalyst.candidates,
        marketReaction: input.catalyst.marketReaction,
        asOf: (() => {
          const observed = input.catalyst.asOf;
          if (observed != null) {
            return typeof observed === 'number'
              ? new Date(observed).toISOString()
              : String(observed);
          }
          return typeof catalystDecisionTs === 'number'
            ? new Date(catalystDecisionTs).toISOString()
            : String(catalystDecisionTs);
        })(),
      })
    : undefined;

  const hasSector =
    !!sectorIntelligence &&
    (sectorIntelligence.sectorFit !== 'UNKNOWN' ||
      sectorIntelligence.sectorTrend !== 'UNKNOWN' ||
      sectorIntelligence.valuationVsPeers !== 'UNKNOWN' ||
      !!sectorIntelligence.sector);
  const hasRs = !!crossSectionalRs && crossSectionalRs.source !== 'MISSING';
  const hasCatalyst =
    !!catalystContext &&
    (catalystContext.events.length > 0 ||
      catalystContext.eventRisk !== 'NONE' ||
      catalystContext.conflicts.length > 0);
  const opportunityEnriched =
    opportunity == null &&
    !hasRs &&
    !hasSector &&
    !multiHorizonAgreement &&
    !regimeCompatibility &&
    !hasCatalyst
      ? undefined
      : {
          ...(opportunity ?? {}),
          ...(hasRs ? { crossSectionalRs } : {}),
          ...(hasSector ? { sectorIntelligence } : {}),
          ...(multiHorizonAgreement ? { multiHorizonAgreement } : {}),
          ...(regimeCompatibility ? { regimeCompatibility } : {}),
          ...(hasCatalyst ? { catalystContext } : {}),
        };

  const conflicts: NonNullable<IntelligenceSnapshot['conflicts']> = [];
  // Prefer T1.6 granular regime soft-conflicts over the blunt RISK_OFF flag.
  if (regimeCompatibility) {
    for (const c of regimeCompatibility.conflicts) {
      conflicts.push({
        code: c.code,
        severity: c.code === 'REGIME_UNFAVORABLE' ? 'WARN' : 'INFO',
        message: c.message,
        factors: ['regimeCompatibility', ...(c.dimension ? [c.dimension] : [])],
      });
    }
  } else if (
    regimeAssessment.riskCompatibility === 'RISK_OFF' ||
    analysis.marketRegime === 'RISK_OFF'
  ) {
    conflicts.push({
      code: 'REGIME_HOSTILE',
      severity: 'WARN',
      message: `Strong setup signals vs ${regimeAssessment.regimeCombo} (riskCompatibility=RISK_OFF)`,
      factors: ['tradeQuality', 'marketContext'],
    });
  }
  if (crossSectionalRs?.rsBucket === 'LAGGARDS') {
    conflicts.push({
      code: 'RS_LAGGARD',
      severity: 'WARN',
      message: `Cross-sectional RS is LAGGARDS (rsVsNifty50=${crossSectionalRs.rsVsNifty50 ?? 'n/a'})`,
      factors: ['crossSectionalRs', 'tradeQuality'],
    });
  }
  if (sectorIntelligence?.sectorTrend === 'LAGGING') {
    conflicts.push({
      code: 'SECTOR_LAGGING',
      severity: 'INFO',
      message: `Sector ${sectorIntelligence.sector ?? 'unknown'} trend is LAGGING vs market`,
      factors: ['sectorIntelligence', 'marketContext'],
    });
  }
  if (sectorIntelligence?.valuationVsPeers === 'RICH') {
    conflicts.push({
      code: 'SECTOR_RICH_VALUATION',
      severity: 'INFO',
      message: `Valuation rich vs sector peers (PE vs median ${sectorIntelligence.peVsMedianPct ?? 'n/a'}%)`,
      factors: ['sectorIntelligence'],
    });
  }
  if (multiHorizonAgreement) {
    for (const c of multiHorizonAgreement.conflicts) {
      conflicts.push({
        code: c.code,
        severity: c.code.startsWith('HORIZON_PRIMARY') ? 'WARN' : 'INFO',
        message: c.message,
        factors: ['multiHorizonAgreement', ...(c.horizons ?? [])],
      });
    }
    if (
      multiHorizonAgreement.agreement === 'LOW' &&
      !multiHorizonAgreement.conflicts.some((c) => c.code === 'HORIZON_PRIMARY_DISAGREE')
    ) {
      conflicts.push({
        code: 'HORIZON_AGREEMENT_LOW',
        severity: 'INFO',
        message: `Primary-horizon agreement LOW for ${multiHorizonAgreement.tradeHorizon}`,
        factors: ['multiHorizonAgreement'],
      });
    }
  }
  if (catalystContext) {
    for (const c of catalystContext.conflicts) {
      conflicts.push({
        code: c.code,
        severity: c.code === 'EVENT_RISK_HIGH' || c.code === 'EARNINGS_NEAR' ? 'WARN' : 'INFO',
        message: c.message,
        factors: ['catalystContext', ...(c.eventIds ?? [])],
      });
    }
  }

  const sourceTs =
    input.sourceDataTimestamp != null
      ? typeof input.sourceDataTimestamp === 'number'
        ? new Date(input.sourceDataTimestamp).toISOString()
        : input.sourceDataTimestamp
      : decision.quoteTimestamp
        ? new Date(decision.quoteTimestamp).toISOString()
        : new Date(now).toISOString();

  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    generatedAt: new Date(now).toISOString(),
    sourceDataTimestamp: sourceTs,
    strategyTag,
    ...(mlPrediction ? { mlPrediction } : {}),
    ...(opportunityEnriched ? { opportunity: opportunityEnriched } : {}),
    ...(crossSectionalRs && crossSectionalRs.source !== 'MISSING' ? { crossSectionalRs } : {}),
    ...(sectorIntelligence &&
    (sectorIntelligence.sectorFit !== 'UNKNOWN' ||
      sectorIntelligence.sectorTrend !== 'UNKNOWN' ||
      sectorIntelligence.valuationVsPeers !== 'UNKNOWN' ||
      sectorIntelligence.sector)
      ? { sectorIntelligence }
      : {}),
    ...(multiHorizonAgreement ? { multiHorizonAgreement } : {}),
    ...(regimeCompatibility ? { regimeCompatibility } : {}),
    ...(hasCatalyst ? { catalystContext } : {}),
    marketContext: {
      regime: regimeAssessment.directionRegime,
      volatilityRegime: regimeAssessment.volatilityRegime,
      directionRegime: regimeAssessment.directionRegime,
      regimeCombo: regimeAssessment.regimeCombo,
      asOf: regimeAssessment.asOf,
      scannerRegime: regimeAssessment.scannerRegime,
      riskCompatibility: regimeAssessment.riskCompatibility,
      breadth: regimeAssessment.breadth,
      vixLevel: regimeAssessment.vixLevel,
      niftyChangePercent: regimeAssessment.niftyChangePercent,
      indexTrend: regimeAssessment.directionRegime,
      sectorTrend: sectorIntelligence?.sectorTrend,
      liquidity: regimeDimensions.liquidity,
    },
    thesis: {
      direction: 'LONG',
      setup: decision.strategy || analysis.action || 'COMPOSITE',
      rationale: [decision.thesis, ...(decision.reasons ?? [])].filter(Boolean).slice(0, 6),
      entryReason: entry != null ? `Entry near ${entry}` : undefined,
      invalidation: {
        price: stop ?? undefined,
        conditions: decision.invalidation
          ? [decision.invalidation]
          : stop != null
            ? [`Close below ${stop}`]
            : [],
      },
      target: {
        price: target ?? undefined,
        expectedR: rewardR,
      },
      expectedHoldingPeriodSessions: opportunity?.holdingPeriodSessions ?? 5,
      thesisConfidence: decision.confidence,
    },
    expectedValue:
      expectedValueFilled.expectedValueR != null || expectedValueFilled.probabilityTarget != null
        ? expectedValueFilled
        : undefined,
    tradeQuality: {
      technical,
      fundamental,
      momentum,
      sentiment,
      relativeStrength:
        crossSectionalRs?.rsPercentile != null
          ? Math.round(crossSectionalRs.rsPercentile)
          : crossSectionalRs?.rsVsNifty50 != null
            ? Math.max(0, Math.min(100, Math.round(50 + (crossSectionalRs.rsVsNifty50 - 1) * 400)))
            : undefined,
      expectedValueR: expectedValueFilled.expectedValueR,
      overallScore: overall,
      regimeCompatibility:
        regimeCompatibility.compatibility === 'FAVORABLE'
          ? 80
          : regimeCompatibility.compatibility === 'UNFAVORABLE'
            ? 35
            : regimeCompatibility.compatibility === 'NEUTRAL'
              ? 55
              : regimeAssessment.riskCompatibility === 'RISK_ON'
                ? 80
                : regimeAssessment.riskCompatibility === 'RISK_OFF'
                  ? 35
                  : 55,
    },
    conflicts: conflicts.length ? conflicts : undefined,
  };
}
