import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isArturoUiUnlocked, syncArturoUnlockFromSearch } from '../lib/arturo-ui-unlock';

/**
 * ARTURO management UI is visible only after `?sha=develop` (persists for the tab session).
 * Use `?sha=off` to hide it again.
 */
export function useArturoUiUnlock(): boolean {
  const location = useLocation();
  const [unlocked, setUnlocked] = useState(() => syncArturoUnlockFromSearch(location.search));

  useEffect(() => {
    setUnlocked(syncArturoUnlockFromSearch(location.search));
  }, [location.search]);

  useEffect(() => {
    // Re-read if another part of the app clears/sets sessionStorage in-tab.
    const onStorage = (): void => setUnlocked(isArturoUiUnlocked());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return unlocked;
}
