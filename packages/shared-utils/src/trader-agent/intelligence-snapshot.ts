/**
 * Observe-only Trade Intelligence builder (Phase 4 / 6).
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
  type IntelligenceSnapshot,
  type StrategyTag,
  type TradeDecision,
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

/**
 * Build a best-effort IntelligenceSnapshot from existing analysis.
 * Missing fields are omitted — P4 observation does not require completeness.
 */
export function buildIntelligenceSnapshot(input: {
  analysis: AgentAnalysis;
  decision: TradeDecision;
  sourceDataTimestamp?: string | number;
  now?: number;
}): IntelligenceSnapshot {
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

  const probabilityTarget =
    overall != null ? Math.min(0.85, Math.max(0.35, overall / 100)) : undefined;
  const probabilityStop =
    probabilityTarget != null
      ? Math.min(0.55, Math.max(0.15, 1 - probabilityTarget - 0.1))
      : undefined;
  const expectedValueR =
    probabilityTarget != null && rewardR != null && probabilityStop != null
      ? probabilityTarget * rewardR - probabilityStop * 1
      : undefined;

  const conflicts: NonNullable<IntelligenceSnapshot['conflicts']> = [];
  if (analysis.marketRegime === 'RISK_OFF') {
    conflicts.push({
      code: 'REGIME_HOSTILE',
      severity: 'WARN',
      message: 'Strong setup signals vs RISK_OFF regime',
      factors: ['tradeQuality', 'marketContext'],
    });
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
    strategyTag: inferStrategyTag(analysis, decision),
    marketContext: {
      regime: analysis.marketRegime,
      volatilityRegime: analysis.marketRegime === 'RISK_OFF' ? 'HIGH' : undefined,
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
      thesisConfidence: decision.confidence,
    },
    expectedValue:
      expectedValueR != null
        ? {
            probabilityTarget,
            probabilityStop,
            rewardR,
            riskR: 1,
            expectedValueR,
          }
        : undefined,
    tradeQuality: {
      technical,
      fundamental,
      momentum,
      sentiment,
      expectedValueR,
      overallScore: overall,
      regimeCompatibility:
        analysis.marketRegime === 'RISK_ON' ? 80 : analysis.marketRegime === 'RISK_OFF' ? 35 : 55,
    },
    conflicts: conflicts.length ? conflicts : undefined,
  };
}
