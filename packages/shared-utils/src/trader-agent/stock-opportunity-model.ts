/**
 * T1.2 Stock Opportunity + T1.3 Expected-R (observe-only).
 *
 * Probability provenance is always explicit.
 * Expected-R method is GEOMETRIC_HEURISTIC_V1 (not a trained calibrated ML EV).
 */
import type {
  ExpectedValueSnapshot,
  HorizonPrediction,
  MLPredictionSnapshot,
  ProbabilitySource,
  StockOpportunityAssessment,
  TiDirectionRegime,
  TiRegimeFit,
} from '@stockpred/shared-types';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface DirectionProbabilities {
  pUp: number;
  pDown: number;
  pSideways: number;
  source: ProbabilitySource;
}

type MlLike = HorizonPrediction | MLPredictionSnapshot;

function readCalibrated(ml: MlLike): { UP?: number; DOWN?: number; SIDEWAYS?: number } | undefined {
  return ml.calibratedProbabilities;
}

function readRawProbs(ml: MlLike): { UP?: number; DOWN?: number; SIDEWAYS?: number } | undefined {
  return 'probabilities' in ml ? ml.probabilities : undefined;
}

/**
 * Prefer calibrated probs; else raw model probs; else heuristic from confidence+direction.
 * Never labels confidence-only paths as CALIBRATED.
 */
export function resolveDirectionProbabilities(
  ml: MlLike | null | undefined,
): DirectionProbabilities | null {
  if (!ml) return null;

  const calibrated = readCalibrated(ml);
  if (
    calibrated &&
    (calibrated.UP != null || calibrated.DOWN != null || calibrated.SIDEWAYS != null)
  ) {
    const pUp = clamp01(Number(calibrated.UP ?? 0));
    const pDown = clamp01(Number(calibrated.DOWN ?? 0));
    const pSideways = clamp01(Number(calibrated.SIDEWAYS ?? 0));
    const sum = pUp + pDown + pSideways;
    if (sum > 0) {
      return {
        pUp: round4(pUp / sum),
        pDown: round4(pDown / sum),
        pSideways: round4(pSideways / sum),
        source: 'CALIBRATED',
      };
    }
  }

  const raw = readRawProbs(ml);
  if (raw && (raw.UP != null || raw.DOWN != null || raw.SIDEWAYS != null)) {
    const pUp = clamp01(Number(raw.UP ?? 0));
    const pDown = clamp01(Number(raw.DOWN ?? 0));
    const pSideways = clamp01(Number(raw.SIDEWAYS ?? 0));
    const sum = pUp + pDown + pSideways;
    if (sum > 0) {
      return {
        pUp: round4(pUp / sum),
        pDown: round4(pDown / sum),
        pSideways: round4(pSideways / sum),
        source: 'RAW_MODEL',
      };
    }
  }

  const confidence =
    typeof ml.confidence === 'number' && Number.isFinite(ml.confidence)
      ? clamp01(ml.confidence > 1 ? ml.confidence / 100 : ml.confidence)
      : null;
  const direction = String(ml.direction ?? '').toUpperCase();
  if (confidence == null || !direction) return null;

  if (direction === 'UP' || direction === 'BUY') {
    return {
      pUp: round4(confidence),
      pDown: round4((1 - confidence) * 0.45),
      pSideways: round4((1 - confidence) * 0.55),
      source: 'HEURISTIC',
    };
  }
  if (direction === 'DOWN' || direction === 'SELL') {
    return {
      pDown: round4(confidence),
      pUp: round4((1 - confidence) * 0.45),
      pSideways: round4((1 - confidence) * 0.55),
      source: 'HEURISTIC',
    };
  }
  const sideways = round4(Math.max(confidence, 0.4));
  return {
    pSideways: sideways,
    pUp: round4((1 - sideways) / 2),
    pDown: round4((1 - sideways) / 2),
    source: 'HEURISTIC',
  };
}

export function regimeFitForLong(
  directionRegime: TiDirectionRegime | undefined,
  pUp: number,
): TiRegimeFit {
  if (directionRegime === 'BULL' && pUp >= 0.45) return 'HIGH';
  if (directionRegime === 'BEAR' && pUp >= 0.55) return 'MED';
  if (directionRegime === 'BEAR') return 'LOW';
  if (directionRegime === 'BULL') return 'MED';
  return pUp >= 0.5 ? 'MED' : 'LOW';
}

