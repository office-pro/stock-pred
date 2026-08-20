import type { AgentPositionPolicy } from '@stockpred/shared-types';
import { TradeExitReason } from '@stockpred/shared-types';
import { round2 } from '../math';

export interface ExitPolicyPosition {
  symbol: string;
  entryPrice: number;
  quantity: number;
  target: number;
  target2?: number;
  stopLoss: number;
}

export interface ExitPolicyContext {
  price: number;
  /** Overall agent score 0–100 when known. */
  thesisScore?: number | null;
  /** True when technical+ML+sentiment still support the long. */
  thesisIntact?: boolean;
  atr?: number | null;
  reversalSignal?: boolean;
  bearishMl?: boolean;
  investigateBand?: boolean;
  riskOff?: boolean;
}

export type ExitPolicyAction =
  | { type: 'NONE'; policy: AgentPositionPolicy; note: string; stopLoss: number; target: number }
  | {
      type: 'UPDATE_LEVELS';
      policy: AgentPositionPolicy;
      note: string;
      stopLoss: number;
      target: number;
      target2?: number;
    }
  | {
      type: 'PARTIAL_EXIT';
      policy: AgentPositionPolicy;
      note: string;
      quantity: number;
      reason: TradeExitReason;
      stopLoss: number;
      target: number;
    }
  | {
      type: 'FULL_EXIT';
      policy: AgentPositionPolicy;
      note: string;
      reason: TradeExitReason;
      stopLoss: number;
      target: number;
    };

/**
 * Intelligent exit: hard stop always; near target may trail/wait if thesis holds.
 */
export function evaluateExitPolicy(
  position: ExitPolicyPosition,
  ctx: ExitPolicyContext,
): ExitPolicyAction {
  const price = ctx.price;
  const stop = position.stopLoss;
  const target = position.target;
  const target2 =
    position.target2 ?? round2(position.entryPrice + (target - position.entryPrice) * 1.6);

  if (price <= stop) {
    return {
      type: 'FULL_EXIT',
      policy: 'HARD_STOP',
      note: 'Hard stop hit — capital preservation.',
      reason: TradeExitReason.STOP_LOSS_HIT,
      stopLoss: stop,
      target,
    };
  }

  if (ctx.investigateBand || ctx.reversalSignal || ctx.bearishMl || ctx.riskOff) {
    return {
      type: 'FULL_EXIT',
      policy: 'EXIT_PENDING',
      note: ctx.investigateBand
        ? 'Thesis invalid — unusual activity investigate band.'
        : ctx.reversalSignal
          ? 'Thesis invalid — reversal signal.'
          : ctx.bearishMl
            ? 'Thesis invalid — bearish ML.'
            : 'Thesis invalid — macro risk-off.',
      reason: TradeExitReason.THESIS_INVALID,
      stopLoss: stop,
      target,
    };
  }

  const thesisOk = ctx.thesisIntact !== false && (ctx.thesisScore == null || ctx.thesisScore >= 58);
  const nearTarget = price >= target * 0.98;
  const pastTarget = price >= target;

  if (pastTarget && thesisOk) {
    const atr = ctx.atr && ctx.atr > 0 ? ctx.atr : Math.max(price * 0.008, 0.05);
    const trailedStop = Math.max(stop, round2(price - atr * 1.5));
    const raisedTarget = Math.max(target, target2);
    if (price >= raisedTarget && !thesisOk) {
      return {
        type: 'FULL_EXIT',
        policy: 'EXIT_PENDING',
        note: 'T2 reached without thesis support.',
        reason: TradeExitReason.TARGET_HIT,
        stopLoss: trailedStop,
        target: raisedTarget,
      };
    }
    if (price >= target && price < raisedTarget) {
      const half = Math.max(1, Math.floor(position.quantity / 2));
      if (position.quantity >= 2 && price < target * 1.01) {
        return {
          type: 'PARTIAL_EXIT',
          policy: 'PARTIAL_T1',
          note: 'Take partial at T1; trail remainder toward T2.',
          quantity: half,
          reason: TradeExitReason.PARTIAL_TARGET,
          stopLoss: Math.max(trailedStop, round2(position.entryPrice)),
          target: raisedTarget,
        };
      }
    }
    return {
      type: 'UPDATE_LEVELS',
      policy: 'TRAIL',
      note: 'Target zone — thesis intact; trailing stop and extending target.',
      stopLoss: trailedStop,
      target: raisedTarget,
      target2: raisedTarget,
    };
  }

  if (pastTarget && !thesisOk) {
    return {
      type: 'FULL_EXIT',
      policy: 'EXIT_PENDING',
      note: 'Target reached and thesis no longer intact.',
      reason: TradeExitReason.TARGET_HIT,
      stopLoss: stop,
      target,
    };
  }

  if (nearTarget && thesisOk) {
    const atr = ctx.atr && ctx.atr > 0 ? ctx.atr : price * 0.008;
    return {
      type: 'UPDATE_LEVELS',
      policy: 'TRAIL',
      note: 'Approaching target; holding with tighter trail while thesis holds.',
      stopLoss: Math.max(stop, round2(price - atr * 2)),
      target,
    };
  }

  return {
    type: 'NONE',
    policy: 'HOLD',
    note: 'Monitoring vs stop and targets.',
    stopLoss: stop,
    target,
  };
}
