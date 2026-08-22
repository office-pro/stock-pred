import type { DecisionReasonCode } from '@stockpred/shared-types';

/**
 * Phase 7 — stop-only circuit breakers.
 * Breakers may force APPROVAL / block autonomous cycles.
 * Breakers must never imply AUTO_ACCEPTED or set liveAutoArmed.
 */

export type BreakerId =
  | 'daily_auto_count'
  | 'auto_pnl_drawdown'
  | 'veto_streak'
  | 'quote_stale'
  | 'broker_disconnect'
  | 'score_anomaly'
  | 'slippage_anomaly'
  | 'quality_drift'
  | 'ev_drift'
  | 'calibration_drift'
  | 'regime_drift'
  | 'execution_drift';

export interface BreakerConfig {
  /** Max AUTO_ACCEPTED decisions in the current UTC day. */
  maxDailyAutoAccepts: number;
  /** Max rolling autonomous P&L drawdown as fraction of equity (e.g. 0.03 = 3%). */
  maxAutoPnlDrawdownPct: number;
  /** Consecutive Risk/Portfolio vetoes before trip. */
  maxVetoStreak: number;
  /** Quote age above this (ms) trips stale-quote breaker. */
  maxQuoteAgeMs: number;
  /** |z-score| of decision score vs recent window. */
  maxScoreAbsZ: number;
  /** Absolute fill slippage in bps above this trips. */
  maxSlippageAbsBps: number;
  /** Quality band for drift check (e.g. only Quality >= 80). */
  qualityDriftMinScore: number;
  /** Historical Avg R must be >= this to consider a flip meaningful. */
  qualityDriftHistMinAvgR: number;
  /** Live Avg R at/below this after positive hist → trip. */
  qualityDriftLiveMaxAvgR: number;
  /** Absolute EV (R) deterioration hist − live above this trips. */
  maxEvDeteriorationR: number;
  /** Absolute calibration error drift above this trips. */
  maxCalibrationDrift: number;
  /** Regime mismatch rate (0–1) above this trips. */
  maxRegimeMismatchRate: number;
  /** Execution deterioration score (0–1) above this trips. */
  maxExecutionDeterioration: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  maxDailyAutoAccepts: 25,
  maxAutoPnlDrawdownPct: 0.03,
  maxVetoStreak: 8,
  maxQuoteAgeMs: 60_000,
  maxScoreAbsZ: 3.5,
  maxSlippageAbsBps: 40,
  qualityDriftMinScore: 80,
  qualityDriftHistMinAvgR: 0.4,
  qualityDriftLiveMaxAvgR: 0,
  maxEvDeteriorationR: 0.5,
  maxCalibrationDrift: 0.25,
  maxRegimeMismatchRate: 0.6,
  maxExecutionDeterioration: 0.5,
};

/** Runtime metrics snapshot fed into evaluateBreakers (caller-owned). */
export interface BreakerMetrics {
  dailyAutoAcceptCount: number;
  /** Peak-to-trough drawdown of autonomous P&L as fraction of equity (>= 0). */
  autoPnlDrawdownPct: number;
  consecutiveVetoCount: number;
  quoteAgeMs: number | null;
  brokerConnected: boolean;
  /** Decision score z-score vs recent window; null if insufficient samples. */
  scoreAbsZ: number | null;
  /** Absolute planned-vs-fill slippage in bps; null if no fill. */
  lastSlippageAbsBps: number | null;
  /** Intelligence drift inputs (null = skip that breaker). */
  qualityBandScore: number | null;
  qualityHistAvgR: number | null;
  qualityLiveAvgR: number | null;
  evHistAvgR: number | null;
  evLiveAvgR: number | null;
  calibrationDrift: number | null;
  regimeMismatchRate: number | null;
  executionDeterioration: number | null;
}

export interface BreakerTrip {
  breakerId: BreakerId;
  reasonCode: DecisionReasonCode;
  reason: string;
}

export interface BreakerEvaluation {
  /** True when any breaker tripped — caller must force APPROVAL / block auto. */
  tripped: boolean;
  trips: BreakerTrip[];
  reasonCodes: DecisionReasonCode[];
  reasons: string[];
}

function trip(breakerId: BreakerId, reasonCode: DecisionReasonCode, reason: string): BreakerTrip {
  return { breakerId, reasonCode, reason };
}

/**
 * Pure stop-only evaluation. Never returns authorization signals.
 * Does not read Policy/Risk/Gate and does not mutate arm state.
 */
