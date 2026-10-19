import { ARTURO_FLAGS, arturoFlagKey, isArturoFlagKey } from '@stockpred/shared-types';

describe('ARTURO flag naming convention', () => {
  it('builds feat_<area>_<feature> keys', () => {
    expect(arturoFlagKey('desk', 'experimental_chip')).toBe('feat_desk_experimental_chip');
    expect(arturoFlagKey('Bull Run', 'New Banner')).toBe('feat_bull_run_new_banner');
  });

  it('validates convention keys', () => {
    expect(isArturoFlagKey(ARTURO_FLAGS.DESK_EXPERIMENTAL_CHIP)).toBe(true);
    expect(isArturoFlagKey('arturo_desk_experimental')).toBe(false);
    expect(isArturoFlagKey('Desk_Experimental')).toBe(false);
  });
});
