/**
 * OH-1 / OH-3 hard gates — observe-only; never touch Risk / Portfolio / Policy / Gate.
 */

import {
  OhPipelineMetricsCollector,
  buildOhReconciliationReport,
  ohStage,
  timeSync,
} from './index';

describe('P5 Operational Hardening (OH-1 / OH-3)', () => {
  it('OH-1 records stage timings and snapshot stats', () => {
    const collector = new OhPipelineMetricsCollector(100);
    const { ms } = timeSync(() => 1 + 1);
    collector.record({
      sampleId: 's1',
      recordedAt: Date.now(),
      kind: 'PIPELINE',
      symbol: 'TCS',
      stages: [ohStage('evaluateTrade', ms), ohStage('pipelineTotal', ms + 5)],
      totalMs: ms + 5,
      quoteAgeMs: 1200,
      ok: true,
    });
    const snap = collector.snapshot();
    expect(snap.schemaVersion).toBe('oh-pipeline-metrics.v1');
    expect(snap.sampleCount).toBe(1);
    expect(snap.lastQuoteAgeMs).toBe(1200);
    expect(snap.stages.find((s) => s.stage === 'evaluateTrade')?.count).toBe(1);
  });

  it('OH-3 flags ledger executed without holding (CRITICAL)', () => {
    const report = buildOhReconciliationReport({
      ledger: [
        {
          decisionId: 'd1',
          symbol: 'INFY',
          decision: 'APPROVED',
          timestamp: Date.now(),
          executionOrderId: 'ord-1',
          executionQty: 10,
          executionStatus: 'EXECUTED',
        },
      ],
      holdings: [],
      positions: [],
    });
    expect(report.observeOnly).toBe(true);
    expect(report.summary.criticalCount).toBeGreaterThanOrEqual(1);
    expect(report.issues.some((i) => i.code === 'LEDGER_EXECUTED_NO_HOLDING')).toBe(true);
  });

  it('OH-3 flags holding without ledger (CRITICAL)', () => {
    const report = buildOhReconciliationReport({
      ledger: [],
      holdings: [{ symbol: 'RELIANCE', quantity: 5 }],
    });
    expect(report.issues.some((i) => i.code === 'HOLDING_NO_LEDGER')).toBe(true);
  });

  it('OH-3 clean match produces no issues', () => {
    const report = buildOhReconciliationReport({
      ledger: [
        {
          decisionId: 'd2',
          symbol: 'TCS',
          decision: 'AUTO_ACCEPTED',
          timestamp: Date.now(),
          executionOrderId: 'o2',
          executionQty: 3,
          executionStatus: 'EXECUTED',
        },
      ],
      holdings: [{ symbol: 'TCS', quantity: 3, orderId: 'o2', decisionId: 'd2' }],
    });
    expect(report.summary.issueCount).toBe(0);
  });
});
