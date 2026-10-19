import { asArturoBoolean, resolveEffectiveEnabled } from '../lib/arturo-local-overrides';

describe('asArturoBoolean', () => {
  it('returns true only for literal true', () => {
    expect(asArturoBoolean(true)).toBe(true);
    expect(asArturoBoolean(false)).toBe(false);
    expect(asArturoBoolean(undefined)).toBe(false);
    expect(asArturoBoolean(null)).toBe(false);
    expect(asArturoBoolean(1)).toBe(false);
    expect(asArturoBoolean('true')).toBe(false);
  });
});

describe('useArturoFlag effective boolean contract', () => {
  it('local false yields false (not treated as absent)', () => {
    const effective = resolveEffectiveEnabled(true, false);
    expect(asArturoBoolean(effective.enabled)).toBe(false);
  });

  it('local true yields true over server false', () => {
    const effective = resolveEffectiveEnabled(false, true);
    expect(asArturoBoolean(effective.enabled)).toBe(true);
  });

  it('absent override uses server boolean', () => {
    expect(asArturoBoolean(resolveEffectiveEnabled(true, undefined).enabled)).toBe(true);
    expect(asArturoBoolean(resolveEffectiveEnabled(false, undefined).enabled)).toBe(false);
  });
});
