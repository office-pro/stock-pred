import {
  ARTURO_UI_UNLOCK_KEY,
  ARTURO_UI_UNLOCK_SHA,
  isArturoUiUnlocked,
  syncArturoUnlockFromSearch,
} from './arturo-ui-unlock';

describe('arturo ui unlock (sha=develop)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('unlocks on sha=develop', () => {
    expect(syncArturoUnlockFromSearch('?sha=develop')).toBe(true);
    expect(sessionStorage.getItem(ARTURO_UI_UNLOCK_KEY)).toBe(ARTURO_UI_UNLOCK_SHA);
    expect(isArturoUiUnlocked()).toBe(true);
  });

  it('stays unlocked across navigations without sha', () => {
    syncArturoUnlockFromSearch('?sha=develop');
    expect(syncArturoUnlockFromSearch('')).toBe(true);
    expect(syncArturoUnlockFromSearch('?')).toBe(true);
  });

  it('locks on sha=off', () => {
    syncArturoUnlockFromSearch('?sha=develop');
    expect(syncArturoUnlockFromSearch('?sha=off')).toBe(false);
    expect(isArturoUiUnlocked()).toBe(false);
  });

  it('ignores other sha values', () => {
    expect(syncArturoUnlockFromSearch('?sha=main')).toBe(false);
    expect(isArturoUiUnlocked()).toBe(false);
  });
});
