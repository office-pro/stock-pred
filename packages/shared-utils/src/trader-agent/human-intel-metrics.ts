import type {
  AgentRecommendationAction,
  DecisionLedgerEntry,
  HumanDecisionAction,
  HumanIntelMetrics,
} from '@stockpred/shared-types';
import { agentHumanAgree } from './wait-lifecycle';

/**
 * Multi-signal P5 metrics from ledger evidence.
 * Agreement / override / WAIT→later — not LIVE P&L alone.
 */
export function computeHumanIntelMetrics(entries: DecisionLedgerEntry[]): HumanIntelMetrics {
  let reviewed = 0;
  let agentApproveCount = 0;
  let agentWaitCount = 0;
  let agentRejectCount = 0;
  let humanApproveCount = 0;
  let humanWaitCount = 0;
  let humanRejectCount = 0;
  let agreementCount = 0;
  let overrideCount = 0;
  let waitThenLaterCount = 0;

  const byDecision = new Map<string, DecisionLedgerEntry[]>();
  for (const e of entries) {
    const list = byDecision.get(e.decisionId) ?? [];
    list.push(e);
    byDecision.set(e.decisionId, list);
  }

  for (const e of entries) {
    if (!e.humanDecision && !e.agentRecommendation) continue;
    reviewed += 1;
    bumpAgent(e.agentRecommendation);
    bumpHuman(e.humanDecision);
    const agree = agentHumanAgree(e.agentRecommendation, e.humanDecision);
    if (agree === true) agreementCount += 1;
    if (agree === false) overrideCount += 1;
  }

  for (const [, rows] of byDecision) {
    const hadWait = rows.some((r) => r.humanDecision === 'HUMAN_WAIT' || r.decision === 'WAIT');
    const laterAction = rows.some(
      (r) =>
        r.humanDecision === 'HUMAN_APPROVE' ||
        r.humanDecision === 'HUMAN_REJECT' ||
        r.decision === 'APPROVED' ||
        r.decision === 'EXECUTED' ||
        r.decision === 'REJECT',
    );
    if (hadWait && laterAction) waitThenLaterCount += 1;
  }

  const withOutcome = entries.filter(
    (e) =>
      e.outcome?.realizedR != null && e.intelligenceSnapshot?.tradeQuality?.overallScore != null,
  );
  const pos = withOutcome.filter((e) => (e.outcome?.realizedR ?? 0) > 0);
  const neg = withOutcome.filter((e) => (e.outcome?.realizedR ?? 0) <= 0);

  const avg = (rows: DecisionLedgerEntry[]): number | null => {
    if (rows.length === 0) return null;
    const sum = rows.reduce(
      (a, r) => a + (r.intelligenceSnapshot?.tradeQuality?.overallScore ?? 0),
      0,
    );
    return sum / rows.length;
  };

  const reviewedSafe = Math.max(reviewed, 1);

  return {
    reviewed,
    agentApproveCount,
    agentWaitCount,
    agentRejectCount,
    humanApproveCount,
    humanWaitCount,
    humanRejectCount,
    agreementCount,
    overrideCount,
    agreementPct: reviewed === 0 ? 0 : (agreementCount / reviewedSafe) * 100,
    overridePct: reviewed === 0 ? 0 : (overrideCount / reviewedSafe) * 100,
    waitThenLaterCount,
    qualityVsRealizedRSamples: withOutcome.length,
    avgQualityWhenPositiveR: avg(pos),
    avgQualityWhenNegativeR: avg(neg),
  };

  function bumpAgent(a?: AgentRecommendationAction): void {
    if (a === 'RECOMMEND_APPROVE') agentApproveCount += 1;
    else if (a === 'RECOMMEND_WAIT') agentWaitCount += 1;
    else if (a === 'RECOMMEND_REJECT') agentRejectCount += 1;
  }

  function bumpHuman(h?: HumanDecisionAction): void {
    if (h === 'HUMAN_APPROVE') humanApproveCount += 1;
    else if (h === 'HUMAN_WAIT') humanWaitCount += 1;
    else if (h === 'HUMAN_REJECT') humanRejectCount += 1;
  }
}
