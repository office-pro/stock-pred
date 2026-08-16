import type { BullRunSnapshot, ScannerAlertGates } from '@stockpred/shared-types';
import { DEFAULT_SCANNER_ALERT_GATES } from '@stockpred/shared-types';
import { getEnvNumber } from './env';

export function scannerAlertGates(): ScannerAlertGates {
  return {
    minBullScore: getEnvNumber(
      'SCANNER_ALERT_MIN_BULL_SCORE',
      DEFAULT_SCANNER_ALERT_GATES.minBullScore,
    ),
    minUpProbability: getEnvNumber(
      'SCANNER_ALERT_MIN_UP_PROB',
      DEFAULT_SCANNER_ALERT_GATES.minUpProbability,
    ),
    minExpected20d: getEnvNumber(
      'SCANNER_ALERT_MIN_EXPECTED_20D',
      DEFAULT_SCANNER_ALERT_GATES.minExpected20d,
    ),
    minVolumeRatio: getEnvNumber(
      'SCANNER_ALERT_MIN_VOLUME_RATIO',
      DEFAULT_SCANNER_ALERT_GATES.minVolumeRatio,
    ),
    minForecastConfidence: getEnvNumber(
      'SCANNER_ALERT_MIN_CONFIDENCE',
      DEFAULT_SCANNER_ALERT_GATES.minForecastConfidence,
    ),
  };
}

export function isBullRunAlert(snapshot: BullRunSnapshot, gates = scannerAlertGates()): boolean {
  const fc = snapshot.forecast;
  if (!fc) return false;
  if (fc.confidence < gates.minForecastConfidence) return false;
  return (
    snapshot.bullScore >= gates.minBullScore &&
    fc.upProbability >= gates.minUpProbability &&
    fc.expectedReturn20d >= gates.minExpected20d &&
    snapshot.volume.volumeRatio >= gates.minVolumeRatio
  );
}

export function isBearReversalAlert(snapshot: BullRunSnapshot): boolean {
  return snapshot.bearScore >= 70 && snapshot.bullScore < 45;
}

export function scannerAlertCooldownMs(): number {
  return getEnvNumber('SCANNER_ALERT_COOLDOWN_HOURS', 4) * 60 * 60 * 1000;
}
