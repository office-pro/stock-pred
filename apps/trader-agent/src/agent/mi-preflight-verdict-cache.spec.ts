/**
 * Review→create preflight verdict reuse (90s fingerprint TTL).
 */

jest.mock('@stockpred/database', () => ({
  getPrismaClient: jest.fn(),
  resolveNseAllMembership: jest.fn(),
}));

import { ANALYSIS_SESSION_VERSION, type CombinedBatchPreflightV2 } from '@stockpred/shared-types';
import type { AgentService } from './agent.service';
import { MiCombinedPreflightService } from './mi-combined-preflight.service';

function gatePassingOffSession(): CombinedBatchPreflightV2 {
  return {
    canRun: false,
    canAnalyze: true,
    universe: { requested: 1, resolved: 1, unresolved: 0, mismatched: 0 },
    marketData: {
      mode: 'REQUIRED',
      available: 1,
      requiredCount: 1,
      coverage: 'COMPLETE',
      freshness: 'STALE',
    },
    historical: {
      mode: 'REQUIRED',
      available: 1,
      requiredCount: 1,
      coverage: 'COMPLETE',
      freshness: 'CURRENT',
    },
    intelligence: {
      fundamentals: {
        mode: 'REQUIRED',
        available: 1,
        requiredCount: 1,
        coverage: 'COMPLETE',
        freshness: 'CURRENT',
      },
      news: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      sentiment: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      corporateEvents: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      macro: {
        mode: 'OPTIONAL',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
      social: {
        mode: 'NOT_APPLICABLE',
        available: 0,
        requiredCount: 0,
        coverage: 'COMPLETE',
        freshness: 'UNKNOWN',
      },
    },
    blockers: [],
    warnings: ['STALE_REQUIRED_DATA'],
    generatedAt: new Date().toISOString(),
    asOf: new Date().toISOString(),
    analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
    analysisActionability: 'NON_ACTIONABLE',
  };
}

describe('MiCombinedPreflightService verdict cache', () => {
  it('allowCache returns gate-passing verdict without MDS when fingerprint matches', async () => {
    const fetchQuoteInventory = jest.fn();
    const fetchNseDailyCandlesForBatch = jest.fn();
    const agent = { fetchQuoteInventory, fetchNseDailyCandlesForBatch };
    const svc = new MiCombinedPreflightService(agent as unknown as AgentService);
    const verdict = gatePassingOffSession();
    const key = 'fp-test-key';
    (
      svc as unknown as {
        verdictCache: Map<string, { at: number; verdict: CombinedBatchPreflightV2 }>;
      }
    ).verdictCache.set(key, { at: Date.now(), verdict });
    jest.spyOn(svc, 'fingerprintPreflight').mockReturnValue(key);

    const out = await svc.run(
      {
        universeType: 'CUSTOM',
        lockedMembershipSymbols: ['RELIANCE'],
        customSymbols: ['RELIANCE'],
        analysisPeriod: { value: 1, unit: 'Y' },
        resolution: '1D',
        predictionHorizon: { value: 1, unit: 'Y' },
        mode: 'STANDARD',
        analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      },
      { allowCache: true },
    );

    expect(out).toBe(verdict);
    expect(fetchQuoteInventory).not.toHaveBeenCalled();
    expect(fetchNseDailyCandlesForBatch).not.toHaveBeenCalled();
  });

  it('allowCache ignores blocked cached verdict and falls through to MDS', async () => {
    const fetchQuoteInventory = jest.fn().mockResolvedValue({
      quotes: new Map([['RELIANCE', { symbol: 'RELIANCE', price: 100, updatedAt: Date.now() }]]),
    });
    const fetchNseDailyCandlesForBatch = jest
      .fn()
      .mockResolvedValue(Array.from({ length: 260 }, (_, i) => ({ time: i, close: 1 })));
    const agent = { fetchQuoteInventory, fetchNseDailyCandlesForBatch };
    const svc = new MiCombinedPreflightService(agent as unknown as AgentService);
    const blocked = {
      ...gatePassingOffSession(),
      canAnalyze: false,
      blockers: ['MARKET_DATA_INSUFFICIENT' as const],
    };
    const key = 'fp-blocked';
    (
      svc as unknown as {
        verdictCache: Map<string, { at: number; verdict: CombinedBatchPreflightV2 }>;
      }
    ).verdictCache.set(key, { at: Date.now(), verdict: blocked });
    jest.spyOn(svc, 'fingerprintPreflight').mockReturnValue(key);

    await svc.run(
      {
        universeType: 'CUSTOM',
        lockedMembershipSymbols: ['RELIANCE'],
        customSymbols: ['RELIANCE'],
        analysisPeriod: { value: 1, unit: 'Y' },
        resolution: '1D',
        predictionHorizon: { value: 1, unit: 'Y' },
        mode: 'STANDARD',
        analysisSession: { id: 'OFF_SESSION_ANALYSIS', version: ANALYSIS_SESSION_VERSION },
      },
      { allowCache: true },
    );

    expect(fetchQuoteInventory).toHaveBeenCalled();
  });
});
