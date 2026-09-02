import { buildP7ValidationReport } from './p7-validation-report';

describe('p7-validation-report', () => {
  it('V-A: PASS when all checks pass', () => {
    const report = buildP7ValidationReport({
      checks: [
        { id: 'V-A', label: 'Quality', verdict: 'PASS', detail: 'ok' },
        { id: 'V-B', label: 'EV', verdict: 'PASS', detail: 'ok' },
      ],
    });
    expect(report.verdict).toBe('PASS');
  });

  it('V-B: INCONCLUSIVE when any check inconclusive', () => {
    const report = buildP7ValidationReport({
      checks: [
        { id: 'V-A', label: 'Quality', verdict: 'PASS', detail: 'ok' },
        { id: 'V-C', label: 'Calibration', verdict: 'INCONCLUSIVE', detail: 'low buckets' },
      ],
    });
    expect(report.verdict).toBe('INCONCLUSIVE');
  });

  it('V-C: FAIL when isolation breached', () => {
    const report = buildP7ValidationReport({
      checks: [{ id: 'V-H', label: 'Isolation', verdict: 'FAIL', detail: 'auth mutation' }],
    });
    expect(report.verdict).toBe('FAIL');
  });
});
