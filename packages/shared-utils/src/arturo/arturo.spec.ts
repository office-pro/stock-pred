import { ArturoReleaseMode } from '@stockpred/shared-types';
import { evaluateFlag, resolveEffectiveEnabled } from './evaluate';
import { ArturoAccountRulesError, parseAccountRules } from './parse-account-rules';

describe('parseAccountRules', () => {
  it('parses inclusions and exclusions', () => {
    const rules = parseAccountRules('acme.local, beta.co, -internal, -test-account');
    expect(rules.includes).toEqual(['acme.local', 'beta.co']);
    expect(rules.excludes).toEqual(['internal', 'test-account']);
  });

  it('normalizes case and trims whitespace', () => {
    const rules = parseAccountRules('  Acme.Local , -Demo.Local ');
    expect(rules.includes).toEqual(['acme.local']);
    expect(rules.excludes).toEqual(['demo.local']);
  });

  it('rejects conflicting include/exclude', () => {
    expect(() => parseAccountRules('acme.local, -acme.local')).toThrow(ArturoAccountRulesError);
  });

  it('treats blank/comma-only as empty rules', () => {
    expect(parseAccountRules(',')).toEqual({ includes: [], excludes: [], raw: ',' });
    expect(parseAccountRules('')).toEqual({ includes: [], excludes: [], raw: '' });
  });

  it('rejects malformed tokens', () => {
    expect(() => parseAccountRules('bad token!')).toThrow(ArturoAccountRulesError);
    expect(() => parseAccountRules('-')).toThrow(ArturoAccountRulesError);
  });
});

describe('evaluateFlag', () => {
  const rules = parseAccountRules('alpha, beta, -internal');

  it('GA enables all non-excluded accounts', () => {
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
        rules,
        accountId: 'gamma',
      }),
    ).toBe(true);
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
        rules,
        accountId: 'internal',
      }),
    ).toBe(false);
  });

  it('CODE_BETA enables only explicit includes', () => {
    expect(evaluateFlag({ mode: ArturoReleaseMode.CODE_BETA, rules, accountId: 'alpha' })).toBe(
      true,
    );
    expect(evaluateFlag({ mode: ArturoReleaseMode.CODE_BETA, rules, accountId: 'gamma' })).toBe(
      false,
    );
  });

  it('exclusions take precedence over inclusions', () => {
    const conflictRules = parseAccountRules('internal');
    // When somehow exclude also present — parser rejects; evaluate still checks excludes first
    const withExclude = { ...conflictRules, excludes: ['internal'] };
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.CODE_BETA,
        rules: withExclude,
        accountId: 'internal',
      }),
    ).toBe(false);
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
        rules: withExclude,
        accountId: 'internal',
      }),
    ).toBe(false);
  });

  it('OFF disables all accounts', () => {
    expect(evaluateFlag({ mode: ArturoReleaseMode.OFF, rules, accountId: 'alpha' })).toBe(false);
    expect(evaluateFlag({ mode: ArturoReleaseMode.OFF, rules, accountId: 'gamma' })).toBe(false);
  });

  it('evaluates multiple flags independently', () => {
    const a = evaluateFlag({
      mode: ArturoReleaseMode.OFF,
      rules: parseAccountRules(''),
      accountId: 'alpha',
    });
    const b = evaluateFlag({
      mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
      rules: parseAccountRules(''),
      accountId: 'alpha',
    });
    expect(a).toBe(false);
    expect(b).toBe(true);
  });
});

describe('resolveEffectiveEnabled', () => {
  it('uses server when no override', () => {
    expect(resolveEffectiveEnabled(true, undefined)).toEqual({
      enabled: true,
      source: 'server',
    });
    expect(resolveEffectiveEnabled(false, undefined)).toEqual({
      enabled: false,
      source: 'server',
    });
  });

  it('local true overrides server false', () => {
    expect(resolveEffectiveEnabled(false, true)).toEqual({ enabled: true, source: 'local' });
  });

  it('local false overrides server true (does not treat false as absent)', () => {
    expect(resolveEffectiveEnabled(true, false)).toEqual({ enabled: false, source: 'local' });
  });
});
