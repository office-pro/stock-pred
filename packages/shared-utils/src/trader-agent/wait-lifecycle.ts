import type {
  AgentRecommendationAction,
  HumanDecisionAction,
  HumanWaitReasonCode,
  OpportunityWaitState,
} from '@stockpred/shared-types';

export const DEFAULT_WAIT_TTL_MS = 30 * 60_000;

export interface ApplyWaitInput {
  now: number;
  ttlMs?: number;
  reason?: HumanWaitReasonCode | string;
  previous?: OpportunityWaitState | null;
}

/**
 * PENDING → WAITING (or WAITING → WAITING with incremented waitCount).
 * WAIT never submits to Gate — callers must not invoke approve/gate after this.
 */
export function applyWait(input: ApplyWaitInput): OpportunityWaitState {
  const ttlMs = input.ttlMs ?? DEFAULT_WAIT_TTL_MS;
  const prevCount = input.previous?.waitCount ?? 0;
  return {
    waitExpiresAt: input.now + ttlMs,
    waitReason: input.reason,
    waitCount: prevCount + 1,
    lastEvaluatedAt: input.now,
  };
}

export function isWaitExpired(wait: OpportunityWaitState, now: number): boolean {
  return now >= wait.waitExpiresAt;
}

/**
 * Derive immutable agent recommendation from analysis decision + optional conflicts.
 * Display/evidence only — does not authorize execution.
 */
export function deriveAgentRecommendation(input: {
  decision: string;
  hasBlockConflict?: boolean;
}): AgentRecommendationAction {
  if (input.hasBlockConflict) return 'RECOMMEND_WAIT';
  const d = input.decision.toUpperCase();
  if (d.includes('BUY') || d === 'STRONG_BUY') return 'RECOMMEND_APPROVE';
  if (d === 'WAIT' || d === 'HOLD') return 'RECOMMEND_WAIT';
  return 'RECOMMEND_REJECT';
}

export function agentHumanAgree(
  agent: AgentRecommendationAction | undefined,
  human: HumanDecisionAction | undefined,
): boolean | null {
  if (!agent || !human) return null;
  if (agent === 'RECOMMEND_APPROVE' && human === 'HUMAN_APPROVE') return true;
  if (agent === 'RECOMMEND_WAIT' && human === 'HUMAN_WAIT') return true;
  if (agent === 'RECOMMEND_REJECT' && human === 'HUMAN_REJECT') return true;
  return false;
}
