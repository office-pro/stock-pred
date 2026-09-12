/**
 * P8 Scale Throughput — validation types only.
 * Core throughput knobs live in shared-utils throughput-scale.ts.
 */

export type P8ValidationVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface P8ValidationCheck {
  id: string;
  label: string;
  verdict: P8ValidationVerdict;
  detail: string;
}

export interface P8ValidationReport {
  schemaVersion: 'p8-validation-report.v1';
  generatedAt: string;
  checks: P8ValidationCheck[];
  verdict: P8ValidationVerdict;
}

/** Tenant snapshot field — global-only; not populated per-tenant. */
export const P8_TENANT_DRAWDOWN_GLOBAL_ONLY = true as const;
