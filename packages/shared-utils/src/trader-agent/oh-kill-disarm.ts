/**
 * OH-4 Kill / Disarm Verification — audit + mid-flight verifiers.
 * Observe-only: never authorizes, never mutates Risk / Portfolio / Policy / Gate.
 */

import { randomUUID } from 'crypto';
import type {
  DecisionPolicyResult,
  OhSafetyEvent,
  OhSafetyEventCode,
  OhSafetyEventsSnapshot,
  PortfolioVerdict,
  RiskVerdict,
} from '@stockpred/shared-types';

const DEFAULT_CAPACITY = 500;

function emptyCounts(): Record<OhSafetyEventCode, number> {
  return {
    DISARM_REQUESTED: 0,
    DISARM_CONFIRMED: 0,
    KILL_SWITCH_TRIGGERED: 0,
    TRADING_DISABLED: 0,
    AUTONOMOUS_AUTHORIZATION_BLOCKED: 0,
    PENDING_ORDER_BLOCKED: 0,
  };
}

/** True when policy would allow autonomous execution. */
export function wouldAutonomousExecute(policy: DecisionPolicyResult): boolean {
  return policy.outcome === 'AUTO_ACCEPTED';
}

/**
 * Crown Test A: armed LIVE auto → AUTO_ACCEPTED; after disarm → HUMAN_REQUIRED, no execute.
 */
export function verifyLiveDisarmBlocksExecute(input: {
  beforeDisarm: DecisionPolicyResult;
  afterDisarm: DecisionPolicyResult;
}): {
  ok: boolean;
  wouldExecuteBefore: boolean;
  wouldExecuteAfter: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const wouldExecuteBefore = wouldAutonomousExecute(input.beforeDisarm);
  const wouldExecuteAfter = wouldAutonomousExecute(input.afterDisarm);

  if (!wouldExecuteBefore) reasons.push('Expected AUTO_ACCEPTED before disarm');
  if (input.afterDisarm.outcome !== 'HUMAN_REQUIRED') {
    reasons.push(`Expected HUMAN_REQUIRED after disarm, got ${input.afterDisarm.outcome}`);
  }
  if (!input.afterDisarm.reasonCodes.includes('LIVE_AUTONOMOUS_NOT_ARMED')) {
    reasons.push('Expected LIVE_AUTONOMOUS_NOT_ARMED after disarm');
  }
  if (wouldExecuteAfter) reasons.push('After disarm must not execute autonomously');

  return { ok: reasons.length === 0, wouldExecuteBefore, wouldExecuteAfter, reasons };
}

/**
 * Crown Test B: kill-switch risk blocks → policy REJECT → no execute.
 */
export function verifyKillSwitchBlocksExecute(input: {
  risk: RiskVerdict;
  policy: DecisionPolicyResult;
}): {
  ok: boolean;
  wouldExecute: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const wouldExecute = wouldAutonomousExecute(input.policy);

  if (input.risk.allowed) {
    reasons.push('Expected risk.allowed=false under kill switch');
  } else if (!input.risk.blockedBy.includes('KILL_SWITCH')) {
    reasons.push('Expected KILL_SWITCH in risk.blockedBy');
  }
  if (input.policy.outcome !== 'REJECT') {
    reasons.push(`Expected policy REJECT, got ${input.policy.outcome}`);
  }
  if (wouldExecute) reasons.push('Kill switch must not allow autonomous execute');

  return { ok: reasons.length === 0, wouldExecute, reasons };
}

/**
 * Crown Test C: OH-4 collector presence must not change engine outputs.
 */
export function verifyOh4Isolation(input: {
  riskA: RiskVerdict;
  riskB: RiskVerdict;
  portfolioA: PortfolioVerdict;
  portfolioB: PortfolioVerdict;
  policyA: DecisionPolicyResult;
  policyB: DecisionPolicyResult;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (JSON.stringify(input.riskA) !== JSON.stringify(input.riskB)) {
    reasons.push('Risk outputs diverged with OH-4 ON vs OFF');
  }
  if (JSON.stringify(input.portfolioA) !== JSON.stringify(input.portfolioB)) {
    reasons.push('Portfolio outputs diverged with OH-4 ON vs OFF');
  }
  if (JSON.stringify(input.policyA) !== JSON.stringify(input.policyB)) {
    reasons.push('Policy outputs diverged with OH-4 ON vs OFF');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * In-memory OH-4 safety event collector. Never throws into the trading path.
 */
export class OhSafetyEventCollector {
  private readonly capacity: number;
  private readonly events: OhSafetyEvent[] = [];

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(50, capacity);
  }

  record(
    partial: Omit<OhSafetyEvent, 'eventId' | 'recordedAt'> & {
      eventId?: string;
      recordedAt?: number;
    },
  ): void {
    try {
      if (!partial.code) return;
      const event: OhSafetyEvent = {
        eventId: partial.eventId ?? randomUUID(),
        recordedAt: partial.recordedAt ?? Date.now(),
        code: partial.code,
        decisionId: partial.decisionId,
        symbol: partial.symbol,
        message: partial.message,
        details: partial.details,
      };
      this.events.push(event);
      while (this.events.length > this.capacity) this.events.shift();
    } catch {
      /* observe-only — never break trading */
    }
  }

  snapshot(recentLimit = 50): OhSafetyEventsSnapshot {
    const counts = emptyCounts();
    for (const e of this.events) {
      counts[e.code] = (counts[e.code] ?? 0) + 1;
    }
    const n = Math.max(1, Math.min(200, recentLimit));
    return {
      schemaVersion: 'oh-safety-events.v1',
      generatedAt: Date.now(),
      observeOnly: true,
      eventCount: this.events.length,
      recent: this.events.slice(-n).reverse(),
      counts,
    };
  }

  clear(): void {
    try {
      this.events.length = 0;
    } catch {
      /* observe-only */
    }
  }
}
