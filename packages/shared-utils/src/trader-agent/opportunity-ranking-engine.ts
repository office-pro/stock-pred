/**
 * T1.8 Opportunity Ranking (observe-only shortlist).
 *
 * Lexicographic, context-specific comparison — never a RankingScore.
 * Soft PortfolioFit may break ties only; never veto/authorize/resize.
 * CLEAR dominance is scoped to RankingContext, not "objectively best".
 *
 * Never feeds Risk / Portfolio / Policy / Gate.
 */
import type {
  BatchSentiment,
  DecisionConflict,
  FundamentalPayload,
  IntelligenceMacroBlock,
  IntelligenceNewsBlock,
  IntelligenceOnchainBlock,
  IntelligenceSocialBlock,
  IntelligenceSnapshot,
  OpportunityRankingAssessment,
  OpportunityRankingResult,
  PairwiseRankingReason,
  RankingContext,
  RankingDimensionStrip,
  RankingEvidence,
  TiDataCompleteness,
  TiRankingBand,
  TiRankingDimension,
  TiRankingDominance,
  TiTradeHorizon,
} from '@stockpred/shared-types';

export const OPPORTUNITY_RANKING_ENGINE_VERSION = 'opportunity-ranking.v1';
export const OPPORTUNITY_RANKING_CALCULATION_VERSION = 'lexicographic-context-precedence.v4';

/** Soft freshness windows (ms) by horizon — older asOf → stale. */
const FRESHNESS_MS: Record<TiTradeHorizon, number> = {
  DAY_TRADE: 4 * 60 * 60_000,
  SWING_TRADE: 24 * 60 * 60_000,
  POSITION: 72 * 60 * 60_000,
};

const BAND_RANK: Record<TiRankingBand, number> = {
  HIGH: 3,
  MED: 2,
  LOW: 1,
  UNKNOWN: 0,
};

/** High-precedence head used for CLEAR vs CLOSE (context-scoped). */
const CLEAR_PREFIX = 4;

export interface OpportunityRankingCandidate {
  opportunityId: string;
  symbol: string;
  snapshot: IntelligenceSnapshot;
  /** Soft display/tie-break only — never veto/authorize. */
  portfolioFit?: 'EXCELLENT' | 'GOOD' | 'BLOCKED' | 'UNKNOWN';
}

export interface AssessOpportunityRankingInput {
  context: RankingContext;
  candidates: OpportunityRankingCandidate[];
}

function toMs(ts: string | number | undefined): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

function bandFromRs(bucket: string | undefined): TiRankingBand {
  if (bucket === 'LEADERS') return 'HIGH';
  if (bucket === 'MIDDLE') return 'MED';
  if (bucket === 'LAGGARDS') return 'LOW';
  return 'UNKNOWN';
}

function bandFromFit(fit: string | undefined): TiRankingBand {
  if (fit === 'HIGH' || fit === 'EXCELLENT' || fit === 'FAVORABLE') return 'HIGH';
  if (fit === 'MED' || fit === 'GOOD' || fit === 'NEUTRAL' || fit === 'INLINE') return 'MED';
  if (fit === 'LOW' || fit === 'BLOCKED' || fit === 'UNFAVORABLE' || fit === 'LAGGING')
    return 'LOW';
  return 'UNKNOWN';
}

