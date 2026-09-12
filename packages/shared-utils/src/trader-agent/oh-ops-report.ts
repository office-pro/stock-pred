/**
 * OH-6 Unified Operations Report — aggregate OH-1…OH-5 observe-only snapshots.
 * Never authorizes, rejects, resizes, or mutates Risk / Portfolio / Policy / Gate / TI / P5.
 */

import type {
  OhDataQualitySnapshot,
  OhExecutionHealthSnapshot,
  OhOpsComponentId,
  OhOpsComponentStatus,
  OhOpsRecommendedAction,
  OhOpsReportSnapshot,
  OhOpsReportStatus,
  OhOpsSeverity,
  OhPipelineMetricsSnapshot,
  OhReconciliationReport,
  OhSafetyEventsSnapshot,
} from '@stockpred/shared-types';

export interface OhOpsReportInput {
  pipeline: OhPipelineMetricsSnapshot;
  execution: OhExecutionHealthSnapshot;
  reconciliation: OhReconciliationReport | null;
  safety: OhSafetyEventsSnapshot;
  dataQuality: OhDataQualitySnapshot;
  now?: number;
}

function severityFromStatus(status: OhOpsReportStatus): OhOpsSeverity {
  if (status === 'UNAVAILABLE') return 'CRITICAL';
  if (status === 'DEGRADED') return 'WARN';
  return 'INFO';
}

function component(
  id: OhOpsComponentId,
  status: OhOpsReportStatus,
  summary: string,
  diagnostics: string[] = [],
): OhOpsComponentStatus {
  return { id, status, severity: severityFromStatus(status), summary, diagnostics };
}

/** Derive OH-1 component status from pipeline metrics. */
export function classifyPipelineComponent(snap: OhPipelineMetricsSnapshot): OhOpsComponentStatus {
  const diagnostics: string[] = [];
  if (snap.sampleCount === 0) {
    diagnostics.push('no pipeline samples recorded');
    return component('OH1_PIPELINE', 'DEGRADED', 'No pipeline telemetry yet', diagnostics);
  }
  const recentErrors = snap.recent.filter((s) => !s.ok).length;
  if (recentErrors > 0) {
    diagnostics.push(`${recentErrors} recent pipeline error(s)`);
  }
  const slow = snap.stages.find((s) => (s.p95Ms ?? 0) > 30_000);
  if (slow) {
    diagnostics.push(`slow stage ${slow.stage} p95=${slow.p95Ms}ms`);
  }
  if (snap.lastQuoteAgeMs != null && snap.lastQuoteAgeMs > 60_000) {
    diagnostics.push(`lastQuoteAgeMs=${snap.lastQuoteAgeMs}`);
  }
  if (diagnostics.length > 0) {
    return component('OH1_PIPELINE', 'DEGRADED', 'Pipeline telemetry degraded', diagnostics);
  }
  return component('OH1_PIPELINE', 'HEALTHY', 'Pipeline telemetry nominal', diagnostics);
}

/** Derive OH-2 component status from execution health snapshot. */
export function classifyExecutionComponent(snap: OhExecutionHealthSnapshot): OhOpsComponentStatus {
  return component(
    'OH2_EXECUTION',
    snap.status,
    `Execution ${snap.status.toLowerCase()}`,
    snap.diagnostics.slice(),
  );
}

/** Derive OH-3 component status from reconciliation report. */
export function classifyReconciliationComponent(
  snap: OhReconciliationReport | null,
): OhOpsComponentStatus {
  if (snap == null) {
    return component('OH3_RECONCILIATION', 'DEGRADED', 'Reconciliation not available', [
      'reconciliation snapshot missing',
    ]);
  }
  const diagnostics: string[] = [];
  if (snap.summary.criticalCount > 0) {
    diagnostics.push(`${snap.summary.criticalCount} critical issue(s)`);
  }
  if (snap.summary.warnCount > 0) {
    diagnostics.push(`${snap.summary.warnCount} warning issue(s)`);
  }
  if (snap.summary.issueCount === 0) {
    return component('OH3_RECONCILIATION', 'HEALTHY', 'Ledger/holdings aligned', diagnostics);
  }
  if (snap.summary.criticalCount > 0) {
    return component(
      'OH3_RECONCILIATION',
      'UNAVAILABLE',
      'Critical reconciliation mismatch',
      diagnostics,
    );
  }
  return component(
    'OH3_RECONCILIATION',
    'DEGRADED',
    'Reconciliation warnings present',
    diagnostics,
  );
}

/** Derive OH-4 component status from safety events. */
export function classifySafetyComponent(snap: OhSafetyEventsSnapshot): OhOpsComponentStatus {
  const diagnostics: string[] = [];
  const criticalCodes = ['KILL_SWITCH_TRIGGERED', 'TRADING_DISABLED'] as const;
  for (const code of criticalCodes) {
    if ((snap.counts[code] ?? 0) > 0) diagnostics.push(code);
  }
  if (snap.counts.DISARM_CONFIRMED > 0) diagnostics.push('DISARM_CONFIRMED');
  if (snap.counts.AUTONOMOUS_AUTHORIZATION_BLOCKED > 0) {
    diagnostics.push('AUTONOMOUS_AUTHORIZATION_BLOCKED');
  }
  if (diagnostics.some((d) => d === 'KILL_SWITCH_TRIGGERED' || d === 'TRADING_DISABLED')) {
    return component('OH4_SAFETY', 'DEGRADED', 'Safety latch events recorded', diagnostics);
  }
  if (diagnostics.length > 0) {
    return component('OH4_SAFETY', 'DEGRADED', 'Safety audit events present', diagnostics);
  }
  return component('OH4_SAFETY', 'HEALTHY', 'No recent safety latch events', diagnostics);
}

