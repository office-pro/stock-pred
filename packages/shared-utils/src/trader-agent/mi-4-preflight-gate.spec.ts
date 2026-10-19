import type { CombinedBatchPreflightV2 } from '@stockpred/shared-types';
import { resolveIntelligenceUniverse } from './intelligence-batch-universe';
import { resolveDataRequirementPlan } from './mi-data-requirement-plan';
import {
  buildPreflightBlockedErrorBody,
  mapCreateRequestToBatchPreflightConfiguration,
  miUniverseTypeForCreate,
  parseAnalysisPeriodToDuration,
} from './mi-create-preflight-map';

describe('MI-4 mapCreateRequestToBatchPreflightConfiguration', () => {
  it('maps analysisPeriod and defaults miMode to STANDARD (not execution mode)', () => {
    const cfg = mapCreateRequestToBatchPreflightConfiguration({
      universeType: 'NIFTY50',
      resolvedSymbols: ['AAA', 'BBB'],
      analysisPeriod: '6M',
      analysisResolution: '1D',
      predictionHorizon: '1M',
    });
    expect(cfg.mode).toBe('STANDARD');
    expect(cfg.analysisPeriod).toEqual({ value: 6, unit: 'M' });
    expect(cfg.lockedMembershipSymbols).toEqual(['AAA', 'BBB']);
    expect(cfg.resolution).toBe('1D');
  });

  it('honors miMode and intelligence flags independently of HISTORICAL', () => {
    const cfg = mapCreateRequestToBatchPreflightConfiguration({
      universeType: 'CUSTOM',
      resolvedSymbols: ['RELIANCE', 'TCS'],
      analysisPeriod: '3M',
      miMode: 'ADVANCED',
      intelligence: { news: false },
    });
    expect(cfg.mode).toBe('ADVANCED');
    expect(cfg.intelligence?.news).toBe(false);
    expect(cfg.customSymbols).toEqual(['RELIANCE', 'TCS']);
  });

  it('Lock 1: lockedMembershipSymbols drive plan membership (no catalog re-resolve)', () => {
    const locked = ['RELIANCE', 'INFY', 'TCS'];
    const cfg = mapCreateRequestToBatchPreflightConfiguration({
      universeType: 'NIFTY50',
      resolvedSymbols: locked,
      analysisPeriod: '3M',
    });
    const plan = resolveDataRequirementPlan(cfg);
    expect(plan.universe.instruments.map((i) => i.symbol)).toEqual(locked);
    expect(plan.universe.requestedCount).toBe(3);
  });

  it('parseAnalysisPeriodToDuration is deterministic', () => {
    expect(parseAnalysisPeriodToDuration('1Y')).toEqual({ value: 1, unit: 'Y' });
    expect(parseAnalysisPeriodToDuration('12M')).toEqual({ value: 1, unit: 'Y' });
    expect(parseAnalysisPeriodToDuration(undefined)).toEqual({ value: 3, unit: 'M' });
  });

  it('miUniverseTypeForCreate maps NSE_ALL and leaves US unsupported', () => {
    expect(miUniverseTypeForCreate('NSE_ALL')).toBe('NSE_EQUITY_ALL');
    expect(miUniverseTypeForCreate('NIFTY50')).toBe('NIFTY50');
    expect(miUniverseTypeForCreate('US_ALL')).toBeNull();
    expect(miUniverseTypeForCreate('NIFTY150')).toBeNull();
  });

  it('NIFTY50 create membership equals locked symbols used for preflight', () => {
    const symbols = resolveIntelligenceUniverse({ universe: 'NIFTY50' });
    expect(symbols.length).toBe(50);
    const cfg = mapCreateRequestToBatchPreflightConfiguration({
      universeType: 'NIFTY50',
      resolvedSymbols: symbols,
      analysisPeriod: '3M',
    });
    const plan = resolveDataRequirementPlan(cfg);
    expect(plan.universe.instruments.map((i) => i.symbol)).toEqual(symbols);
  });
});

describe('MI-4 buildPreflightBlockedErrorBody', () => {
  it('shapes PREFLIGHT_BLOCKED payload', () => {
    const combined = {
      canRun: false,
      blockers: ['MARKET_DATA_INSUFFICIENT'],
      warnings: [],
      universe: { requested: 2, resolved: 2, unresolved: 0, mismatched: 0 },
      marketData: {
        mode: 'REQUIRED',
        available: 0,
        requiredCount: 2,
        coverage: 'MISSING',
        freshness: 'UNKNOWN',
      },
      historical: {
        mode: 'REQUIRED',
        available: 0,
        requiredCount: 2,
        coverage: 'MISSING',
        freshness: 'UNKNOWN',
      },
      intelligence: {} as CombinedBatchPreflightV2['intelligence'],
      generatedAt: '2026-09-01T00:00:00.000Z',
      asOf: '2026-09-01T00:00:00.000Z',
    } as CombinedBatchPreflightV2;
    const body = buildPreflightBlockedErrorBody(combined);
    expect(body.code).toBe('PREFLIGHT_BLOCKED');
    expect(body.blockers).toEqual(['MARKET_DATA_INSUFFICIENT']);
    expect(body.combinedPreflight).toBe(combined);
  });
});