export function evaluateBreakers(
  metrics: BreakerMetrics,
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): BreakerEvaluation {
  const trips: BreakerTrip[] = [];

  if (metrics.dailyAutoAcceptCount >= config.maxDailyAutoAccepts) {
    trips.push(
      trip(
        'daily_auto_count',
        'BREAKER_DAILY_AUTO_COUNT',
        `Daily AUTO accepts ${metrics.dailyAutoAcceptCount} >= ${config.maxDailyAutoAccepts}`,
      ),
    );
  }

  if (metrics.autoPnlDrawdownPct >= config.maxAutoPnlDrawdownPct) {
    trips.push(
      trip(
        'auto_pnl_drawdown',
        'BREAKER_AUTO_PNL_DRAWDOWN',
        `Autonomous P&L drawdown ${(metrics.autoPnlDrawdownPct * 100).toFixed(2)}% >= ${(config.maxAutoPnlDrawdownPct * 100).toFixed(2)}%`,
      ),
    );
  }

  if (metrics.consecutiveVetoCount >= config.maxVetoStreak) {
    trips.push(
      trip(
        'veto_streak',
        'BREAKER_VETO_STREAK',
        `Consecutive vetoes ${metrics.consecutiveVetoCount} >= ${config.maxVetoStreak}`,
      ),
    );
  }

  if (metrics.quoteAgeMs != null && metrics.quoteAgeMs > config.maxQuoteAgeMs) {
    trips.push(
      trip(
        'quote_stale',
        'BREAKER_QUOTE_STALE',
        `Quote age ${metrics.quoteAgeMs}ms > ${config.maxQuoteAgeMs}ms`,
      ),
    );
  }

  if (!metrics.brokerConnected) {
    trips.push(
      trip(
        'broker_disconnect',
        'BREAKER_BROKER_DISCONNECT',
        'Broker session disconnected or unhealthy',
      ),
    );
  }

  if (metrics.scoreAbsZ != null && metrics.scoreAbsZ >= config.maxScoreAbsZ) {
    trips.push(
      trip(
        'score_anomaly',
        'BREAKER_SCORE_ANOMALY',
        `Score |z|=${metrics.scoreAbsZ.toFixed(2)} >= ${config.maxScoreAbsZ}`,
      ),
    );
  }

  if (
    metrics.lastSlippageAbsBps != null &&
    metrics.lastSlippageAbsBps >= config.maxSlippageAbsBps
  ) {
    trips.push(
      trip(
        'slippage_anomaly',
        'BREAKER_SLIPPAGE_ANOMALY',
        `Fill slippage ${metrics.lastSlippageAbsBps}bps >= ${config.maxSlippageAbsBps}bps`,
      ),
    );
  }

  if (
    metrics.qualityBandScore != null &&
    metrics.qualityHistAvgR != null &&
    metrics.qualityLiveAvgR != null &&
    metrics.qualityBandScore >= config.qualityDriftMinScore &&
    metrics.qualityHistAvgR >= config.qualityDriftHistMinAvgR &&
    metrics.qualityLiveAvgR <= config.qualityDriftLiveMaxAvgR
  ) {
    trips.push(
      trip(
        'quality_drift',
        'BREAKER_QUALITY_DRIFT',
        `Quality>=${config.qualityDriftMinScore} hist AvgR ${metrics.qualityHistAvgR.toFixed(2)} → live ${metrics.qualityLiveAvgR.toFixed(2)}`,
      ),
    );
  }

  if (
    metrics.evHistAvgR != null &&
    metrics.evLiveAvgR != null &&
    metrics.evHistAvgR - metrics.evLiveAvgR >= config.maxEvDeteriorationR
  ) {
    trips.push(
      trip(
        'ev_drift',
        'BREAKER_EV_DRIFT',
        `EV deterioration ${(metrics.evHistAvgR - metrics.evLiveAvgR).toFixed(2)}R >= ${config.maxEvDeteriorationR}R`,
      ),
    );
  }

  if (
    metrics.calibrationDrift != null &&
    Math.abs(metrics.calibrationDrift) >= config.maxCalibrationDrift
  ) {
    trips.push(
      trip(
        'calibration_drift',
        'BREAKER_CALIBRATION_DRIFT',
        `Calibration drift ${metrics.calibrationDrift.toFixed(3)} >= ${config.maxCalibrationDrift}`,
      ),
    );
  }

  if (
    metrics.regimeMismatchRate != null &&
    metrics.regimeMismatchRate >= config.maxRegimeMismatchRate
  ) {
    trips.push(
      trip(
        'regime_drift',
        'BREAKER_REGIME_DRIFT',
        `Regime mismatch rate ${(metrics.regimeMismatchRate * 100).toFixed(0)}% >= ${(config.maxRegimeMismatchRate * 100).toFixed(0)}%`,
      ),
    );
  }

  if (
    metrics.executionDeterioration != null &&
    metrics.executionDeterioration >= config.maxExecutionDeterioration
  ) {
    trips.push(
      trip(
        'execution_drift',
        'BREAKER_EXECUTION_DRIFT',
        `Execution deterioration ${metrics.executionDeterioration.toFixed(2)} >= ${config.maxExecutionDeterioration}`,
      ),
    );
  }

  return {
    tripped: trips.length > 0,
    trips,
    reasonCodes: trips.map((t) => t.reasonCode),
    reasons: trips.map((t) => t.reason),
  };
}

/** Healthy baseline metrics (broker connected). Override fields in tests/callers. */
export function emptyBreakerMetrics(overrides: Partial<BreakerMetrics> = {}): BreakerMetrics {
  return {
    dailyAutoAcceptCount: 0,
    autoPnlDrawdownPct: 0,
    consecutiveVetoCount: 0,
    quoteAgeMs: 0,
    brokerConnected: true,
    scoreAbsZ: null,
    lastSlippageAbsBps: null,
    qualityBandScore: null,
    qualityHistAvgR: null,
    qualityLiveAvgR: null,
    evHistAvgR: null,
    evLiveAvgR: null,
    calibrationDrift: null,
    regimeMismatchRate: null,
    executionDeterioration: null,
    ...overrides,
  };
}
