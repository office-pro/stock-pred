/**
 * T1.6 Market regime compatibility (observe-only).
 *
 * Keeps regime dimensions separate (trend / volatility / breadth / liquidity /
 * index structure / sector breadth). Compatibility is relative to setup style
 * + side (+ optional trade horizon). Soft conflicts are information — never
 * Risk / Portfolio / Policy / Gate inputs. UNFAVORABLE ≠ REJECT.
 */
import type {
  MarketRegimeDimensions,
  RegimeCompatibilityAssessment,
  RegimeCompatibilityConflict,
  RegimeDimensionNote,
  StrategyTag,
  TiBreadthRegime,
  TiDimensionStance,
  TiDirectionRegime,
  TiIndexStructure,
  TiLiquidityRegime,
  TiRegimeCompatibility,
  TiRegimeDimension,
  TiSectorTrend,
  TiTradeHorizon,
} from '@stockpred/shared-types';
import type { MarketRegimeAssessment } from './market-regime-engine';

export const REGIME_COMPAT_ENGINE_VERSION = 'regime-compatibility.v1';
export const REGIME_COMPAT_CALCULATION_VERSION = 'setup-aware-dimensions.v1';

export function breadthFromPercentAboveEma50(pct: number | null | undefined): TiBreadthRegime {
  if (pct == null || !Number.isFinite(pct)) return 'UNKNOWN';
  if (pct >= 60) return 'STRONG';
  if (pct >= 40) return 'NORMAL';
  return 'WEAK';
}

export function liquidityFromVix(vix: number | null | undefined): TiLiquidityRegime {
  if (vix == null || !Number.isFinite(vix)) return 'UNKNOWN';
  if (vix >= 25) return 'LOW';
  if (vix <= 14) return 'HIGH';
  return 'NORMAL';
}

export function indexStructureFrom(
  trend: TiDirectionRegime,
  niftyChangePercent?: number | null,
): TiIndexStructure {
  if (niftyChangePercent != null && Number.isFinite(niftyChangePercent)) {
    if (niftyChangePercent >= 0.4) return 'BULLISH';
    if (niftyChangePercent <= -0.4) return 'BEARISH';
  }
  if (trend === 'BULL') return 'BULLISH';
  if (trend === 'BEAR') return 'BEARISH';
  if (trend === 'NEUTRAL') return 'NEUTRAL';
  return 'UNKNOWN';
}

export function sectorBreadthFromTrend(sectorTrend?: TiSectorTrend | null): TiBreadthRegime {
  if (sectorTrend == null || sectorTrend === 'UNKNOWN') return 'UNKNOWN';
  if (sectorTrend === 'LEADING') return 'STRONG';
  if (sectorTrend === 'INLINE') return 'NORMAL';
  return 'WEAK';
}

export function buildMarketRegimeDimensions(input: {
  regime: MarketRegimeAssessment;
  sectorTrend?: TiSectorTrend | null;
  sourceDataTimestamp?: string;
}): MarketRegimeDimensions {
  const { regime } = input;
  return {
    trend: regime.directionRegime,
    volatility: regime.volatilityRegime,
    breadth: breadthFromPercentAboveEma50(regime.breadth),
    liquidity: liquidityFromVix(regime.vixLevel),
    indexStructure: indexStructureFrom(regime.directionRegime, regime.niftyChangePercent),
    sectorBreadth: sectorBreadthFromTrend(input.sectorTrend),
    asOf: regime.asOf,
    provenance: {
      engineVersion: REGIME_COMPAT_ENGINE_VERSION,
      calculationVersion: REGIME_COMPAT_CALCULATION_VERSION,
      sourceDataTimestamp: input.sourceDataTimestamp ?? regime.asOf,
      asOf: regime.asOf,
      inputs: {
        scannerRegime: regime.scannerRegime,
        vixLevel: regime.vixLevel,
        niftyChangePercent: regime.niftyChangePercent,
        breadth: regime.breadth,
        sectorTrend: input.sectorTrend ?? null,
      },
    },
  };
}

function dimNote(
  dimension: TiRegimeDimension,
  stance: TiDimensionStance,
  text: string,
): RegimeDimensionNote {
  return { dimension, stance, note: text };
}

function scoreStance(stance: TiDimensionStance): number {
  if (stance === 'SUPPORTIVE') return 1;
  if (stance === 'HOSTILE') return -1;
  return 0;
}

function compatibilityFromNet(net: number, known: number): TiRegimeCompatibility {
  if (known <= 0) return 'UNKNOWN';
  if (net >= 2) return 'FAVORABLE';
  if (net <= -2) return 'UNFAVORABLE';
  return 'NEUTRAL';
}

