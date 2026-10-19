/**
 * BATCH UNIVERSE RULE — predefined must not require FE symbols.
 */
import { universeRequiresManualInstruments, PREDEFINED_BATCH_UNIVERSES } from './universe-catalog';

describe('universeRequiresManualInstruments', () => {
  it('predefined universes never require manual symbols', () => {
    for (const id of PREDEFINED_BATCH_UNIVERSES) {
      expect(universeRequiresManualInstruments(id)).toBe(false);
    }
  });

  it('CUSTOM / SINGLE_STOCK / *_CUSTOM require manual instruments', () => {
    expect(universeRequiresManualInstruments('CUSTOM')).toBe(true);
    expect(universeRequiresManualInstruments('SINGLE_STOCK')).toBe(true);
    expect(universeRequiresManualInstruments('US_CUSTOM')).toBe(true);
    expect(universeRequiresManualInstruments('CRYPTO_CUSTOM')).toBe(true);
  });

  it('NSE_ALL is predefined (not cache / not custom)', () => {
    expect(universeRequiresManualInstruments('NSE_ALL')).toBe(false);
    expect(PREDEFINED_BATCH_UNIVERSES.has('NSE_ALL')).toBe(true);
  });
});
