/**
 * P7 validation report — measurement artifact only.
 * PASS does not enable P6 or alter P5 evidence gate.
 */
import type {
  P7ValidationCheck,
  P7ValidationReport,
  P7ValidationVerdict,
} from '@stockpred/shared-types';

export interface BuildP7ValidationReportInput {
  checks: P7ValidationCheck[];
  generatedAt?: string;
}

export function resolveP7Verdict(checks: P7ValidationCheck[]): P7ValidationVerdict {
  if (checks.some((c) => c.verdict === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.verdict === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

export function buildP7ValidationReport(input: BuildP7ValidationReportInput): P7ValidationReport {
  const checks = input.checks;
  return {
    schemaVersion: 'p7-validation-report.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    checks,
    verdict: resolveP7Verdict(checks),
  };
}
