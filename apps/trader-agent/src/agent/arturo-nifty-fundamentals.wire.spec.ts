import { ARTURO_FLAGS } from '@stockpred/shared-types';
import {
  applyArturoNiftyFundamentalsRequirement,
  isNiftyAllStockUniverse,
} from '@stockpred/shared-utils';

describe('ARTURO nifty fundamentals wire contract', () => {
  it('uses the ARTURO UI key exactly', () => {
    expect(ARTURO_FLAGS.NIFTY_ALL_STOCK_REQUIREMENT_FUNDAMENTALS).toBe(
      'feat_nifty_all_stock_prequirement_fundamentals',
    );
  });

  it('ON requires real fundamentals for NIFTY500', () => {
    expect(isNiftyAllStockUniverse('NIFTY500')).toBe(true);
    const gated = applyArturoNiftyFundamentalsRequirement(
      {
        universeType: 'NIFTY500',
        analysisPeriod: { value: 3, unit: 'M' },
        resolution: '1D',
        predictionHorizon: { value: 1, unit: 'M' },
        mode: 'STANDARD',
      },
      true,
    );
    expect(gated.intelligence?.fundamentals).toBe(true);
  });
});
