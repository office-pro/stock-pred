import { useEffect, useState } from 'react';
import { isNseRegularSession } from '../lib/market-hours';

/** Tracks NSE cash hours and re-checks every 30s so polling can flip at the bell. */
export function useNseSession(): boolean {
  const [open, setOpen] = useState(() => isNseRegularSession());

  useEffect(() => {
    const id = window.setInterval(() => setOpen(isNseRegularSession()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return open;
}
