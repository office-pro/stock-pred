/**
 * Phase 4 PAPER soak — operational validation + stop-only kills.
 * SoakController may force APPROVAL; it must never authorize a trade.
 */

export type SoakState = 'IDLE' | 'RUNNING' | 'PASSED' | 'KILLED' | 'WAIVED';

export type SoakKillClass = 'RISK' | 'EXECUTION' | 'DATA' | 'DECISION';

export type SoakKillCode =
  | 'SOAK_DAILY_DD'
  | 'SOAK_ROLLING_DD'
  | 'SOAK_AUTO_LOSS'
  | 'SOAK_EXEC_FAILURE_STREAK'
  | 'SOAK_BROKER_DISCONNECT'
  | 'SOAK_QUOTE_STALE'
  | 'SOAK_DATA_FAILURE'
  | 'SOAK_VETO_SPIKE'
  | 'SOAK_CONFIDENCE_ANOMALY';

export interface SoakKillThresholds {
  /** Kill if (dayStartEquity - equity) / dayStartEquity exceeds this (e.g. 0.03). */
  dailyDrawdownPct: number;
  /** Kill if (baselineEquity - equity) / baselineEquity exceeds this (e.g. 0.05). */
  soakDrawdownPct: number;
  /** Consecutive evaluation windows before veto-spike kill. */
  consecutiveVetoWindows: number;
  /** Veto rate (0–1) that counts as elevated within a window. */
  vetoSpikeRate: number;
  /** Exec failure streak (align with agent EXEC_FAIL circuit). */
  execFailStreak: number;
  /** Window length for consecutive checks (ms). */
  windowMs: number;
}

export const DEFAULT_SOAK_KILL_THRESHOLDS: SoakKillThresholds = {
  dailyDrawdownPct: 0.03,
  soakDrawdownPct: 0.05,
  consecutiveVetoWindows: 3,
  vetoSpikeRate: 0.85,
  execFailStreak: 3,
  windowMs: 60 * 60 * 1000,
};

export interface SoakBaselineSnapshot {
  equity: number;
  cash: number;
  openPositions: number;
  dayStartEquity: number;
  weekStartEquity: number;
}

export interface SoakConfigSnapshot {
  decisionMode: string;
  operatingMode: string;
  riskBudgets: Record<string, number>;
  killThresholds: SoakKillThresholds;
  targetDurationMs: number;
}

export interface SoakRun {
  soakRunId: string;
  state: SoakState;
  startedAt: number;
  endedAt?: number;
  targetDurationMs: number;
  baseline: SoakBaselineSnapshot;
  configSnapshot: SoakConfigSnapshot;
  killClass?: SoakKillClass;
  killCode?: SoakKillCode;
  killReason?: string;
  waiveReason?: string;
  consecutiveVetoWindows: number;
  consecutiveStaleWindows: number;
  consecutiveDataFailWindows: number;
}

export interface SoakHealthStrip {
  risk: 'OK' | 'WARN' | 'FAIL';
  execution: 'OK' | 'WARN' | 'FAIL';
  data: 'OK' | 'WARN' | 'FAIL';
  decision: 'OK' | 'WARN' | 'FAIL';
  portfolio: 'OK' | 'WARN' | 'FAIL';
}

export interface SoakOpsMetrics {
  soakRunId: string | null;
  candidates: number;
  eligible: number;
  riskVeto: number;
  portfolioVeto: number;
  gateVeto: number;
  accepted: number;
  filled: number;
  acceptsPerDay: number;
  circuitTrips: number;
  avgHoldMs: number | null;
  autoGrossPnl: number;
  autoNetPnl: number;
  avgR: number | null;
  medianR: number | null;
  latency: {
    signalToDecisionMs: number | null;
    decisionToSubmitMs: number | null;
    submitToFillMs: number | null;
    decisionToFillMs: number | null;
  };
  health: SoakHealthStrip;
}

export interface CalibrationBandRow {
  band: string;
  n: number;
  hitRate: number | null;
  avgR: number | null;
  medianR: number | null;
  profitFactor: number | null;
  avgPnlPercent: number | null;
}

export interface SoakCalibrationReport {
  soakRunId: string | null;
  disclaimer: string;
  byScore: CalibrationBandRow[];
  byConfidence: CalibrationBandRow[];
}

export interface SoakVsWalkForwardRow {
  metric: string;
  walkForward: number | null;
  paperSoak: number | null;
  delta: number | null;
}

export interface PaperSoakReport {
  schemaVersion: 'paper-soak.v1';
  soakRunId: string;
  phase4Status: 'PASSED' | 'KILLED' | 'WAIVED';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  killClass?: SoakKillClass;
  killCode?: SoakKillCode;
  killReason?: string;
  waiveReason?: string;
  technicalChecklist: {
    liveAutoNeverArmed: boolean;
    killPathExercisedOrWaived: boolean;
    riskPortfolioGateRespected: boolean;
    outcomesComplete: boolean;
  };
  ops: SoakOpsMetrics;
  calibrationSummary: SoakCalibrationReport;
  vsWalkForward: SoakVsWalkForwardRow[];
  performance: {
    grossPnl: number;
    netPnl: number;
    maxDrawdownPct: number | null;
    profitFactor: number | null;
    avgR: number | null;
  };
}
