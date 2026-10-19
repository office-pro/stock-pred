/**
 * MI-6 unit tests — preflight fingerprint, LOADING, N/A, Generate waiting, no FE math.
 */
import type { CombinedBatchPreflightV2 } from '@stockpred/shared-types';
import {
  batchRunProgressStages,
  buildMultiAssetBatchRequest,
  computeBackendCanRun,
  computeCanSubmit,
  ELIGIBLE_SUBSET_POLICY,
  formatCoveragePct,
  formatCreateBatchError,
  formatPreflightRequestError,
  humanizePreflightBlocker,
  isInventoryOutageBlocker,
  isMiPreflightUniverse,
  mapWorkstationToPreflightConfig,
  preflightLegsFromV2,
  readinessPolicyFromChoice,
  sortedIneligibleReasons,
  stableSerializePreflightConfig,
  unwrapPreflightBlockedBody,
  validResultRows,
  wizardStageStates,
} from './multi-asset-batch';

function sampleV2(overrides: Partial<CombinedBatchPreflightV2> = {}): CombinedBatchPreflightV2 {
  const leg = {
    mode: 'REQUIRED' as const,
    available: 50,
    requiredCount: 50,
    coverage: 'COMPLETE' as const,
    freshness: 'CURRENT' as const,
  };
  return {
    canRun: true,
    canAnalyze: true,
    universe: { requested: 50, resolved: 50, unresolved: 0, mismatched: 0 },
    marketData: leg,
    historical: leg,
    intelligence: {
      fundamentals: leg,
      news: leg,
      sentiment: leg,
      corporateEvents: { ...leg, mode: 'OPTIONAL' },
      macro: leg,
      social: {
        ...leg,
        mode: 'NOT_APPLICABLE',
        available: 0,
        requiredCount: 0,
        coverage: 'MISSING',
      },
    },
    blockers: [],
    warnings: [],
    generatedAt: '2026-09-26T00:00:00.000Z',
    asOf: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('MI-6 preflight fingerprint + canSubmit', () => {
  it('isMiPreflightUniverse is presentation-only for supported catalogs', () => {
    expect(isMiPreflightUniverse('NIFTY50')).toBe(true);
    expect(isMiPreflightUniverse('NIFTY500')).toBe(true);
    expect(isMiPreflightUniverse('NSE_ALL')).toBe(true);
    expect(isMiPreflightUniverse('NIFTY150')).toBe(false);
    expect(isMiPreflightUniverse('US_ALL')).toBe(false);
  });

  it('stale preflight key cannot enable Run', () => {
    const cfgA = mapWorkstationToPreflightConfig({
      universeId: 'NIFTY50',
      analysisPeriod: '3M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
      miMode: 'STANDARD',
    });
    const cfgB = mapWorkstationToPreflightConfig({
      universeId: 'NIFTY500',
      analysisPeriod: '3M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
      miMode: 'STANDARD',
    });
    const keyA = stableSerializePreflightConfig(cfgA);
    const keyB = stableSerializePreflightConfig(cfgB);
    expect(keyA).not.toBe(keyB);
    expect(
      computeBackendCanRun({
        isMiUniverse: true,
        currentKey: keyB,
        storedKey: keyA,
        result: sampleV2({ canRun: true }),
        presentation: 'READY',
      }),
    ).toBe(false);
    expect(
      computeBackendCanRun({
        isMiUniverse: true,
        currentKey: keyA,
        storedKey: keyA,
        result: sampleV2({ canRun: true }),
        presentation: 'READY',
      }),
    ).toBe(true);
  });

  it('LOADING and ERROR disable backendCanRun', () => {
    const key = 'k1';
    expect(
      computeBackendCanRun({
        isMiUniverse: true,
        currentKey: key,
        storedKey: key,
        result: sampleV2({ canRun: true }),
        presentation: 'LOADING',
      }),
    ).toBe(false);
    expect(
      computeBackendCanRun({
        isMiUniverse: true,
        currentKey: key,
        storedKey: key,
        result: sampleV2({ canRun: true }),
        presentation: 'ERROR',
      }),
    ).toBe(false);
  });

  it('canSubmit requires formValid and matching backend PASS for MI universes', () => {
    expect(computeCanSubmit({ formValid: true, isMiUniverse: false, backendCanRun: false })).toBe(
      true,
    );
    expect(computeCanSubmit({ formValid: true, isMiUniverse: true, backendCanRun: false })).toBe(
      false,
    );
    expect(computeCanSubmit({ formValid: false, isMiUniverse: true, backendCanRun: true })).toBe(
      false,
    );
    expect(computeCanSubmit({ formValid: true, isMiUniverse: true, backendCanRun: true })).toBe(
      true,
    );
  });
});

describe('MI-6 PREFLIGHT_BLOCKED + legs display', () => {
  it('unwraps PreflightBlockedErrorBody and feeds same V2 model', () => {
    const v2 = sampleV2({ canRun: false, blockers: ['FUNDAMENTALS_INSUFFICIENT'] });
    const body = unwrapPreflightBlockedBody({
      data: {
        code: 'PREFLIGHT_BLOCKED',
        message: 'Batch preflight failed',
        blockers: v2.blockers,
        combinedPreflight: v2,
      },
    });
    expect(body?.code).toBe('PREFLIGHT_BLOCKED');
    expect(body?.combinedPreflight.canRun).toBe(false);
    const legs = preflightLegsFromV2(body!.combinedPreflight);
    expect(legs.find((l) => l.key === 'social')?.mode).toBe('NOT_APPLICABLE');
    expect(legs.find((l) => l.key === 'fundamentals')?.available).toBe(50);
  });

  it('formatCreateBatchError lists blockers without inventing counts', () => {
    const msg = formatCreateBatchError({
      data: {
        code: 'PREFLIGHT_BLOCKED',
        blockers: ['MARKET_DATA_INSUFFICIENT'],
        combinedPreflight: sampleV2({
          canRun: false,
          blockers: ['MARKET_DATA_INSUFFICIENT'],
          marketData: {
            mode: 'REQUIRED',
            available: 10,
            requiredCount: 50,
            coverage: 'PARTIAL',
            freshness: 'CURRENT',
          },
        }),
      },
    });
    expect(msg).toContain('Cannot start batch');
    expect(msg).toContain('10 / 50');
    expect(msg).toContain('MARKET_DATA_INSUFFICIENT');
  });

  it('formatCreateBatchError surfaces outcome and eligibility counts from backend', () => {
    const msg = formatCreateBatchError({
      data: {
        code: 'PREFLIGHT_BLOCKED',
        outcome: 'NO_ELIGIBLE_INSTRUMENTS',
        blockers: ['NO_ELIGIBLE_INSTRUMENTS'],
        combinedPreflight: sampleV2({
          canRun: false,
          blockers: ['NO_ELIGIBLE_INSTRUMENTS'],
          eligibility: {
            policy: ELIGIBLE_SUBSET_POLICY,
            universeTotal: 500,
            eligible: 0,
            analyzedNotPromotable: 0,
            ineligible: 500,
            ineligibleByReason: { QUOTE_STALE: 500 },
            instruments: [],
          },
        }),
      },
    });
    expect(msg).toContain('Outcome: NO_ELIGIBLE_INSTRUMENTS');
    expect(msg).toContain('Eligible 0 / 500');
    expect(msg).toContain('NO_ELIGIBLE_INSTRUMENTS');
  });
});

describe('ES-16 readiness policy request wiring', () => {
  it('DEFAULT omits readinessPolicy; ELIGIBLE_SUBSET sends fixed minimums', () => {
    expect(readinessPolicyFromChoice('DEFAULT')).toBeUndefined();
    expect(readinessPolicyFromChoice(undefined)).toBeUndefined();
    expect(readinessPolicyFromChoice('ELIGIBLE_SUBSET')).toEqual(ELIGIBLE_SUBSET_POLICY);

    const none = mapWorkstationToPreflightConfig({
      universeId: 'NIFTY50',
      analysisPeriod: '3M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
      miMode: 'STANDARD',
      readinessPolicyChoice: 'DEFAULT',
    });
    expect(none).not.toHaveProperty('readinessPolicy');

    const subset = mapWorkstationToPreflightConfig({
      universeId: 'NIFTY500',
      analysisPeriod: '3M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
      miMode: 'STANDARD',
      readinessPolicyChoice: 'ELIGIBLE_SUBSET',
    });
    expect(subset?.readinessPolicy).toEqual(ELIGIBLE_SUBSET_POLICY);

    const keyDefault = stableSerializePreflightConfig(none);
    const keySubset = stableSerializePreflightConfig(subset);
    expect(keyDefault).not.toBe(keySubset);

    const createBody = buildMultiAssetBatchRequest({
      universe: {
        universeId: 'NIFTY50',
        name: 'Nifty 50',
        kind: 'PREDEFINED',
      } as never,
      analysisPeriod: '3M',
      predictionHorizon: '1M',
      mode: 'HISTORICAL',
      instruments: [],
      readinessPolicyChoice: 'ELIGIBLE_SUBSET',
    });
    expect(createBody.readinessPolicy).toEqual(ELIGIBLE_SUBSET_POLICY);
    const createDefault = buildMultiAssetBatchRequest({
      universe: {
        universeId: 'NIFTY50',
        name: 'Nifty 50',
        kind: 'PREDEFINED',
      } as never,
      analysisPeriod: '3M',
      predictionHorizon: '1M',
      mode: 'HISTORICAL',
      instruments: [],
      readinessPolicyChoice: 'DEFAULT',
    });
    expect(createDefault).not.toHaveProperty('readinessPolicy');
  });

  it('inventory outage helpers do not invent NO_ELIGIBLE conclusions', () => {
    expect(isInventoryOutageBlocker('HISTORICAL_INVENTORY_UNAVAILABLE')).toBe(true);
    expect(isInventoryOutageBlocker('NO_ELIGIBLE_INSTRUMENTS')).toBe(false);
    expect(humanizePreflightBlocker('HISTORICAL_INVENTORY_UNAVAILABLE')).toBe(
      'Historical inventory unavailable',
    );
    expect(sortedIneligibleReasons({ QUOTE_STALE: 2, NO_HISTORY: 5 })).toEqual([
      { reason: 'NO_HISTORY', count: 5 },
      { reason: 'QUOTE_STALE', count: 2 },
    ]);
  });
});

describe('formatPreflightRequestError', () => {
  it('reports network failures (gateway unreachable / restarted)', () => {
    expect(
      formatPreflightRequestError({ status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' }),
    ).toBe('Network error — could not reach the API gateway (TypeError: Failed to fetch)');
  });

  it('reports HTTP status with upstream message', () => {
    expect(
      formatPreflightRequestError({
        status: 502,
        data: { message: 'Upstream service "traderAgent" is unavailable', statusCode: 502 },
      }),
    ).toBe('HTTP 502 — Upstream service "traderAgent" is unavailable');
  });

  it('joins validation message arrays', () => {
    expect(
      formatPreflightRequestError({
        status: 400,
        data: { message: ['a is required', 'b invalid'] },
      }),
    ).toBe('HTTP 400 — a is required; b invalid');
  });

  it('uses originalStatus for non-JSON error bodies', () => {
    expect(
      formatPreflightRequestError({
        status: 'PARSING_ERROR',
        originalStatus: 504,
        data: 'Gateway Timeout',
        error: 'SyntaxError: Unexpected token',
      }),
    ).toBe('HTTP 504 — Gateway Timeout');
  });

  it('reports timeouts and falls back for unknown shapes', () => {
    expect(formatPreflightRequestError({ status: 'TIMEOUT_ERROR', error: 'AbortError' })).toBe(
      'Preflight request timed out (AbortError)',
    );
    expect(formatPreflightRequestError(undefined)).toBe('Preflight request failed');
  });
});

describe('MI-6 Generate WAITING + coverage formatting', () => {
  it('DATA_VALIDATED + PENDING coverage keeps Generate pending (not active)', () => {
    const stages = wizardStageStates('DATA_VALIDATED', 'RUNNING', [
      {
        capability: 'fundamentals',
        status: 'PENDING',
        eligible: 50,
        available: 0,
        partial: 0,
        unavailable: 0,
        na: 0,
        coveragePct: null,
      },
      {
        capability: 'sentiment',
        status: 'PENDING',
        eligible: 50,
        available: 0,
        partial: 0,
        unavailable: 0,
        na: 0,
        coveragePct: null,
      },
    ]);
    expect(stages.find((s) => s.id === 'generate')?.state).toBe('pending');
    const run = batchRunProgressStages({
      lifecycle: 'DATA_VALIDATED',
      status: 'RUNNING',
      coverage: [
        {
          capability: 'fundamentals',
          status: 'PENDING',
          eligible: 50,
          available: 10,
          partial: 0,
          unavailable: 0,
          na: 0,
          coveragePct: 0.2,
        },
      ],
    });
    expect(run.find((s) => s.id === 'generate')?.state).toBe('pending');
    expect(run.find((s) => s.id === 'generate')?.state).not.toBe('active');
  });

  it('RUNNING_INTELLIGENCE activates Generate', () => {
    const run = batchRunProgressStages({
      lifecycle: 'RUNNING_INTELLIGENCE',
      status: 'RUNNING',
      coverage: [],
    });
    expect(run.find((s) => s.id === 'generate')?.state).toBe('active');
  });

  it('formatCoveragePct is formatting-only; N/A stays N/A', () => {
    expect(formatCoveragePct(0.996)).toBe('99.6%');
    expect(formatCoveragePct(null, 'N/A')).toBe('N/A');
    expect(formatCoveragePct(undefined, 'N/A')).toBe('N/A');
  });

  it('quarantined / IDENTITY_MISMATCH rows are filtered from normal opportunities', () => {
    const rows = validResultRows([
      { symbol: 'A', quarantined: false },
      { symbol: 'B', quarantined: true },
      { symbol: 'C', quarantineStatus: 'IDENTITY_MISMATCH' },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['A']);
  });
});