/** Strategy-aware dimension stances for a LONG thesis. */
function stancesForLong(
  setup: StrategyTag,
  dims: MarketRegimeDimensions,
  tradeHorizon?: TiTradeHorizon,
): RegimeDimensionNote[] {
  const notes: RegimeDimensionNote[] = [];
  const trendFollow =
    setup === 'BREAKOUT' ||
    setup === 'TREND_FOLLOWING' ||
    setup === 'MOMENTUM' ||
    setup === 'COMPOSITE' ||
    setup === 'UNKNOWN';
  const meanRev = setup === 'MEAN_REVERSION';
  const valueLike = setup === 'VALUE' || setup === 'EVENT_DRIVEN';

  // Trend always resolves from T1.1 (BULL/BEAR/NEUTRAL) — no UNKNOWN branch.
  if (trendFollow) {
    if (dims.trend === 'BULL') {
      notes.push(dimNote('TREND', 'SUPPORTIVE', 'Bull trend supports long directional setup'));
    } else if (dims.trend === 'BEAR') {
      notes.push(dimNote('TREND', 'HOSTILE', 'Bear trend opposes long directional setup'));
    } else {
      notes.push(dimNote('TREND', 'NEUTRAL', 'Neutral trend — limited directional tailwind'));
    }
  } else if (meanRev) {
    if (dims.trend === 'BEAR') {
      notes.push(
        dimNote('TREND', 'SUPPORTIVE', 'Bear/oversold context can favor mean-reversion longs'),
      );
    } else if (dims.trend === 'BULL') {
      notes.push(
        dimNote('TREND', 'NEUTRAL', 'Bull trend — mean-reversion long needs pullback confirmation'),
      );
    } else {
      notes.push(dimNote('TREND', 'NEUTRAL', 'Neutral trend for mean-reversion'));
    }
  } else if (valueLike) {
    if (dims.trend === 'BEAR') {
      notes.push(dimNote('TREND', 'HOSTILE', 'Bear trend pressures value/event longs'));
    } else if (dims.trend === 'BULL') {
      notes.push(dimNote('TREND', 'SUPPORTIVE', 'Bull trend supports value/event longs'));
    } else {
      notes.push(dimNote('TREND', 'NEUTRAL', 'Neutral trend for value/event'));
    }
  }

  // Volatility always resolves from T1.1 (HIGH/NORMAL/LOW) — no UNKNOWN branch.
  if (meanRev) {
    if (dims.volatility === 'HIGH_VOL') {
      notes.push(
        dimNote('VOLATILITY', 'SUPPORTIVE', 'High vol expands mean-reversion opportunity set'),
      );
    } else if (dims.volatility === 'LOW_VOL') {
      notes.push(dimNote('VOLATILITY', 'NEUTRAL', 'Low vol — mean-reversion ranges may be tight'));
    } else {
      notes.push(dimNote('VOLATILITY', 'NEUTRAL', 'Normal vol for mean-reversion'));
    }
  } else if (dims.volatility === 'HIGH_VOL') {
    const horizonNote =
      tradeHorizon === 'DAY_TRADE'
        ? 'High vol raises intraday noise / false breakouts'
        : 'High vol is hostile to breakout/trend continuation';
    notes.push(dimNote('VOLATILITY', 'HOSTILE', horizonNote));
  } else if (dims.volatility === 'LOW_VOL') {
    notes.push(
      dimNote('VOLATILITY', 'SUPPORTIVE', 'Low vol supportive for directional continuation'),
    );
  } else {
    notes.push(dimNote('VOLATILITY', 'NEUTRAL', 'Normal volatility'));
  }

  if (dims.breadth === 'UNKNOWN') {
    notes.push(dimNote('BREADTH', 'UNKNOWN', 'Market breadth unknown'));
  } else if (dims.breadth === 'STRONG') {
    notes.push(dimNote('BREADTH', 'SUPPORTIVE', 'Strong breadth supports risk-on longs'));
  } else if (dims.breadth === 'WEAK') {
    notes.push(dimNote('BREADTH', 'HOSTILE', 'Weak breadth — narrow leadership / fragile longs'));
  } else {
    notes.push(dimNote('BREADTH', 'NEUTRAL', 'Normal breadth'));
  }

  if (dims.liquidity === 'UNKNOWN') {
    notes.push(dimNote('LIQUIDITY', 'UNKNOWN', 'Liquidity regime unknown'));
  } else if (dims.liquidity === 'LOW') {
    notes.push(dimNote('LIQUIDITY', 'HOSTILE', 'Low liquidity — worse fills / gap risk'));
  } else if (dims.liquidity === 'HIGH') {
    notes.push(dimNote('LIQUIDITY', 'SUPPORTIVE', 'High liquidity supportive for execution'));
  } else {
    notes.push(dimNote('LIQUIDITY', 'NEUTRAL', 'Normal liquidity'));
  }

  if (dims.indexStructure === 'UNKNOWN') {
    notes.push(dimNote('INDEX_STRUCTURE', 'UNKNOWN', 'Index structure unknown'));
  } else if (dims.indexStructure === 'BULLISH') {
    notes.push(dimNote('INDEX_STRUCTURE', 'SUPPORTIVE', 'Bullish index structure'));
  } else if (dims.indexStructure === 'BEARISH') {
    notes.push(dimNote('INDEX_STRUCTURE', 'HOSTILE', 'Bearish index structure vs long thesis'));
  } else {
    notes.push(dimNote('INDEX_STRUCTURE', 'NEUTRAL', 'Neutral index structure'));
  }

  if (dims.sectorBreadth === 'UNKNOWN') {
    notes.push(dimNote('SECTOR_BREADTH', 'UNKNOWN', 'Sector breadth unknown'));
  } else if (dims.sectorBreadth === 'STRONG') {
    notes.push(dimNote('SECTOR_BREADTH', 'SUPPORTIVE', 'Sector participation strong'));
  } else if (dims.sectorBreadth === 'WEAK') {
    notes.push(dimNote('SECTOR_BREADTH', 'HOSTILE', 'Sector breadth weak vs long thesis'));
  } else {
    notes.push(dimNote('SECTOR_BREADTH', 'NEUTRAL', 'Sector breadth normal'));
  }

  return notes;
}