function bandFromAgreement(level: string | undefined): TiRankingBand {
  if (level === 'HIGH') return 'HIGH';
  if (level === 'MED') return 'MED';
  if (level === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

/** Invert event risk: safer → higher band. */
function bandFromEventRisk(risk: string | undefined): TiRankingBand {
  if (risk === 'NONE' || risk === 'LOW') return risk === 'NONE' ? 'HIGH' : 'MED';
  if (risk === 'MED') return 'LOW';
  if (risk === 'HIGH') return 'LOW';
  return 'UNKNOWN';
}

function bandFromEv(ev: number | null | undefined): TiRankingBand {
  if (ev == null || !Number.isFinite(ev)) return 'UNKNOWN';
  if (ev >= 1.0) return 'HIGH';
  if (ev >= 0.5) return 'MED';
  if (ev >= 0) return 'LOW';
  return 'LOW';
}

function bandFromScore(score: number | null | undefined): TiRankingBand {
  if (score == null || !Number.isFinite(score)) return 'UNKNOWN';
  if (score >= 75) return 'HIGH';
  if (score >= 55) return 'MED';
  return 'LOW';
}

function bandFromLiquidity(liq: string | undefined): TiRankingBand {
  if (liq === 'HIGH') return 'HIGH';
  if (liq === 'NORMAL' || liq === 'MED') return 'MED';
  if (liq === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function sectorBand(snap: IntelligenceSnapshot): TiRankingBand {
  const fit = snap.sectorIntelligence?.sectorFit ?? snap.opportunity?.sectorIntelligence?.sectorFit;
  const trend =
    snap.sectorIntelligence?.sectorTrend ??
    snap.opportunity?.sectorIntelligence?.sectorTrend ??
    snap.marketContext?.sectorTrend;
  const fitBand = bandFromFit(fit);
  if (fitBand !== 'UNKNOWN') return fitBand;
  if (trend === 'LEADING') return 'HIGH';
  if (trend === 'INLINE') return 'MED';
  if (trend === 'LAGGING') return 'LOW';
  return 'UNKNOWN';
}

function isStale(snap: IntelligenceSnapshot, context: RankingContext): boolean {
  const asOf = toMs(snap.sourceDataTimestamp) ?? toMs(snap.generatedAt);
  const now = toMs(context.timestamp) ?? Date.now();
  if (asOf == null) return true;
  return now - asOf > FRESHNESS_MS[context.tradeHorizon];
}

function freshnessBand(snap: IntelligenceSnapshot, context: RankingContext): TiRankingBand {
  if (isStale(snap, context)) return 'LOW';
  const asOf = toMs(snap.sourceDataTimestamp) ?? toMs(snap.generatedAt);
  const now = toMs(context.timestamp) ?? Date.now();
  if (asOf == null) return 'UNKNOWN';
  const age = now - asOf;
  const window = FRESHNESS_MS[context.tradeHorizon];
  if (age <= window * 0.25) return 'HIGH';
  if (age <= window * 0.75) return 'MED';
  return 'LOW';
}

function portfolioFitBand(fit: OpportunityRankingCandidate['portfolioFit']): TiRankingBand {
  if (fit === 'EXCELLENT') return 'HIGH';
  if (fit === 'GOOD') return 'MED';
  if (fit === 'BLOCKED') return 'LOW';
  return 'UNKNOWN';
}

const C_EVIDENCE_TAIL: TiRankingDimension[] = [
  'FUNDAMENTAL',
  'NEWS',
  'SENTIMENT',
  'MACRO',
  'ONCHAIN',
  'SOCIAL',
];

function withCEvidenceBeforePortfolioFit(core: TiRankingDimension[]): TiRankingDimension[] {
  const withoutFit = core.filter((d) => d !== 'PORTFOLIO_FIT');
  return [...withoutFit, ...C_EVIDENCE_TAIL, 'PORTFOLIO_FIT'];
}

/** Phase C fundamental payload only — never AgentAnalysis / tradeQuality numeric scores. */
function bandFromFundamental(payload: FundamentalPayload | undefined): TiRankingBand {
  if (!payload || payload.kind === 'UNAVAILABLE') return 'UNKNOWN';
  if (payload.kind === 'EQUITY_STATEMENTS') {
    if (payload.roe != null && Number.isFinite(payload.roe)) {
      if (payload.roe >= 15) return 'HIGH';
      if (payload.roe >= 5) return 'MED';
      return 'LOW';
    }
    if (payload.netIncome != null && Number.isFinite(payload.netIncome)) {
      if (payload.netIncome > 0) return 'HIGH';
      if (payload.netIncome === 0) return 'MED';
      return 'LOW';
    }
    if (payload.revenue != null && Number.isFinite(payload.revenue)) return 'MED';
    return 'UNKNOWN';
  }
  if (payload.kind === 'COMMODITY_ECONOMICS') {
    const demand = payload.demand;
    const supply = payload.supply;
    if (demand != null && supply != null && Number.isFinite(demand) && Number.isFinite(supply)) {
      if (demand > supply) return 'HIGH';
      if (demand < supply) return 'LOW';
      return 'MED';
    }
    if (
      (payload.inventory != null && Number.isFinite(payload.inventory)) ||
      (supply != null && Number.isFinite(supply)) ||
      (demand != null && Number.isFinite(demand))
    ) {
      return 'MED';
    }
    return 'UNKNOWN';
  }
  // NETWORK_PROJECT has no rankable fields — do not invent MED/NEUTRAL.
  return 'UNKNOWN';
}

function bandFromNews(news: IntelligenceNewsBlock | undefined): TiRankingBand {
  if (!news) return 'UNKNOWN';
  if (news.headlineCount == null || !Number.isFinite(news.headlineCount)) return 'UNKNOWN';
  if (news.headlineCount >= 3) return 'HIGH';
  if (news.headlineCount >= 1) return 'MED';
  return 'LOW';
}

function bandFromCSentiment(sentiment: BatchSentiment | undefined): TiRankingBand {
  if (sentiment == null) return 'UNKNOWN';
  if (sentiment.source !== 'MODEL_DERIVED') return 'UNKNOWN';
  if (typeof sentiment.score !== 'number' || !Number.isFinite(sentiment.score)) return 'UNKNOWN';
  if (sentiment.score >= 0.2) return 'HIGH';
  if (sentiment.score <= -0.2) return 'LOW';
  return 'MED';
}

function bandFromMacro(macro: IntelligenceMacroBlock | undefined): TiRankingBand {
  if (!macro) return 'UNKNOWN';
  if (!macro.seriesId && macro.asOf == null) return 'UNKNOWN';
  return 'HIGH';
}

function bandFromOnchain(block: IntelligenceOnchainBlock | undefined): TiRankingBand {
  if (!block || block.status === 'UNAVAILABLE') return 'UNKNOWN';
  if (block.tvlUsd != null && Number.isFinite(block.tvlUsd) && block.tvlUsd > 0) return 'MED';
  if (block.status === 'PARTIAL' || block.status === 'AVAILABLE') return 'MED';
  return 'UNKNOWN';
}

function bandFromSocial(block: IntelligenceSocialBlock | undefined): TiRankingBand {
  if (!block || block.status === 'UNAVAILABLE') return 'UNKNOWN';
  // Presence only — mentionCount never becomes HIGH / automatic BUY.
  if (block.status === 'PARTIAL' || block.status === 'AVAILABLE') return 'MED';
  return 'UNKNOWN';
}

export function dimensionPrecedenceForContext(horizon: TiTradeHorizon): TiRankingDimension[] {
  // PORTFOLIO_FIT is always last — tie-break only.
  // C evidence sits immediately before it so T1.8 head (CLEAR_PREFIX) is unchanged.
  if (horizon === 'DAY_TRADE') {
    return withCEvidenceBeforePortfolioFit([
      'LIQUIDITY',
      'FRESHNESS',
      'MTF',
      'EV',
      'RS',
      'REGIME',
      'EVENT_RISK',
      'TECHNICAL',
      'SECTOR',
      'PORTFOLIO_FIT',
    ]);
  }
  // SWING_TRADE and POSITION share swing-style precedence.
  return withCEvidenceBeforePortfolioFit([
    'RS',
    'SECTOR',
    'REGIME',
    'EV',
    'MTF',
    'EVENT_RISK',
    'TECHNICAL',
    'LIQUIDITY',
    'FRESHNESS',
    'PORTFOLIO_FIT',
  ]);
}

function stripFromCandidate(
  c: OpportunityRankingCandidate,
  context: RankingContext,
): RankingDimensionStrip {
  const snap = c.snapshot;
  const rs = snap.crossSectionalRs?.rsBucket ?? snap.opportunity?.crossSectionalRs?.rsBucket;
  const agreement =
    snap.multiHorizonAgreement?.agreement ?? snap.opportunity?.multiHorizonAgreement?.agreement;
  const regime =
    snap.regimeCompatibility?.compatibility ?? snap.opportunity?.regimeCompatibility?.compatibility;
  const eventRisk = snap.catalystContext?.eventRisk ?? snap.opportunity?.catalystContext?.eventRisk;
  const ev = snap.expectedValue?.expectedValueR ?? snap.tradeQuality?.expectedValueR;
  const technical = snap.tradeQuality?.overallScore ?? snap.tradeQuality?.technical;
  const liquidity =
    snap.regimeCompatibility?.dimensions?.liquidity ?? snap.marketContext?.liquidity;

  return {
    ev: bandFromEv(ev),
    rs: bandFromRs(rs),
    sector: sectorBand(snap),
    mtf: bandFromAgreement(agreement),
    regime: bandFromFit(regime),
    eventSafety: bandFromEventRisk(eventRisk),
    technical: bandFromScore(technical),
    liquidity: bandFromLiquidity(typeof liquidity === 'string' ? liquidity : undefined),
    freshness: freshnessBand(snap, context),
    fundamental: bandFromFundamental(snap.fundamental),
    news: bandFromNews(snap.news),
    sentiment: bandFromCSentiment(snap.sentiment),
    macro: bandFromMacro(snap.macro),
    onchain: bandFromOnchain(snap.onchain),
    social: bandFromSocial(snap.social),
    portfolioFit: portfolioFitBand(c.portfolioFit),
    expectedValueR: ev ?? null,
  };
}

function bandOf(strip: RankingDimensionStrip, dim: TiRankingDimension): TiRankingBand {
  switch (dim) {
    case 'EV':
      return strip.ev;
    case 'RS':
      return strip.rs;
    case 'SECTOR':
      return strip.sector;
    case 'MTF':
      return strip.mtf;
    case 'REGIME':
      return strip.regime;
    case 'EVENT_RISK':
      return strip.eventSafety;
    case 'TECHNICAL':
      return strip.technical;
    case 'LIQUIDITY':
      return strip.liquidity;
    case 'FRESHNESS':
      return strip.freshness;
    case 'FUNDAMENTAL':
      return strip.fundamental;
    case 'NEWS':
      return strip.news;
    case 'SENTIMENT':
      return strip.sentiment;
    case 'MACRO':
      return strip.macro;
    case 'ONCHAIN':
      return strip.onchain;
    case 'SOCIAL':
      return strip.social;
    case 'PORTFOLIO_FIT':
      return strip.portfolioFit;
    default:
      return 'UNKNOWN';
  }
}

function compareStrips(
  a: RankingDimensionStrip,
  b: RankingDimensionStrip,
  precedence: TiRankingDimension[],
  symbolA: string,
  symbolB: string,
): number {
  for (const dim of precedence) {
    const da = BAND_RANK[bandOf(a, dim)];
    const db = BAND_RANK[bandOf(b, dim)];
    if (da !== db) return db - da; // higher band first
  }
  return symbolA.localeCompare(symbolB);
}

function unknownDimensions(
  strip: RankingDimensionStrip,
  snap: IntelligenceSnapshot,
): TiRankingDimension[] {
  const dims: TiRankingDimension[] = [
    'EV',
    'RS',
    'SECTOR',
    'MTF',
    'REGIME',
    'EVENT_RISK',
    'TECHNICAL',
    'LIQUIDITY',
    'FRESHNESS',
    'FUNDAMENTAL',
    'NEWS',
    'SENTIMENT',
    'MACRO',
  ];
  // Equities omit snap.onchain (N/A) — do not mark DATA_INCOMPLETE via ONCHAIN.
  if (snap.onchain) dims.push('ONCHAIN');
  if (snap.social) dims.push('SOCIAL');
  return dims.filter((d) => bandOf(strip, d) === 'UNKNOWN');
}

function completenessOf(unknown: TiRankingDimension[]): TiDataCompleteness {
  if (unknown.length === 0) return 'COMPLETE';
  if (unknown.length >= 4) return 'DATA_INCOMPLETE';
  return 'PARTIAL';
}

function strengthsWeaknesses(
  strip: RankingDimensionStrip,
  stale: boolean,
  unknown: TiRankingDimension[],
): { strengths: RankingEvidence[]; weaknesses: RankingEvidence[] } {
  const strengths: RankingEvidence[] = [];
  const weaknesses: RankingEvidence[] = [];
  const push = (
    list: RankingEvidence[],
    code: string,
    message: string,
    dimension: TiRankingDimension,
    polarity: 'STRENGTH' | 'WEAKNESS',
  ) => list.push({ code, message, dimension, polarity });

  if (strip.rs === 'HIGH')
    push(strengths, 'RS_LEADER', 'Relative strength LEADERS', 'RS', 'STRENGTH');
  if (strip.rs === 'LOW')
    push(weaknesses, 'RS_LAGGARD', 'Relative strength LAGGARDS', 'RS', 'WEAKNESS');
  if (strip.sector === 'HIGH')
    push(strengths, 'SECTOR_STRONG', 'Sector fit / trend supportive', 'SECTOR', 'STRENGTH');
  if (strip.sector === 'LOW')
    push(weaknesses, 'SECTOR_WEAK', 'Sector fit / trend weak', 'SECTOR', 'WEAKNESS');
  if (strip.mtf === 'HIGH')
    push(strengths, 'MTF_HIGH', 'Multi-horizon agreement HIGH', 'MTF', 'STRENGTH');
  if (strip.mtf === 'LOW')
    push(weaknesses, 'MTF_LOW', 'Multi-horizon agreement LOW', 'MTF', 'WEAKNESS');
  if (strip.regime === 'HIGH')
    push(strengths, 'REGIME_FAVORABLE', 'Regime compatibility FAVORABLE', 'REGIME', 'STRENGTH');
  if (strip.regime === 'LOW')
    push(
      weaknesses,
      'REGIME_UNFAVORABLE',
      'Regime compatibility UNFAVORABLE',
      'REGIME',
      'WEAKNESS',
    );
  if (strip.eventSafety === 'LOW')
    push(
      weaknesses,
      'EVENT_RISK_ELEVATED',
      'Elevated event risk near decision',
      'EVENT_RISK',
      'WEAKNESS',
    );
  if (strip.ev === 'HIGH')
    push(
      strengths,
      'EV_HIGH',
      `Expected value band HIGH (${strip.expectedValueR ?? '?'}R)`,
      'EV',
      'STRENGTH',
    );
  if (strip.fundamental === 'HIGH')
    push(
      strengths,
      'FUNDAMENTAL_STRONG',
      'Phase C fundamental band HIGH',
      'FUNDAMENTAL',
      'STRENGTH',
    );
  if (strip.news === 'HIGH')
    push(strengths, 'NEWS_COVERAGE', 'Phase C news coverage HIGH', 'NEWS', 'STRENGTH');
  if (strip.sentiment === 'HIGH')
    push(
      strengths,
      'SENTIMENT_POSITIVE',
      'Phase C MODEL_DERIVED sentiment HIGH',
      'SENTIMENT',
      'STRENGTH',
    );
  if (strip.macro === 'HIGH')
    push(strengths, 'MACRO_CONTEXT', 'Batch-level macro context present', 'MACRO', 'STRENGTH');
  if (strip.onchain === 'MED')
    push(
      strengths,
      'ONCHAIN_TVL_PRESENT',
      'On-chain TVL present (observe-only, not a BUY/SELL)',
      'ONCHAIN',
      'STRENGTH',
    );
  if (strip.social === 'MED')
    push(
      strengths,
      'SOCIAL_PRESENT',
      'Reddit/social evidence present (observe-only, not a volume BUY/SELL)',
      'SOCIAL',
      'STRENGTH',
    );
  if (stale)
    push(
      weaknesses,
      'STALE_INTELLIGENCE',
      'Intelligence asOf outside freshness window',
      'FRESHNESS',
      'WEAKNESS',
    );
  for (const d of unknown) {
    push(
      weaknesses,
      'DATA_INCOMPLETE',
      `Dimension ${d} unknown — not treated as neutral`,
      d,
      'WEAKNESS',
    );
  }
  return { strengths, weaknesses };
}

function softConflictsFromSnapshot(snap: IntelligenceSnapshot): DecisionConflict[] {
  return (snap.conflicts ?? []).filter((c) => c.severity !== 'BLOCK');
}

function pairwiseDiff(
  winner: RankingDimensionStrip,
  loser: RankingDimensionStrip,
  precedence: TiRankingDimension[],
): RankingEvidence[] {
  const evidence: RankingEvidence[] = [];
  for (const dim of precedence) {
    if (dim === 'PORTFOLIO_FIT') continue; // soft — mention only if sole separator
    const wa = BAND_RANK[bandOf(winner, dim)];
    const lb = BAND_RANK[bandOf(loser, dim)];
    if (wa > lb) {
      evidence.push({
        code: `${dim}_ADVANTAGE`,
        message: `Stronger ${dim} (${bandOf(winner, dim)} vs ${bandOf(loser, dim)})`,
        dimension: dim,
        polarity: 'STRENGTH',
      });
    }
  }
  // If only portfolio fit separates, say so explicitly as soft tie-break.
  if (evidence.length === 0) {
    const wa = BAND_RANK[winner.portfolioFit];
    const lb = BAND_RANK[loser.portfolioFit];
    if (wa > lb) {
      evidence.push({
        code: 'PORTFOLIO_FIT_TIEBREAK',
        message: 'Soft portfolio-fit tie-break only (not a PortfolioEngine veto)',
        dimension: 'PORTFOLIO_FIT',
        polarity: 'STRENGTH',
      });
    }
  }
  return evidence;
}

function mirrorEvidence(evidence: RankingEvidence[]): RankingEvidence[] {
  return evidence.map((e) => ({
    ...e,
    polarity: 'WEAKNESS' as const,
    code: e.code.replace('_ADVANTAGE', '_DISADVANTAGE').replace('_TIEBREAK', '_TIEBREAK_LOSS'),
    message: e.message
      .replace('Stronger', 'Weaker')
      .replace('Soft portfolio-fit tie-break only', 'Lost soft portfolio-fit tie-break'),
  }));
}

function classifyDominance(
  first: RankingDimensionStrip,
  second: RankingDimensionStrip | undefined,
  precedence: TiRankingDimension[],
): TiRankingDominance {
  if (!second) return 'CLEAR';
  const head = precedence.filter((d) => d !== 'PORTFOLIO_FIT').slice(0, CLEAR_PREFIX);
  let hardDiffs = 0;
  let softDiffs = 0;
  let disagreements = 0;
  for (const dim of head) {
    const a = BAND_RANK[bandOf(first, dim)];
    const b = BAND_RANK[bandOf(second, dim)];
    if (a === b) continue;
    if (a === 0 || b === 0) {
      softDiffs += 1;
      continue;
    }
    if (a > b) hardDiffs += 1;
    else disagreements += 1;
  }
  if (disagreements > 0 && hardDiffs > 0) return 'MIXED';
  if (hardDiffs >= 2) return 'CLEAR';
  if (hardDiffs === 1 || softDiffs >= 1) return 'CLOSE';
  // EV within a small band and everything else equal → CLOSE / no clear winner
  const evA = first.expectedValueR;
  const evB = second.expectedValueR;
  if (
    evA != null &&
    evB != null &&
    Number.isFinite(evA) &&
    Number.isFinite(evB) &&
    Math.abs(evA - evB) < 0.25
  ) {
    return 'CLOSE';
  }
  return 'CLOSE';
}

/**
 * Assess opportunity ranking for a candidate set under RankingContext.
 * Order of `candidates` must not affect ranks (candidate-order independence).
 */
export function assessOpportunityRanking(
  input: AssessOpportunityRankingInput,
): OpportunityRankingResult {
  const context: RankingContext = {
    ...input.context,
    timestamp: input.context.timestamp,
    portfolioState: input.context.portfolioState ? { ...input.context.portfolioState } : undefined,
  };
  const precedence = dimensionPrecedenceForContext(context.tradeHorizon);

  // Normalize order for determinism before compare (order independence).
  const normalized = [...input.candidates].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.opportunityId.localeCompare(b.opportunityId),
  );

  type Row = {
    candidate: OpportunityRankingCandidate;
    strip: RankingDimensionStrip;
    stale: boolean;
    unknown: TiRankingDimension[];
  };

  const rows: Row[] = normalized.map((c) => {
    const strip = stripFromCandidate(c, context);
    const stale = isStale(c.snapshot, context);
    const unknown = unknownDimensions(strip, c.snapshot);
    return { candidate: c, strip, stale, unknown };
  });

  rows.sort((a, b) =>
    compareStrips(a.strip, b.strip, precedence, a.candidate.symbol, b.candidate.symbol),
  );

  const rankings: OpportunityRankingAssessment[] = rows.map((row, i) => {
    const peer = rows[i + 1];
    const prev = rows[i - 1];
    const { strengths, weaknesses } = strengthsWeaknesses(row.strip, row.stale, row.unknown);
    const pairwiseReasons: PairwiseRankingReason[] = [];
    const comparedAgainst: string[] = [];

    if (peer) {
      comparedAgainst.push(peer.candidate.symbol);
      const above = pairwiseDiff(row.strip, peer.strip, precedence);
      pairwiseReasons.push({
        peerSymbol: peer.candidate.symbol,
        peerOpportunityId: peer.candidate.opportunityId,
        polarity: 'ABOVE',
        evidence: above,
      });
    }
    if (prev) {
      comparedAgainst.push(prev.candidate.symbol);
      const abovePrev = pairwiseDiff(prev.strip, row.strip, precedence);
      pairwiseReasons.push({
        peerSymbol: prev.candidate.symbol,
        peerOpportunityId: prev.candidate.opportunityId,
        polarity: 'BELOW',
        evidence: mirrorEvidence(abovePrev),
      });
    }

    const dominance =
      i === 0
        ? classifyDominance(row.strip, peer?.strip, precedence)
        : classifyDominance(row.strip, peer?.strip, precedence) === 'CLEAR'
          ? 'CLOSE'
          : classifyDominance(row.strip, peer?.strip, precedence);

    return {
      rank: i + 1,
      symbol: row.candidate.symbol,
      opportunityId: row.candidate.opportunityId,
      dimensions: row.strip,
      strengths,
      weaknesses,
      conflicts: softConflictsFromSnapshot(row.candidate.snapshot),
      comparedAgainst: [...new Set(comparedAgainst)],
      dominance: i === 0 ? classifyDominance(row.strip, peer?.strip, precedence) : dominance,
      pairwiseReasons,
      dataCompleteness: completenessOf(row.unknown),
      unknownDimensions: row.unknown,
      stale: row.stale,
      provenance: {
        engineVersion: OPPORTUNITY_RANKING_ENGINE_VERSION,
        calculationVersion: OPPORTUNITY_RANKING_CALCULATION_VERSION,
        sourceDataTimestamp: row.candidate.snapshot.sourceDataTimestamp,
        asOf: context.timestamp,
        inputs: {
          tradeHorizon: context.tradeHorizon,
          symbol: row.candidate.symbol,
          stale: row.stale,
          unknownCount: row.unknown.length,
        },
      },
    };
  });

  // Fix #1 dominance properly; for others use CLOSE/MIXED vs neighbor.
  if (rankings.length >= 2) {
    rankings[0]!.dominance = classifyDominance(rows[0]!.strip, rows[1]!.strip, precedence);
    for (let i = 1; i < rankings.length; i++) {
      const d = classifyDominance(rows[i]!.strip, rows[i - 1]?.strip, precedence);
      rankings[i]!.dominance = d === 'CLEAR' ? 'CLOSE' : d;
    }
  } else if (rankings.length === 1) {
    rankings[0]!.dominance = 'CLEAR';
  }

  const topClusterClose =
    rankings.length >= 2 &&
    (rankings[0]!.dominance === 'CLOSE' ||
      rankings[0]!.dominance === 'MIXED' ||
      rankings[0]!.dominance === 'NO_CLEAR_WINNER');

  let noClearWinner = topClusterClose;
  if (rankings.length >= 3) {
    const d01 = classifyDominance(rows[0]!.strip, rows[1]!.strip, precedence);
    const d12 = classifyDominance(rows[1]!.strip, rows[2]!.strip, precedence);
    if (d01 !== 'CLEAR' && d12 !== 'CLEAR') {
      noClearWinner = true;
      if (rankings[0]!.dominance === 'CLOSE') rankings[0]!.dominance = 'NO_CLEAR_WINNER';
    }
  }
  if (rankings[0]?.dominance === 'MIXED') {
    noClearWinner = true;
  }

  const universe = [...new Set(normalized.map((c) => c.symbol))].sort();
  const timestamp = context.timestamp;

  return {
    context,
    timestamp,
    engineVersion: OPPORTUNITY_RANKING_ENGINE_VERSION,
    calculationVersion: OPPORTUNITY_RANKING_CALCULATION_VERSION,
    candidateUniverse: universe,
    rankings,
    noClearWinner,
    provenance: {
      engineVersion: OPPORTUNITY_RANKING_ENGINE_VERSION,
      calculationVersion: OPPORTUNITY_RANKING_CALCULATION_VERSION,
      sourceDataTimestamp: timestamp,
      asOf: timestamp,
      inputs: {
        tradeHorizon: context.tradeHorizon,
        strategyTag: context.strategyTag ?? null,
        candidateCount: normalized.length,
        noClearWinner,
        precedence: precedence.join(','),
      },
    },
  };
}