export function assessStockOpportunity(input: {
  ml?: MlLike | null;
  directionRegime?: TiDirectionRegime;
  holdingPeriodSessions?: number;
}): StockOpportunityAssessment | undefined {
  const probs = resolveDirectionProbabilities(input.ml);
  const hasPath =
    input.ml?.expectedReturn != null ||
    input.ml?.expectedMfe != null ||
    input.ml?.expectedMae != null;
  if (!probs && !hasPath) return undefined;

  const pUp = probs?.pUp ?? 0.34;
  return {
    pUp: probs?.pUp,
    pDown: probs?.pDown,
    pSideways: probs?.pSideways,
    expectedReturn: input.ml?.expectedReturn ?? null,
    expectedMfe: input.ml?.expectedMfe ?? null,
    expectedMae: input.ml?.expectedMae ?? null,
    regimeFit: regimeFitForLong(input.directionRegime, pUp),
    probabilitySource: probs?.source,
    holdingPeriodSessions: input.holdingPeriodSessions ?? 5,
  };
}

export interface GeometricExpectedRInput {
  rewardR?: number | null;
  riskR?: number | null;
  expectedMfe?: number | null;
  expectedMae?: number | null;
  pUp?: number;
  pDown?: number;
  probabilitySource?: ProbabilitySource;
  side?: 'LONG' | 'SHORT';
}

/**
 * GEOMETRIC_HEURISTIC_V1
 *
 * pHit + pStop <= 1; pNeither = 1 - pHit - pStop.
 * expectedValueR = pHit * rewardR - pStop * riskR (pNeither contributes 0).
 */
export function computeGeometricExpectedR(input: GeometricExpectedRInput): ExpectedValueSnapshot {
  const side = input.side ?? 'LONG';
  let rewardR =
    input.rewardR != null && Number.isFinite(input.rewardR) ? Number(input.rewardR) : null;
  let riskR = input.riskR != null && Number.isFinite(input.riskR) ? Number(input.riskR) : null;

  if (
    (rewardR == null || riskR == null) &&
    input.expectedMfe != null &&
    input.expectedMae != null
  ) {
    const mfe = Math.abs(Number(input.expectedMfe));
    const mae = Math.abs(Number(input.expectedMae));
    if (mae > 1e-9) {
      rewardR = rewardR ?? mfe / mae;
      riskR = riskR ?? 1;
    }
  }

  const pUp = clamp01(input.pUp ?? 0.34);
  const pDown = clamp01(input.pDown ?? 0.33);
  const favor = side === 'LONG' ? pUp : pDown;
  const against = side === 'LONG' ? pDown : pUp;

  const mfe = Math.abs(Number(input.expectedMfe ?? 0));
  const mae = Math.abs(Number(input.expectedMae ?? 0));
  const pathRatio = mfe + mae > 1e-9 ? mfe / (mfe + mae) : 0.5;

  const barrierMass = 0.85;
  let pHit = clamp01(favor * barrierMass * (0.55 + 0.45 * pathRatio));
  let pStop = clamp01(against * barrierMass * (0.55 + 0.45 * (1 - pathRatio)));
  const barrierSum = pHit + pStop;
  if (barrierSum > 1) {
    pHit = round4(pHit / barrierSum);
    pStop = round4(pStop / barrierSum);
  } else {
    pHit = round4(pHit);
    pStop = round4(pStop);
  }
  const pNeither = round4(Math.max(0, 1 - pHit - pStop));

  const rr = rewardR != null && Number.isFinite(rewardR) ? rewardR : undefined;
  const risk = riskR != null && Number.isFinite(riskR) ? riskR : rr != null ? 1 : undefined;
  const expectedValueR = rr != null && risk != null ? round4(pHit * rr - pStop * risk) : undefined;

  return {
    probabilityTarget: pHit,
    probabilityStop: pStop,
    probabilityNeither: pNeither,
    rewardR: rr,
    riskR: risk,
    expectedValueR,
    probTargetBeforeStop: pHit,
    probabilitySource: input.probabilitySource ?? 'HEURISTIC',
    expectedValueMethod: 'GEOMETRIC_HEURISTIC_V1',
  };
}
