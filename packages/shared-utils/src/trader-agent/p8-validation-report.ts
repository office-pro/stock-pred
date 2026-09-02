/**
 * P8 validation report — measurement artifact only.
 * PASS does not enable P6 or alter P5 evidence gate.
 */
import type {
  P8ValidationCheck,
  P8ValidationReport,
  P8ValidationVerdict,
} from '@stockpred/shared-types';

export interface BuildP8ValidationReportInput {
  checks: P8ValidationCheck[];
  generatedAt?: string;
}

export function resolveP8Verdict(checks: P8ValidationCheck[]): P8ValidationVerdict {
  if (checks.some((c) => c.verdict === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.verdict === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

export function buildP8ValidationReport(input: BuildP8ValidationReportInput): P8ValidationReport {
  const checks = input.checks;
  return {
    schemaVersion: 'p8-validation-report.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    checks,
    verdict: resolveP8Verdict(checks),
  };
}