function flipForShort(notes: RegimeDimensionNote[]): RegimeDimensionNote[] {
  return notes.map((n) => {
    if (n.dimension === 'VOLATILITY' || n.dimension === 'LIQUIDITY') return n;
    if (n.stance === 'SUPPORTIVE') {
      return { ...n, stance: 'HOSTILE' as const, note: `${n.note} (inverted for SHORT)` };
    }
    if (n.stance === 'HOSTILE') {
      return { ...n, stance: 'SUPPORTIVE' as const, note: `${n.note} (inverted for SHORT)` };
    }
    return n;
  });
}

function conflictsFromNotes(
  notes: RegimeDimensionNote[],
  compatibility: TiRegimeCompatibility,
): RegimeCompatibilityConflict[] {
  const conflicts: RegimeCompatibilityConflict[] = [];
  for (const n of notes) {
    if (n.stance !== 'HOSTILE') continue;
    if (n.dimension === 'VOLATILITY') {
      conflicts.push({ code: 'HIGH_VOLATILITY', message: n.note, dimension: n.dimension });
    } else if (n.dimension === 'BREADTH') {
      conflicts.push({ code: 'WEAK_BREADTH', message: n.note, dimension: n.dimension });
    } else if (n.dimension === 'TREND' || n.dimension === 'INDEX_STRUCTURE') {
      conflicts.push({ code: 'REGIME_CONFLICT', message: n.note, dimension: n.dimension });
    } else if (n.dimension === 'LIQUIDITY') {
      conflicts.push({ code: 'LOW_LIQUIDITY', message: n.note, dimension: n.dimension });
    } else if (n.dimension === 'SECTOR_BREADTH') {
      conflicts.push({ code: 'WEAK_SECTOR_BREADTH', message: n.note, dimension: n.dimension });
    }
  }
  if (compatibility === 'UNFAVORABLE') {
    conflicts.push({
      code: 'REGIME_UNFAVORABLE',
      message: 'Setup ↔ market regime compatibility is UNFAVORABLE (advisory — not a reject)',
    });
  }
  return conflicts;
}

export interface AssessRegimeCompatibilityInput {
  setupStyle: StrategyTag;
  intendedSide?: 'LONG' | 'SHORT';
  tradeHorizon?: TiTradeHorizon;
  dimensions: MarketRegimeDimensions;
  sourceDataTimestamp?: string;
  asOf?: string;
}

export function assessRegimeCompatibility(
  input: AssessRegimeCompatibilityInput,
): RegimeCompatibilityAssessment {
  const intendedSide = input.intendedSide ?? 'LONG';
  const asOf = input.asOf ?? input.dimensions.asOf ?? new Date().toISOString();
  let dimensionNotes = stancesForLong(input.setupStyle, input.dimensions, input.tradeHorizon);
  if (intendedSide === 'SHORT') dimensionNotes = flipForShort(dimensionNotes);

  const known = dimensionNotes.filter((n) => n.stance !== 'UNKNOWN');
  const net = known.reduce((acc, n) => acc + scoreStance(n.stance), 0);
  const compatibility = compatibilityFromNet(net, known.length);
  const conflicts = conflictsFromNotes(dimensionNotes, compatibility);

  return {
    setupStyle: input.setupStyle,
    tradeHorizon: input.tradeHorizon,
    intendedSide,
    dimensions: input.dimensions,
    compatibility,
    dimensionNotes,
    conflicts,
    provenance: {
      engineVersion: REGIME_COMPAT_ENGINE_VERSION,
      calculationVersion: REGIME_COMPAT_CALCULATION_VERSION,
      sourceDataTimestamp: input.sourceDataTimestamp ?? asOf,
      asOf,
      inputs: {
        setupStyle: input.setupStyle,
        intendedSide,
        tradeHorizon: input.tradeHorizon ?? null,
        trend: input.dimensions.trend,
        volatility: input.dimensions.volatility,
        breadth: input.dimensions.breadth,
        liquidity: input.dimensions.liquidity,
        indexStructure: input.dimensions.indexStructure,
        sectorBreadth: input.dimensions.sectorBreadth,
        netStance: net,
        knownDimensions: known.length,
      },
    },
  };
}
