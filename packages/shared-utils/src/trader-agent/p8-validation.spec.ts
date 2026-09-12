import { buildP8ValidationReport } from './p8-validation-report';

describe('p8-validation-report', () => {
  it('PASS when all checks pass', () => {
    const report = buildP8ValidationReport({
      checks: [
        { id: 'P8.2', label: 'Load harness', verdict: 'PASS', detail: 'invariants ok' },
        { id: 'P8.3', label: 'Isolation', verdict: 'PASS', detail: 'ok' },
      ],
    });
    expect(report.verdict).toBe('PASS');
    expect(report.schemaVersion).toBe('p8-validation-report.v1');
  });

  it('FAIL when invariant breached (not INCONCLUSIVE)', () => {
    const report = buildP8ValidationReport({
      checks: [
        { id: 'P8.2', label: 'Load harness', verdict: 'FAIL', detail: 'peakConcurrency 14 > 10' },
      ],
    });
    expect(report.verdict).toBe('FAIL');
  });

  it('INCONCLUSIVE when evidence unavailable only', () => {
    const report = buildP8ValidationReport({
      checks: [
        { id: 'P8.2', label: 'Load harness', verdict: 'PASS', detail: 'ok' },
        { id: 'P8.4', label: 'Wiring', verdict: 'INCONCLUSIVE', detail: 'fixture unavailable' },
      ],
    });
    expect(report.verdict).toBe('INCONCLUSIVE');
  });
});
