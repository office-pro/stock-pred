import {
  applyArturoNiftyFundamentalsRequirement,
  isNiftyAllStockUniverse,
} from './arturo-nifty-fundamentals';
import type { BatchPreflightConfiguration } from '@stockpred/shared-types';

function base(universeType: string): BatchPreflightConfiguration {
  return {
    universeType: universeType as BatchPreflightConfiguration['universeType'],
    analysisPeriod: { value: 3, unit: 'M' },
    resolution: '1D',
    predictionHorizon: { value: 1, unit: 'M' },
    mode: 'STANDARD',
  };
}

describe('arturo nifty fundamentals gate', () => {
  it('recognizes nifty / nse-all universes', () => {
    expect(isNiftyAllStockUniverse('NIFTY500')).toBe(true);
    expect(isNiftyAllStockUniverse('NSE_EQUITY_ALL')).toBe(true);
    expect(isNiftyAllStockUniverse('US_ALL')).toBe(false);
  });

  it('when flag ON forces fundamentals true (REQUIRED path)', () => {
    const out = applyArturoNiftyFundamentalsRequirement(base('NIFTY50'), true);
    expect(out.intelligence?.fundamentals).toBe(true);
  });

  it('when flag OFF forces fundamentals false (no fake-complete block)', () => {
    const out = applyArturoNiftyFundamentalsRequirement(base('NSE_EQUITY_ALL'), false);
    expect(out.intelligence?.fundamentals).toBe(false);
  });

  it('leaves non-nifty universes unchanged', () => {
    const cfg = { ...base('CUSTOM'), customSymbols: ['AAA'], intelligence: { news: true } };
    const out = applyArturoNiftyFundamentalsRequirement(cfg, true);
    expect(out.intelligence).toEqual({ news: true });
  });
});
