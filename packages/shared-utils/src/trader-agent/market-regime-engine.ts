/**
 * T1.1 Market Regime Engine — canonical TI regime (observe-only).
 *
 * Direction × volatility is the primary TI regime.
 * RISK_ON/OFF is derived only as evaluateTrade eligibility compatibility.
 */
import { MarketRegime } from '@stockpred/shared-types';
import type {
  TiDirectionRegime,
  TiRiskCompatibility,
  TiVolatilityRegime,
} from '@stockpred/shared-types';

export interface MarketRegimeEngineInput {
  scannerRegime: MarketRegime | string;
  vixLevel?: number | null;
  niftyChangePercent?: number | null;
  breadthPercentAboveEma50?: number | null;
  asOf?: string | number;
}

export interface MarketRegimeAssessment {
  directionRegime: TiDirectionRegime;
  volatilityRegime: TiVolatilityRegime;
  regimeCombo: string;
  riskCompatibility: TiRiskCompatibility;
  scannerRegime: string;
  asOf: string;
  vixLevel: number | null;
  niftyChangePercent: number | null;
  breadth: number | null;
}

const HIGH_VIX = 22;
const LOW_VIX = 13;

export function directionFromScannerRegime(scanner: string): TiDirectionRegime {
  const key = scanner.toUpperCase();
  if (key.includes('BULL')) return 'BULL';
  if (key.includes('BEAR')) return 'BEAR';
  return 'NEUTRAL';
}

export function volatilityFromVix(vixLevel: number | null | undefined): TiVolatilityRegime {
  if (vixLevel == null || !Number.isFinite(vixLevel)) return 'NORMAL_VOL';
  if (vixLevel >= HIGH_VIX) return 'HIGH_VOL';
  if (vixLevel <= LOW_VIX) return 'LOW_VOL';
  return 'NORMAL_VOL';
}

export function riskCompatibilityFrom(
  direction: TiDirectionRegime,
  vol: TiVolatilityRegime,
): TiRiskCompatibility {
  if (vol === 'HIGH_VOL') return 'RISK_OFF';
  if (direction === 'BEAR') return 'RISK_OFF';
  if (direction === 'BULL') return 'RISK_ON';
  return 'NEUTRAL';
}

export function assessMarketRegime(input: MarketRegimeEngineInput): MarketRegimeAssessment {
  const scannerRegime = String(input.scannerRegime ?? MarketRegime.NEUTRAL);
  const directionRegime = directionFromScannerRegime(scannerRegime);
  const volatilityRegime = volatilityFromVix(input.vixLevel);
  const riskCompatibility = riskCompatibilityFrom(directionRegime, volatilityRegime);
  const asOf =
    input.asOf == null
      ? new Date().toISOString()
      : typeof input.asOf === 'number'
        ? new Date(input.asOf).toISOString()
        : input.asOf;

  return {
    directionRegime,
    volatilityRegime,
    regimeCombo: `${directionRegime}+${volatilityRegime}`,
    riskCompatibility,
    scannerRegime,
    asOf,
    vixLevel: input.vixLevel ?? null,
    niftyChangePercent: input.niftyChangePercent ?? null,
    breadth: input.breadthPercentAboveEma50 ?? null,
  };
}

/** Map agent macro RISK_* labels onto scanner-like input when MDS context is absent. */
export function scannerRegimeFromRiskLabel(
  risk: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' | 'UNKNOWN' | string,
): MarketRegime {
  if (risk === 'RISK_ON') return MarketRegime.BULL;
  if (risk === 'RISK_OFF') return MarketRegime.BEAR;
  return MarketRegime.NEUTRAL;
}
