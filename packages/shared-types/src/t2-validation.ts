/**
 * T2 Validation Gate — evidence artifact types only.
 * Does not modify or enable Risk / Portfolio / Policy / Gate / P5 / P6 ARM.
 */

export type T2ValidationVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export type T2ValidationCheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'INCONCLUSIVE';

/** Canonical authorization comparison — excludes timestamps, IDs, diagnostics. */
export interface AuthorizationProjection {
  risk: { allowed: boolean; reasonCodes: string[]; quantity?: number };
  portfolio: { allowed: boolean; reasonCodes: string[] };
  policy: { outcome: string; reasonCodes: string[] };
  gate?: { allowed: boolean; reasonCodes: string[] };
}

export interface T2ValidationCheck {
  id: string;
  title: string;
  /** Required SKIP/INCONCLUSIVE prevents PASS verdict. */
  required: boolean;
  status: T2ValidationCheckStatus;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface T2ValidationFinding {
  id: string;
  severity: 'BLOCKER' | 'WARN';
  message: string;
  relatedCheckIds: string[];
}

export interface T2ValidationRegressionSummary {
  t2SliceTests: { pattern: string; passed: number; total: number }[];
  sharedUtils: { passed: number; total: number } | null;
  builds: { target: string; ok: boolean }[];
  frozenFilesDiffClean: boolean;
}

export interface T2ValidationReport {
  schemaVersion: 't2-validation-report.v1';
  generatedAt: string;
  verdict: T2ValidationVerdict;
  reason: string;
  /** Evidence only — does not modify Risk/Portfolio/Policy/Gate/P5/P6 ARM. */
  evidenceOnly: true;
  checks: T2ValidationCheck[];
  findings: T2ValidationFinding[];
  regression: T2ValidationRegressionSummary;
}
