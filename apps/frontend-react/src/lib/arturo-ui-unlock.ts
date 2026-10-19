/** Session unlock for ARTURO management UI via `?sha=develop`. */

export const ARTURO_UI_UNLOCK_KEY = 'arturo.uiUnlock.v1';
export const ARTURO_UI_UNLOCK_SHA = 'develop';

/**
 * Sync unlock from the current URL search string.
 * - `?sha=develop` → unlock for this browser tab session
 * - `?sha=off` → lock again
 * - otherwise keep existing session value
 */
export function syncArturoUnlockFromSearch(search: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sha = (params.get('sha') ?? '').trim().toLowerCase();
  if (sha === ARTURO_UI_UNLOCK_SHA) {
    sessionStorage.setItem(ARTURO_UI_UNLOCK_KEY, ARTURO_UI_UNLOCK_SHA);
    return true;
  }
  if (sha === 'off' || sha === '0' || sha === 'false') {
    sessionStorage.removeItem(ARTURO_UI_UNLOCK_KEY);
    return false;
  }
  return isArturoUiUnlocked();
}

export function isArturoUiUnlocked(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(ARTURO_UI_UNLOCK_KEY) === ARTURO_UI_UNLOCK_SHA;
}
