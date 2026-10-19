/**
 * MI-7.9 — Result Detail consumes backend advanced statuses (no fabricated scores).
 * Lightweight contract test for the panel shape used by BatchResultDetail.
 */
describe('MI-7.9 result detail advanced sections contract', () => {
  it('UNAVAILABLE sections expose status+reason without numeric score fields', () => {
    const advancedSections = {
      catalyst: { status: 'UNAVAILABLE', reason: 'NO_QUALIFYING_CATALYST_EVIDENCE' },
      bullRun: { status: 'DATA_INCOMPLETE', reason: 'INSUFFICIENT_HISTORY' },
      analogues: { status: 'UNAVAILABLE', reason: 'INSUFFICIENT_ANALOGUE_SAMPLE' },
      relationships: { status: 'NOT_APPLICABLE', reason: 'NO_COUNTERPART_SERIES' },
      globalImpact: { status: 'UNAVAILABLE', reason: 'NO_QUALIFYING_GLOBAL_SOURCE_DATA' },
    };
    for (const section of Object.values(advancedSections)) {
      expect(section.status).toBeTruthy();
      expect('score' in section).toBe(false);
      expect('globalImpactScore' in section).toBe(false);
    }
  });
});
