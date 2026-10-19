/**
 * NSE_EQUITY_ALL preflight must hydrate canonical membership (equity-master),
 * same source as intelligence-batch create — never require FE symbol lists.
 */

import { BadRequestException } from '@nestjs/common';
import type { BatchPreflightConfiguration } from '@stockpred/shared-types';

const resolveNseAllMembership = jest.fn();

jest.mock('@stockpred/database', () => ({
  getPrismaClient: jest.fn(),
  resolveNseAllMembership: (...args: unknown[]) => resolveNseAllMembership(...args),
}));

import { hydratePreflightMembership } from './mi-combined-preflight.service';

function baseConfig(
  overrides: Partial<BatchPreflightConfiguration> = {},
): BatchPreflightConfiguration {
  return {
    universeType: 'NSE_EQUITY_ALL',
    analysisPeriod: { value: 6, unit: 'M' },
    resolution: '1D',
    predictionHorizon: { value: 1, unit: 'M' },
    mode: 'STANDARD',
    ...overrides,
  };
}

describe('hydratePreflightMembership', () => {
  beforeEach(() => {
    resolveNseAllMembership.mockReset();
  });

  it('loads equity-master symbols when NSE_EQUITY_ALL has no membership', () => {
    resolveNseAllMembership.mockReturnValue({
      symbols: ['RELIANCE', 'TCS', 'INFY'],
      snapshot: { version: 'v1', source: 'nse-equity-master' },
    });

    const out = hydratePreflightMembership(baseConfig());

    expect(resolveNseAllMembership).toHaveBeenCalledTimes(1);
    expect(out.nseEquityAllSymbols).toEqual(['RELIANCE', 'TCS', 'INFY']);
  });

  it('does not call registry when nseEquityAllSymbols already present', () => {
    const out = hydratePreflightMembership(baseConfig({ nseEquityAllSymbols: ['HDFCBANK'] }));
    expect(resolveNseAllMembership).not.toHaveBeenCalled();
    expect(out.nseEquityAllSymbols).toEqual(['HDFCBANK']);
  });

  it('skips registry when lockedMembershipSymbols is set', () => {
    const out = hydratePreflightMembership(baseConfig({ lockedMembershipSymbols: ['RELIANCE'] }));
    expect(resolveNseAllMembership).not.toHaveBeenCalled();
    expect(out.lockedMembershipSymbols).toEqual(['RELIANCE']);
  });

  it('leaves non-NSE_EQUITY_ALL configs unchanged', () => {
    const out = hydratePreflightMembership(baseConfig({ universeType: 'NIFTY50' }));
    expect(resolveNseAllMembership).not.toHaveBeenCalled();
    expect(out.nseEquityAllSymbols).toBeUndefined();
  });

  it('throws BadRequestException when equity-master is unavailable', () => {
    resolveNseAllMembership.mockImplementation(() => {
      throw new Error('equity-master missing');
    });
    expect(() => hydratePreflightMembership(baseConfig())).toThrow(BadRequestException);
    expect(() => hydratePreflightMembership(baseConfig())).toThrow(/equity-master missing/);
  });
});
