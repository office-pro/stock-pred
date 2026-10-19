/** Browser-local ARTURO overrides. Never sent as authorization to the backend. */

export const ARTURO_LOCAL_OVERRIDES_KEY = 'arturo.localOverrides.v1';

/** Dispatched on set/clear so `useArturoFlag` re-reads local overrides in-tab. */
export const ARTURO_LOCAL_OVERRIDE_EVENT = 'arturo:local-override-changed';

function notifyLocalOverrideChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ARTURO_LOCAL_OVERRIDE_EVENT));
}

export type ArturoLocalOverrides = Record<string, Record<string, boolean>>;

export function readLocalOverrides(storage: Storage = localStorage): ArturoLocalOverrides {
  try {
    const raw = storage.getItem(ARTURO_LOCAL_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ArturoLocalOverrides = {};
    for (const [flagKey, accounts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) continue;
      const map: Record<string, boolean> = {};
      for (const [userId, value] of Object.entries(accounts as Record<string, unknown>)) {
        if (typeof value === 'boolean') map[userId] = value;
      }
      if (Object.keys(map).length > 0) out[flagKey] = map;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLocalOverrides(data: ArturoLocalOverrides, storage: Storage = localStorage): void {
  storage.setItem(ARTURO_LOCAL_OVERRIDES_KEY, JSON.stringify(data));
}

export function getLocalOverride(
  flagKey: string,
  userId: string,
  storage: Storage = localStorage,
): boolean | undefined {
  const all = readLocalOverrides(storage);
  const value = all[flagKey]?.[userId];
  return value === undefined ? undefined : value;
}

export function setLocalOverride(
  flagKey: string,
  userId: string,
  enabled: boolean,
  storage: Storage = localStorage,
): void {
  const all = readLocalOverrides(storage);
  const forFlag = { ...(all[flagKey] ?? {}) };
  forFlag[userId] = enabled;
  all[flagKey] = forFlag;
  writeLocalOverrides(all, storage);
  notifyLocalOverrideChanged();
}

/** Clear one override; preserves unrelated flags and accounts. */
export function clearLocalOverride(
  flagKey: string,
  userId: string,
  storage: Storage = localStorage,
): void {
  const all = readLocalOverrides(storage);
  const forFlag = { ...(all[flagKey] ?? {}) };
  delete forFlag[userId];
  if (Object.keys(forFlag).length === 0) {
    delete all[flagKey];
  } else {
    all[flagKey] = forFlag;
  }
  writeLocalOverrides(all, storage);
  notifyLocalOverrideChanged();
}

/**
 * Effective UI state: local override (including explicit false) wins over server.
 * Critical: use `!== undefined`, never truthiness.
 */
export function resolveEffectiveEnabled(
  serverEnabled: boolean,
  localOverride: boolean | undefined,
): { enabled: boolean; source: 'local' | 'server' } {
  if (localOverride !== undefined) {
    return { enabled: localOverride, source: 'local' };
  }
  return { enabled: serverEnabled, source: 'server' };
}

/**
 * Coerce any value to a strict boolean for feature gates.
 * Only literal `true` enables; everything else → `false`.
 */
export function asArturoBoolean(value: unknown): boolean {
  return value === true;
}