/** Derive OH-5 component status from data quality snapshot. */
export function classifyDataQualityComponent(snap: OhDataQualitySnapshot): OhOpsComponentStatus {
  return component(
    'OH5_DATA_QUALITY',
    snap.status,
    `Data quality ${snap.status.toLowerCase()}`,
    snap.diagnostics.slice(),
  );
}

/**
 * Pure overall classifier — never feeds Risk / Portfolio / Policy / Gate.
 */
export function classifyOverallStatus(components: OhOpsComponentStatus[]): {
  status: OhOpsReportStatus;
  severity: OhOpsSeverity;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  for (const c of components) {
    if (c.status !== 'HEALTHY') {
      diagnostics.push(`${c.id}:${c.status}`);
    }
  }
  let status: OhOpsReportStatus = 'HEALTHY';
  if (components.some((c) => c.status === 'UNAVAILABLE')) {
    status = 'UNAVAILABLE';
  } else if (components.some((c) => c.status === 'DEGRADED')) {
    status = 'DEGRADED';
  }
  return { status, severity: severityFromStatus(status), diagnostics };
}

/**
 * Human-readable operational guidance only — never automated trading actions.
 */
export function buildRecommendedActions(
  components: OhOpsComponentStatus[],
): OhOpsRecommendedAction[] {
  const actions: OhOpsRecommendedAction[] = [];
  for (const c of components) {
    if (c.status === 'HEALTHY') continue;
    if (c.id === 'OH2_EXECUTION' && c.status === 'UNAVAILABLE') {
      actions.push({
        action: 'Verify broker connectivity and execution path before LIVE operations.',
        componentId: c.id,
        severity: c.severity,
      });
    }
    if (c.id === 'OH3_RECONCILIATION') {
      actions.push({
        action: 'Review ledger ↔ holdings ↔ positions reconciliation issues manually.',
        componentId: c.id,
        severity: c.severity,
      });
    }
    if (c.id === 'OH5_DATA_QUALITY') {
      actions.push({
        action: 'Inspect market data freshness and source availability before trusting quotes.',
        componentId: c.id,
        severity: c.severity,
      });
    }
    if (c.id === 'OH4_SAFETY' && c.diagnostics.includes('KILL_SWITCH_TRIGGERED')) {
      actions.push({
        action:
          'Kill switch was triggered — confirm intentional disarm before re-enabling trading.',
        componentId: c.id,
        severity: 'WARN',
      });
    }
    if (c.id === 'OH1_PIPELINE' && c.status === 'DEGRADED') {
      actions.push({
        action: 'Check pipeline latency samples and recent decision-path errors.',
        componentId: c.id,
        severity: c.severity,
      });
    }
  }
  if (actions.length === 0 && components.every((c) => c.status === 'HEALTHY')) {
    actions.push({
      action: 'Operational components nominal — continue observe-only monitoring.',
      severity: 'INFO',
    });
  }
  return actions;
}

/** Compose OH-6 report from OH-1…OH-5 snapshots. */
export function buildOhOpsReport(input: OhOpsReportInput): OhOpsReportSnapshot {
  const componentStatuses: OhOpsComponentStatus[] = [];
  try {
    componentStatuses.push(classifyPipelineComponent(input.pipeline));
  } catch {
    componentStatuses.push(
      component('OH1_PIPELINE', 'DEGRADED', 'Pipeline telemetry error', ['classify failed']),
    );
  }
  try {
    componentStatuses.push(classifyExecutionComponent(input.execution));
  } catch {
    componentStatuses.push(
      component('OH2_EXECUTION', 'DEGRADED', 'Execution telemetry error', ['classify failed']),
    );
  }
  try {
    componentStatuses.push(classifyReconciliationComponent(input.reconciliation));
  } catch {
    componentStatuses.push(
      component('OH3_RECONCILIATION', 'DEGRADED', 'Reconciliation telemetry error', [
        'classify failed',
      ]),
    );
  }
  try {
    componentStatuses.push(classifySafetyComponent(input.safety));
  } catch {
    componentStatuses.push(
      component('OH4_SAFETY', 'DEGRADED', 'Safety telemetry error', ['classify failed']),
    );
  }
  try {
    componentStatuses.push(classifyDataQualityComponent(input.dataQuality));
  } catch {
    componentStatuses.push(
      component('OH5_DATA_QUALITY', 'DEGRADED', 'Data quality telemetry error', [
        'classify failed',
      ]),
    );
  }
  const classified = classifyOverallStatus(componentStatuses);
  return {
    schemaVersion: 'oh-ops-report.v1',
    generatedAt: input.now ?? Date.now(),
    observeOnly: true,
    overallStatus: classified.status,
    severity: classified.severity,
    componentStatuses,
    recommendedActions: buildRecommendedActions(componentStatuses),
    diagnostics: classified.diagnostics,
  };
}

/** Crown isolation helper — OH-6 presence must not change engine outputs. */
export function verifyOh6Isolation(input: {
  riskA: unknown;
  riskB: unknown;
  portfolioA: unknown;
  portfolioB: unknown;
  policyA: unknown;
  policyB: unknown;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (JSON.stringify(input.riskA) !== JSON.stringify(input.riskB)) {
    reasons.push('Risk outputs diverged with OH-6 ON vs OFF');
  }
  if (JSON.stringify(input.portfolioA) !== JSON.stringify(input.portfolioB)) {
    reasons.push('Portfolio outputs diverged with OH-6 ON vs OFF');
  }
  if (JSON.stringify(input.policyA) !== JSON.stringify(input.policyB)) {
    reasons.push('Policy outputs diverged with OH-6 ON vs OFF');
  }
  return { ok: reasons.length === 0, reasons };
}
