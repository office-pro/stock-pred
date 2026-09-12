import { randomUUID } from 'crypto';
import type {
  AgentAnalysis,
  DecisionReasonCode,
  TradeDecision,
  TradeEligibility,
  TradeIntent,
} from '@stockpred/shared-types';

export const DECISION_SCORE_REJECT_BELOW = 60;
export const DECISION_SCORE_AUTO_ELIGIBLE_AT = 75;
export const DEFAULT_DECISION_TTL_MS = 15 * 60_000;

function eligibilityFromScore(score: number, buyish: boolean): TradeEligibility {
  if (!buyish) return 'REJECT';
  if (score < DECISION_SCORE_REJECT_BELOW) return 'REJECT';
  if (score < DECISION_SCORE_AUTO_ELIGIBLE_AT) return 'HUMAN_ONLY';
  return 'AUTONOMOUS_ELIGIBLE';
}

function intentFromAnalysis(analysis: AgentAnalysis): TradeIntent {
  if (analysis.decision.includes('BUY')) return 'BUY';
  if (analysis.decision.includes('SELL')) return 'EXIT';
  if (analysis.decision === 'HOLD') return 'HOLD';
  return 'NO_TRADE';
}

/**
 * Opportunity policy only. Score bands set eligibility — never authorize execution alone.
 */
export function evaluateTrade(input: {
  analysis: AgentAnalysis;
  opportunityId?: string;
  decisionId?: string;
  quoteTimestamp?: number;
  ttlMs?: number;
  strategy?: string;
}): TradeDecision {
  const { analysis } = input;
  const intent = intentFromAnalysis(analysis);
  const buyish = intent === 'BUY' || intent === 'ADD';
  const signalScore = analysis.scores.overall;
  const eligibility = eligibilityFromScore(signalScore, buyish);
  const reasonCodes: DecisionReasonCode[] = [];
  const reasons: string[] = [];

  if (!buyish) {
    reasonCodes.push('NON_BUY_DECISION');
    reasons.push(`Decision ${analysis.decision} is not an entry`);
  } else if (eligibility === 'REJECT') {
    reasonCodes.push('SCORE_BELOW_REJECT');
    reasons.push(`Score ${signalScore} below reject threshold ${DECISION_SCORE_REJECT_BELOW}`);
  } else if (eligibility === 'HUMAN_ONLY') {
    reasonCodes.push('SCORE_HUMAN_ONLY');
    reasons.push(
      `Score ${signalScore} requires human approval (auto eligibility at ${DECISION_SCORE_AUTO_ELIGIBLE_AT})`,
    );
  } else {
    reasonCodes.push('AUTONOMOUS_ELIGIBLE', 'BUY_DECISION');
    reasons.push(`Score ${signalScore} is autonomously eligible (gates still apply)`);
  }

  if ((analysis.scores.technical ?? 0) >= 65) {
    reasonCodes.push('TECHNICAL_EDGE');
    reasons.push('Technical pillar supportive');
  }
  if ((analysis.scores.fundamental ?? 0) >= 65) {
    reasonCodes.push('FUNDAMENTAL_EDGE');
    reasons.push('Fundamental pillar supportive');
  }
  if ((analysis.scores.sentiment ?? 0) >= 65) {
    reasonCodes.push('SENTIMENT_EDGE');
    reasons.push('Sentiment pillar supportive');
  }
  if (analysis.marketRegime === 'RISK_ON') {
    reasonCodes.push('REGIME_SUPPORTIVE');
    reasons.push('Market regime RISK_ON');
  } else if (analysis.marketRegime === 'RISK_OFF') {
    reasonCodes.push('REGIME_HOSTILE');
    reasons.push('Market regime RISK_OFF');
  }

  const setup = analysis.setup;
  return {
    decisionId: input.decisionId ?? randomUUID(),
    opportunityId: input.opportunityId,
    symbol: analysis.symbol.toUpperCase(),
    intent,
    eligibility,
    signalScore,
    confidence: setup.confidence ?? signalScore,
    scores: { ...analysis.scores },
    strategy: input.strategy ?? 'COMPOSITE_DESK',
    marketRegime: analysis.marketRegime,
    thesis: analysis.thesis,
    counterThesis: analysis.counterThesis,
    invalidation: analysis.invalidation,
    reasons,
    reasonCodes,
    setup: {
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      target1: setup.target1,
      target2: setup.target2 ?? null,
      target3: setup.target3 ?? null,
      riskReward: setup.riskReward,
      recommendedQty: Math.max(0, Math.floor(setup.positionSize || 0)),
    },
    quoteTimestamp: input.quoteTimestamp,
    createdAt: Date.now(),
    ttlMs: input.ttlMs ?? DEFAULT_DECISION_TTL_MS,
  };
}
