/**
 * Authorization test harness for isolation specs.
 * Centralizes baseline vs enriched auth chain runs — not used by t2-validation-report.ts.
 */
import type {
  AgentDecisionMode,
  AgentMode,
  AuthorizationProjection,
  DecisionPolicyResult,
  PortfolioVerdict,
  RiskVerdict,
  TradeDecision,
} from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import { applyDecisionPolicy } from './decision-policy';
import { evaluatePortfolio } from './portfolio-engine';
import { evaluateRisk } from './risk-engine';
import { evaluateTrade } from './decision-engine';
import { emptyPortfolioSnapshot } from './portfolio';
import { simulateRevalidatingGate, type GateSimResult } from './gate-sim';
import { SimulatedBook } from './simulated-book';
import type { AgentAnalysis } from '@stockpred/shared-types';

export interface AuthorizationChainInput {
  analysis: AgentAnalysis;
  operatingMode?: AgentMode;
  decisionMode?: AgentDecisionMode;
  capital?: number;
  cash?: number;
  tradingEnabled?: boolean;
  killSwitch?: boolean;
  includeGate?: boolean;
  livePrice?: number | null;
  now?: number;
}

export interface AuthorizationChainResult {
  decision: TradeDecision;
  risk: RiskVerdict;
  portfolio: PortfolioVerdict;
  policy: DecisionPolicyResult;
  gate?: GateSimResult;
  projection: AuthorizationProjection;
}

function reasonCodesOf(codes: readonly string[]): string[] {
  return [...codes].sort();
}

export function projectAuthorizationVerdict(
  risk: RiskVerdict,
  portfolio: PortfolioVerdict,
  policy: DecisionPolicyResult,
  gate?: GateSimResult,
): AuthorizationProjection {
  const projection: AuthorizationProjection = {
    risk: {
      allowed: risk.allowed,
      reasonCodes: reasonCodesOf(risk.reasonCodes),
      quantity: risk.allowed ? risk.quantity : undefined,
    },
    portfolio: {
      allowed: portfolio.allowed,
      reasonCodes: reasonCodesOf(portfolio.reasonCodes),
    },
    policy: {
      outcome: policy.outcome,
      reasonCodes: reasonCodesOf(policy.reasonCodes),
    },
  };
  if (gate) {
    projection.gate = {
      allowed: gate.passed,
      reasonCodes: reasonCodesOf(gate.reasonCodes),
    };
  }
  return projection;
}

export function authorizationProjectionsEqual(
  a: AuthorizationProjection,
  b: AuthorizationProjection,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function compareAuthorizationIsolation(
  baseline: AuthorizationProjection,
  enriched: AuthorizationProjection,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!authorizationProjectionsEqual(baseline, enriched)) {
    reasons.push('Authorization projections diverged with T2 intelligence attached');
    if (JSON.stringify(baseline.risk) !== JSON.stringify(enriched.risk)) {
      reasons.push('Risk projection diverged');
    }
    if (JSON.stringify(baseline.portfolio) !== JSON.stringify(enriched.portfolio)) {
      reasons.push('Portfolio projection diverged');
    }
    if (JSON.stringify(baseline.policy) !== JSON.stringify(enriched.policy)) {
      reasons.push('Policy projection diverged');
    }
    if (JSON.stringify(baseline.gate) !== JSON.stringify(enriched.gate)) {
      reasons.push('Gate projection diverged');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function runBaselineAuthorizationChain(
  input: AuthorizationChainInput,
): AuthorizationChainResult {
  const operatingMode = input.operatingMode ?? 'PAPER';
  const decisionMode = input.decisionMode ?? 'APPROVAL';
  const capital = input.capital ?? 1_000_000;
  const cash = input.cash ?? capital;
  const now = input.now ?? input.analysis.generatedAt;

  const decision = evaluateTrade({ analysis: input.analysis });
  const risk = evaluateRisk({
    decision,
    capital,
    cash,
    tradingEnabled: input.tradingEnabled ?? true,
    killSwitch: input.killSwitch ?? false,
  });
  const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, capital);
  const portfolio = evaluatePortfolio({ decision, risk, portfolio: portfolioSnap });
  const policy = applyDecisionPolicy({
    operatingMode,
    decisionMode,
    eligibility: decision.eligibility,
    risk,
    portfolio,
  });

  let gate: GateSimResult | undefined;
  if (input.includeGate) {
    gate = simulateRevalidatingGate({
      decision,
      livePrice: input.livePrice ?? input.analysis.currentPrice,
      maxPriceDeviationPct: 5,
      book: new SimulatedBook(capital),
      now,
      tradingEnabled: input.tradingEnabled ?? true,
      killSwitch: input.killSwitch ?? false,
    });
  }

  return {
    decision,
    risk,
    portfolio,
    policy,
    gate,
    projection: projectAuthorizationVerdict(risk, portfolio, policy, gate),
  };
}
