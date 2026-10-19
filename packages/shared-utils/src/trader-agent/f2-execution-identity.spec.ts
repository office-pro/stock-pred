/**
 * F2 — unauthorized identity cannot reach execution.
 * Trading chain (Decision → Risk → Portfolio → Policy → Gate) is unchanged.
 */
import type { AgentAnalysis } from '@stockpred/shared-types';
import { AppView, UserRole, UserStatus } from '@stockpred/shared-types';
import { runBaselineAuthorizationChain } from './authorization-test-harness';
import {
  ALLOWED_EXECUTION_SERVICES,
  attemptAuthorizedExecution,
  clearExecutionAuthAudit,
  defaultInternalServiceToken,
  evaluateExecutionIdentity,
  evaluateInboundExecuteHeaders,
  mergeExecutionIdentityHeaders,
  parseInboundCaller,
  readExecutionAuthAudit,
} from './execution-identity';

function analysis(symbol = 'TCS'): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG',
      entry: 3500,
      stopLoss: 3400,
      target1: 3700,
      target2: null,
      target3: null,
      riskReward: 2,
      positionSize: 10,
      expectedHoldingPeriod: '1-5d',
      confidence: 80,
      invalidation: 'Close below stop',
    },
    marketRegime: 'RISK_ON',
    thesis: 'Breakout',
    counterThesis: 'Risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

const token = defaultInternalServiceToken();

const authorizedUser = {
  caller: 'api-gateway' as const,
  serviceToken: token,
  userId: 'user-1',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  views: [AppView.PORTFOLIO],
};

describe('F2 execution identity', () => {
  beforeEach(() => clearExecutionAuthAudit());

  it('unauthorized identity → request → execution attempt → REJECTED', () => {
    const result = attemptAuthorizedExecution({
      caller: 'unknown',
      serviceToken: null,
      userId: null,
      role: null,
      analysis: analysis(),
      includeGate: true,
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.chain).toBeUndefined();
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['UNAUTHORIZED_IDENTITY', 'INVALID_SERVICE_IDENTITY']),
    );
    expect(readExecutionAuthAudit()[0]?.outcome).toBe('REJECTED');
  });

  it('invalid service identity is REJECTED before the trading chain', () => {
    const result = attemptAuthorizedExecution({
      ...authorizedUser,
      serviceToken: 'wrong-token',
      analysis: analysis(),
      includeGate: true,
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.chain).toBeUndefined();
    expect(result.reasonCodes).toContain('INVALID_SERVICE_IDENTITY');
  });

  it('UI-only VIEWER permission cannot reach execution', () => {
    const result = attemptAuthorizedExecution({
      ...authorizedUser,
      role: UserRole.VIEWER,
      views: [AppView.DASHBOARD],
      analysis: analysis(),
      includeGate: true,
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.chain).toBeUndefined();
    expect(result.reasonCodes).toContain('UI_ONLY_PERMISSION');
  });

  it('ranking / intelligence / ML / UI / batch cannot authorize execution', () => {
    for (const caller of ['ranking', 'intelligence', 'ml', 'ui', 'batch'] as const) {
      const result = evaluateExecutionIdentity({
        ...authorizedUser,
        caller,
      });
      expect(result.outcome).toBe('REJECTED');
      expect(result.reasonCodes).toContain('EXECUTION_SOURCE_FORBIDDEN');
    }
  });

  it('authorized gateway identity may reach the unchanged trading chain', () => {
    const snapshot = analysis();
    const baseline = runBaselineAuthorizationChain({ analysis: snapshot, includeGate: true });
    const result = attemptAuthorizedExecution({
      ...authorizedUser,
      analysis: snapshot,
      includeGate: true,
    });
    expect(result.outcome).toBe('AUTHORIZED');
    expect(result.chain).toBeDefined();
    expect(result.chain?.projection).toEqual(baseline.projection);
  });

  it('trader-agent is an allowed execution service; DASHBOARD-only USER is not', () => {
    expect(ALLOWED_EXECUTION_SERVICES).toEqual(['api-gateway', 'trader-agent']);
    expect(parseInboundCaller('trader-agent')).toBe('trader-agent');
    const dashboardOnly = evaluateExecutionIdentity({
      ...authorizedUser,
      views: [AppView.DASHBOARD],
    });
    expect(dashboardOnly.outcome).toBe('REJECTED');
    expect(dashboardOnly.reasonCodes).toContain('INSUFFICIENT_VIEW');
  });

  it('stamps s2s headers for outbound execute', () => {
    const headers = mergeExecutionIdentityHeaders('api-gateway', {
      sub: 'user-1',
      role: UserRole.USER,
      brandId: 'brand-1',
    });
    expect(headers['x-stockpred-service']).toBe('api-gateway');
    expect(headers['x-stockpred-service-token']).toBe(token);
    expect(headers['x-user-id']).toBe('user-1');
    expect(headers['x-user-role']).toBe(UserRole.USER);
    expect(headers['x-brand-id']).toBe('brand-1');
  });

  it('rejects an inbound execute request that has no service identity', () => {
    const verdict = evaluateInboundExecuteHeaders({
      'x-user-id': 'user-1',
      'x-user-role': UserRole.USER,
    });
    expect(verdict.outcome).toBe('REJECTED');
    expect(verdict.reasonCodes).toContain('INVALID_SERVICE_IDENTITY');
  });
});
