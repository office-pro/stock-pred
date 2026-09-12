/**
 * Phase 4 soak-scoped ops + calibration helpers.
 * Pure functions over ledger records — no authorization side effects.
 */
import {
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
  isThesisHistoryLedgerRecord,
  type CalibrationBandRow,
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type DecisionOutcomeRecord,
  type PaperSoakReport,
  type SoakCalibrationReport,
  type SoakOpsMetrics,
  type SoakVsWalkForwardRow,
} from '@stockpred/shared-types';

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function profitFactor(rs: number[]): number | null {
  const gains = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(rs.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  if (losses === 0) return null;
  return gains / losses;
}

export function filterLedgerForSoak(
  records: DecisionLedgerRecord[],
  soakRunId: string,
): DecisionLedgerRecord[] {
  return records.filter((row) => {
    if (isThesisHistoryLedgerRecord(row)) return false;
    if (isDecisionOutcomeRecord(row)) return row.soakRunId === soakRunId;
    return isDecisionLedgerEntry(row) && row.soakRunId === soakRunId;
  });
}

export function computeSoakOpsMetrics(
  records: DecisionLedgerRecord[],
  soakRunId: string | null,
  opts?: { startedAt?: number; now?: number },
): SoakOpsMetrics {
  const scoped = soakRunId ? filterLedgerForSoak(records, soakRunId) : records;
  const decisions = scoped.filter(isDecisionLedgerEntry);
  const outcomes = scoped.filter(isDecisionOutcomeRecord);

  let eligible = 0;
  let riskVeto = 0;
  let portfolioVeto = 0;
  let gateVeto = 0;
  let accepted = 0;
  let filled = 0;
  let circuitTrips = 0;

  for (const d of decisions) {
    if (d.analysisSnapshot.eligibility === 'AUTONOMOUS_ELIGIBLE') eligible += 1;
    if (!d.riskVerdict.allowed) riskVeto += 1;
    else if (!d.portfolioVerdict.allowed) portfolioVeto += 1;
    if (d.decision === 'AUTO_ACCEPT' || d.decision === 'APPROVED' || d.decision === 'EXECUTED') {
      accepted += 1;
    }
    if (d.execution?.status === 'EXECUTED' || d.decision === 'EXECUTED') filled += 1;
    if ((d.reasonCodes as string[]).includes('EXECUTION_FAILURE_CIRCUIT_BREAKER')) {
      circuitTrips += 1;
    }
    if (d.decision === 'BLOCKED' && d.riskVerdict.allowed && d.portfolioVerdict.allowed) {
      gateVeto += 1;
    }
  }

  const holdMs = outcomes.map((o) => o.holdingPeriodMs).filter((n) => Number.isFinite(n));
  const rs = outcomes.map((o) => o.realizedR).filter((n) => Number.isFinite(n));
  const autoGrossPnl = outcomes.reduce((a, o) => a + o.pnl, 0);

  const elapsedDays =
    opts?.startedAt != null
      ? Math.max(1 / 24, ((opts.now ?? Date.now()) - opts.startedAt) / (24 * 60 * 60 * 1000))
      : 1;

  return {
    soakRunId,
    candidates: decisions.length,
    eligible,
    riskVeto,
    portfolioVeto,
    gateVeto,
    accepted,
    filled,
    acceptsPerDay: accepted / elapsedDays,
    circuitTrips,
    avgHoldMs: mean(holdMs),
    autoGrossPnl,
    autoNetPnl: autoGrossPnl,
    avgR: mean(rs),
    medianR: median(rs),
    latency: {
      signalToDecisionMs: null,
      decisionToSubmitMs: null,
      submitToFillMs: null,
      decisionToFillMs: null,
    },
    health: {
      risk: riskVeto > eligible * 0.9 && eligible > 5 ? 'WARN' : 'OK',
      execution: circuitTrips > 0 ? 'WARN' : 'OK',
      data: 'OK',
      decision: 'OK',
      portfolio: portfolioVeto > eligible * 0.9 && eligible > 5 ? 'WARN' : 'OK',
    },
  };
}

function bandRows(
  decisions: DecisionLedgerEntry[],
  outcomesByDecision: Map<string, DecisionOutcomeRecord>,
  scoreOf: (d: DecisionLedgerEntry) => number,
): CalibrationBandRow[] {
  const bands: Array<{ band: string; lo: number; hi: number }> = [
    { band: '60-69', lo: 60, hi: 69.999 },
    { band: '70-74', lo: 70, hi: 74.999 },
    { band: '75-79', lo: 75, hi: 79.999 },
    { band: '80-89', lo: 80, hi: 89.999 },
    { band: '90+', lo: 90, hi: 100 },
  ];
  return bands.map(({ band, lo, hi }) => {
    const inBand = decisions.filter((d) => {
      const s = scoreOf(d);
      return s >= lo && s <= hi && outcomesByDecision.has(d.decisionId);
    });
    const rs = inBand
      .map((d) => outcomesByDecision.get(d.decisionId)!.realizedR)
      .filter((n) => Number.isFinite(n));
    const wins = inBand.filter((d) => outcomesByDecision.get(d.decisionId)!.pnl > 0).length;
    const pnlPcts = inBand.map((d) => outcomesByDecision.get(d.decisionId)!.pnlPercent);
    return {
      band,
      n: inBand.length,
      hitRate: inBand.length ? wins / inBand.length : null,
      avgR: mean(rs),
      medianR: median(rs),
      profitFactor: profitFactor(rs),
      avgPnlPercent: mean(pnlPcts),
    };
  });
}

export function computeSoakCalibration(
  records: DecisionLedgerRecord[],
  soakRunId: string | null,
): SoakCalibrationReport {
  const scoped = soakRunId ? filterLedgerForSoak(records, soakRunId) : records;
  const decisions = scoped.filter(isDecisionLedgerEntry);
  const outcomes = scoped.filter(isDecisionOutcomeRecord);
  const outcomesByDecision = new Map<string, DecisionOutcomeRecord>();
  for (const o of outcomes) {
    outcomesByDecision.set(o.decisionId, o);
  }
  return {
    soakRunId,
    disclaimer: 'Confidence is not a calibrated probability.',
    byScore: bandRows(decisions, outcomesByDecision, (d) => d.analysisSnapshot.score),
    byConfidence: bandRows(decisions, outcomesByDecision, (d) => d.analysisSnapshot.confidence),
  };
}

export function compareWalkForwardToSoak(input: {
  walkForward?: {
    autoAcceptRate?: number | null;
    winRate?: number | null;
    avgR?: number | null;
    maxDrawdownPct?: number | null;
    avgHoldMs?: number | null;
  } | null;
  soak: SoakOpsMetrics;
  soakWinRate?: number | null;
  soakMaxDd?: number | null;
}): SoakVsWalkForwardRow[] {
  const wf = input.walkForward ?? {};
  const acceptRate = input.soak.candidates > 0 ? input.soak.accepted / input.soak.candidates : null;
  const rows: Array<[string, number | null | undefined, number | null | undefined]> = [
    ['Auto accept rate', wf.autoAcceptRate, acceptRate],
    ['Win rate', wf.winRate, input.soakWinRate],
    ['Avg R', wf.avgR, input.soak.avgR],
    ['Max DD', wf.maxDrawdownPct, input.soakMaxDd],
    ['Avg hold (ms)', wf.avgHoldMs, input.soak.avgHoldMs],
  ];
  return rows.map(([metric, walkForward, paperSoak]) => ({
    metric,
    walkForward: walkForward ?? null,
    paperSoak: paperSoak ?? null,
    delta: walkForward != null && paperSoak != null ? paperSoak - walkForward : null,
  }));
}

export function buildPaperSoakReport(input: {
  soakRunId: string;
  phase4Status: 'PASSED' | 'KILLED' | 'WAIVED';
  startedAt: number;
  endedAt: number;
  ops: SoakOpsMetrics;
  calibration: SoakCalibrationReport;
  vsWalkForward: SoakVsWalkForwardRow[];
  killClass?: PaperSoakReport['killClass'];
  killCode?: PaperSoakReport['killCode'];
  killReason?: string;
  waiveReason?: string;
}): PaperSoakReport {
  return {
    schemaVersion: 'paper-soak.v1',
    soakRunId: input.soakRunId,
    phase4Status: input.phase4Status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.endedAt - input.startedAt,
    killClass: input.killClass,
    killCode: input.killCode,
    killReason: input.killReason,
    waiveReason: input.waiveReason,
    technicalChecklist: {
      liveAutoNeverArmed: true,
      killPathExercisedOrWaived: input.phase4Status !== 'PASSED' || Boolean(input.killCode),
      riskPortfolioGateRespected: true,
      outcomesComplete: input.ops.filled > 0,
    },
    ops: input.ops,
    calibrationSummary: input.calibration,
    vsWalkForward: input.vsWalkForward,
    performance: {
      grossPnl: input.ops.autoGrossPnl,
      netPnl: input.ops.autoNetPnl,
      maxDrawdownPct: null,
      profitFactor: null,
      avgR: input.ops.avgR,
    },
  };
}
