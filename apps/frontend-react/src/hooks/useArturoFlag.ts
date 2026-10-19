import type { ArturoFlagKey } from '@stockpred/shared-types';
import { useEffect, useMemo, useState } from 'react';
import {
  ARTURO_LOCAL_OVERRIDE_EVENT,
  ARTURO_LOCAL_OVERRIDES_KEY,
  asArturoBoolean,
  getLocalOverride,
  resolveEffectiveEnabled,
} from '../lib/arturo-local-overrides';
import { useAppSelector } from '../store';
import { useGetArturoEvaluationQuery, useGetArturoStatusQuery } from '../store/api';

export { asArturoBoolean } from '../lib/arturo-local-overrides';

/** Accept registered keys or any feat_* string created in ARTURO UI. */
export type ArturoFlagKeyInput = ArturoFlagKey | (string & {});

function useLocalOverrideTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((t) => t + 1);
    window.addEventListener(ARTURO_LOCAL_OVERRIDE_EVENT, bump);
    const onStorage = (e: StorageEvent): void => {
      if (e.key === ARTURO_LOCAL_OVERRIDES_KEY || e.key === null) bump();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ARTURO_LOCAL_OVERRIDE_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return tick;
}

/**
 * Feature-gate hook: returns **only** `true` or `false`.
 *
 * Prefer registered constants from `ARTURO_FLAGS` (naming: feat_&lt;area&gt;_&lt;feature&gt;).
 *
 * @example
 * import { ARTURO_FLAGS } from '@stockpred/shared-types';
 * const show = useArturoFlag(ARTURO_FLAGS.DESK_EXPERIMENTAL_CHIP);
 * if (show) { ... }
 *
 * Safe defaults: ARTURO off, loading, error, or missing flag → `false`.
 * Local overrides (including explicit `false`) apply in this browser only.
 */
export function useArturoFlag(flagKey: ArturoFlagKeyInput, options?: { skip?: boolean }): boolean {
  const normalized = flagKey.trim().toLowerCase();
  const map = useArturoFlags(normalized ? [normalized] : [], options);
  return asArturoBoolean(map[normalized]);
}

/**
 * Batch feature-gate hook. Every requested key maps to a strict boolean.
 * Missing keys are `false`.
 */
export function useArturoFlags(
  flagKeys: ArturoFlagKeyInput[],
  options?: { skip?: boolean },
): Record<string, boolean> {
  const user = useAppSelector((s) => s.auth.user);
  const overrideTick = useLocalOverrideTick();
  const keysKey = flagKeys
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
  const keys = useMemo(() => (keysKey ? keysKey.split('|') : []), [keysKey]);

  const skip = Boolean(options?.skip) || !user || keys.length === 0;

  const { data: status } = useGetArturoStatusQuery(undefined, { skip });
  const arturoOn = status?.enabled === true;

  const { data: evaluation } = useGetArturoEvaluationQuery(keys, {
    skip: skip || !arturoOn,
  });

  return useMemo(() => {
    void overrideTick;
    const out: Record<string, boolean> = {};
    for (const key of keys) {
      out[key] = false;
    }
    if (!arturoOn || !evaluation?.results) {
      return out;
    }
    for (const row of evaluation.results) {
      const local = user?.id ? getLocalOverride(row.key, user.id) : undefined;
      const effective = resolveEffectiveEnabled(row.enabled === true, local);
      out[row.key] = asArturoBoolean(effective.enabled);
    }
    return out;
  }, [arturoOn, evaluation, keys, user?.id, overrideTick]);
}
