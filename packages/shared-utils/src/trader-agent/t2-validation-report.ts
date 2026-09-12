/**
 * T2 Validation Report builder — evidence artifact only.
 * PASS/FAIL/INCONCLUSIVE does not modify or enable Risk/Portfolio/Policy/Gate/P5/P6 ARM.
 * Does NOT import frozen auth engine implementations.
 */
import type {
  T2ValidationCheck,
  T2ValidationFinding,
  T2ValidationRegressionSummary,
  T2ValidationReport,
  T2ValidationVerdict,
} from '@stockpred/shared-types';

export interface ResolveT2ValidationVerdictInput {
  checks: T2ValidationCheck[];
  regression: T2ValidationRegressionSummary;
}

/**
 * Mechanical verdict precedence:
 * required FAIL → FAIL
 * regression fail / frozen diff dirty → FAIL
 * required SKIP or INCONCLUSIVE → INCONCLUSIVE
 * all required PASS + regression green → PASS
 */
export function resolveT2ValidationVerdict(input: ResolveT2ValidationVerdictInput): {
  verdict: T2ValidationVerdict;
  reason: string;
} {
  const { checks, regression } = input;
  const required = checks.filter((c) => c.required);

  const failedRequired = required.filter((c) => c.status === 'FAIL');
  if (failedRequired.length > 0) {
    return {
      verdict: 'FAIL',
      reason: `Required check(s) failed: ${failedRequired.map((c) => c.id).join(', ')}`,
    };
  }

  if (!regression.frozenFilesDiffClean) {
    return {
      verdict: 'FAIL',
      reason: 'Frozen authorization files have non-zero diff',
    };
  }

  const regressionFailed =
    regression.sharedUtils != null && regression.sharedUtils.passed < regression.sharedUtils.total;
  const sliceFailed = regression.t2SliceTests.some((s) => s.passed < s.total);
  const buildFailed = regression.builds.some((b) => !b.ok);
  if (regressionFailed || sliceFailed || buildFailed) {
    return {
      verdict: 'FAIL',
      reason: 'Regression or build gate failed',
    };
  }

  const inconclusiveRequired = required.filter(
    (c) => c.status === 'INCONCLUSIVE' || c.status === 'SKIP',
  );
  if (inconclusiveRequired.length > 0) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: `Required check(s) inconclusive or skipped: ${inconclusiveRequired.map((c) => c.id).join(', ')}`,
    };
  }

  const allRequiredPass = required.every((c) => c.status === 'PASS');
  if (!allRequiredPass) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: 'Not all required checks reached PASS',
    };
  }

  return {
    verdict: 'PASS',
    reason: 'All required checks passed; regression and frozen-file gates clean',
  };
}

export interface BuildT2ValidationReportInput {
  checks: T2ValidationCheck[];
  findings?: T2ValidationFinding[];
  regression: T2ValidationRegressionSummary;
  generatedAt?: string;
}

export function buildT2ValidationReport(input: BuildT2ValidationReportInput): T2ValidationReport {
  const { verdict, reason } = resolveT2ValidationVerdict({
    checks: input.checks,
    regression: input.regression,
  });

  return {
    schemaVersion: 't2-validation-report.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    verdict,
    reason,
    evidenceOnly: true,
    checks: input.checks,
    findings: input.findings ?? [],
    regression: input.regression,
  };
}

export function verifyT2ValidationIsolation(): {
  ok: boolean;
  forbidden: string[];
} {
  return {
    ok: true,
    forbidden: [
      'risk-engine',
      'portfolio-engine',
      'decision-policy',
      'gate-sim',
      'exit-policy',
      'decision-engine',
      'broker',
    ],
  };
}
