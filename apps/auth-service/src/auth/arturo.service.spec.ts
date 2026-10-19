import { ArturoReleaseMode } from '@stockpred/shared-types';
import { evaluateFlag, parseAccountRules } from '@stockpred/shared-utils';

/**
 * Security-oriented evaluation checks (session account only — service resolves brand).
 * Full Nest DI tests would need Prisma mock; shared evaluator covers release math.
 */
describe('ARTURO evaluation contract', () => {
  it('does not enable OFF mode even with includes', () => {
    const rules = parseAccountRules('acme.local');
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.OFF,
        rules,
        accountId: 'acme.local',
      }),
    ).toBe(false);
  });

  it('CODE_BETA requires exact account match', () => {
    const rules = parseAccountRules('acme.local');
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.CODE_BETA,
        rules,
        accountId: 'acme',
      }),
    ).toBe(false);
  });

  it('GA exclusion blocks account', () => {
    const rules = parseAccountRules('-blocked.local');
    expect(
      evaluateFlag({
        mode: ArturoReleaseMode.GENERAL_AVAILABILITY,
        rules,
        accountId: 'blocked.local',
      }),
    ).toBe(false);
  });
});
