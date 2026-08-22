import type {
  AgentDecisionMode,
  AgentMode,
  DecisionPolicyResult,
  DecisionReasonCode,
  PortfolioVerdict,
  RiskVerdict,
  TradeEligibility,
} from '@stockpred/shared-types';

export interface DecisionPolicyInput {
  operatingMode: AgentMode;
  decisionMode: AgentDecisionMode;
  eligibility: TradeEligibility;
  risk: RiskVerdict;
  portfolio: PortfolioVerdict;
  /**
   * Effective LIVE autonomous latch (operator armed AND evidence unlock).
   * Callers must compute effectiveness upstream; policy does not read the evidence file.
   */
  liveAutoArmed?: boolean;
}

/**
 * Pure policy: eligibility + verdicts + modes → REJECT | HUMAN_REQUIRED | AUTO_ACCEPTED.
 * Phase 6: LIVE + AUTONOMOUS may AUTO_ACCEPTED only when liveAutoArmed is effectively true.
 * While P5 evidence is NO-GO, callers must pass liveAutoArmed=false so LIVE stays HUMAN_REQUIRED.
 */
export function applyDecisionPolicy(input: DecisionPolicyInput): DecisionPolicyResult {
  if (!input.risk.allowed) {
    return {
      outcome: 'REJECT',
      reasonCodes: input.risk.blockedBy,
      reasons: input.risk.reasons,
    };
  }
  if (!input.portfolio.allowed) {
    return {
      outcome: 'REJECT',
      reasonCodes: input.portfolio.blockedBy,
      reasons: input.portfolio.reasons,
    };
  }

  const codes: DecisionReasonCode[] = [];
  const reasons: string[] = [];

  if (input.eligibility === 'REJECT') {
    codes.push('SCORE_BELOW_REJECT');
    reasons.push('Signal eligibility is REJECT');
    return { outcome: 'REJECT', reasonCodes: codes, reasons };
  }

  if (input.operatingMode === 'RESEARCH') {
    codes.push('RESEARCH_NO_EXECUTE');
    reasons.push('RESEARCH mode cannot execute — human review only');
    return { outcome: 'HUMAN_REQUIRED', reasonCodes: codes, reasons };
  }

  if (input.eligibility === 'HUMAN_ONLY') {
    codes.push('SCORE_HUMAN_ONLY');
    reasons.push('Score band requires human approval');
    return { outcome: 'HUMAN_REQUIRED', reasonCodes: codes, reasons };
  }

  if (input.decisionMode === 'APPROVAL') {
    codes.push('POLICY_APPROVAL_MODE');
    reasons.push('Decision mode is APPROVAL — human must approve');
    return { outcome: 'HUMAN_REQUIRED', reasonCodes: codes, reasons };
  }

  if (input.operatingMode === 'LIVE') {
    if (input.liveAutoArmed === true) {
      codes.push('POLICY_AUTO_ACCEPTED', 'AUTONOMOUS_ELIGIBLE', 'LIVE_AUTONOMOUS_ARMED');
      reasons.push(
        'LIVE autonomous armed with evidence unlock: eligibility + risk + portfolio passed',
      );
      return { outcome: 'AUTO_ACCEPTED', reasonCodes: codes, reasons };
    }
    codes.push('LIVE_AUTONOMOUS_NOT_ARMED');
    reasons.push('LIVE autonomous not effectively armed — human approval required');
    return { outcome: 'HUMAN_REQUIRED', reasonCodes: codes, reasons };
  }

  codes.push('POLICY_AUTO_ACCEPTED', 'AUTONOMOUS_ELIGIBLE');
  reasons.push('PAPER autonomous: eligibility + risk + portfolio passed');
  return { outcome: 'AUTO_ACCEPTED', reasonCodes: codes, reasons };
}
