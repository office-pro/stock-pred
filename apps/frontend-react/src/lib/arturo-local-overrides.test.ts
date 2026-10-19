import {
  ARTURO_LOCAL_OVERRIDES_KEY,
  clearLocalOverride,
  getLocalOverride,
  readLocalOverrides,
  resolveEffectiveEnabled,
  setLocalOverride,
} from './arturo-local-overrides';

function memoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('arturo local overrides', () => {
  it('returns undefined when absent (not false)', () => {
    const storage = memoryStorage();
    expect(getLocalOverride('trading_engine_test', 'u1', storage)).toBeUndefined();
  });

  it('stores and reads explicit false', () => {
    const storage = memoryStorage();
    setLocalOverride('trading_engine_test', 'u1', false, storage);
    expect(getLocalOverride('trading_engine_test', 'u1', storage)).toBe(false);
  });

  it('stores true and survives round-trip', () => {
    const storage = memoryStorage();
    setLocalOverride('risk_analysis_flow', 'u1', true, storage);
    expect(getLocalOverride('risk_analysis_flow', 'u1', storage)).toBe(true);
    expect(JSON.parse(storage.getItem(ARTURO_LOCAL_OVERRIDES_KEY) ?? '{}')).toEqual({
      risk_analysis_flow: { u1: true },
    });
  });

  it('isolates by flag and account; clear preserves others', () => {
    const storage = memoryStorage();
    setLocalOverride('a', 'u1', true, storage);
    setLocalOverride('a', 'u2', false, storage);
    setLocalOverride('b', 'u1', false, storage);
    clearLocalOverride('a', 'u1', storage);
    expect(getLocalOverride('a', 'u1', storage)).toBeUndefined();
    expect(getLocalOverride('a', 'u2', storage)).toBe(false);
    expect(getLocalOverride('b', 'u1', storage)).toBe(false);
  });

  it('fails safe on malformed storage', () => {
    const storage = memoryStorage({ [ARTURO_LOCAL_OVERRIDES_KEY]: 'not-json' });
    expect(readLocalOverrides(storage)).toEqual({});
    const bad = memoryStorage({ [ARTURO_LOCAL_OVERRIDES_KEY]: '{"x":[]}' });
    expect(readLocalOverrides(bad)).toEqual({});
  });

  it('resolveEffectiveEnabled treats false as override', () => {
    expect(resolveEffectiveEnabled(true, false)).toEqual({ enabled: false, source: 'local' });
    expect(resolveEffectiveEnabled(false, true)).toEqual({ enabled: true, source: 'local' });
    expect(resolveEffectiveEnabled(true, undefined)).toEqual({ enabled: true, source: 'server' });
  });
});
