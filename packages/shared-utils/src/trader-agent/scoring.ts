import type {
  AgentAnalysis,
  AgentCapabilityRequest,
  AgentDecision,
  AgentScoreBreakdown,
  AgentTradeSetup,
  AltDataView,
  FundamentalView,
  StockQuote,
} from '@stockpred/shared-types';
import { AGENT_DISCLAIMER } from '@stockpred/shared-types';
import { expectedProfitPct } from '../best-pick';
import { round2 } from '../math';
import { positionSize } from '../risk';

export interface AnalystInputs {
  quote?: StockQuote | null;
  fundamentals?: FundamentalView | null;
  altData?: AltDataView | null;
  cash: number;
  riskPerTradePercent: number;
  usedCapabilities: string[];
  missingCapabilities: string[];
  capabilityRequests: AgentCapabilityRequest[];
  requiredMissing: boolean;
}

function clamp(score: number | null): number | null {
  if (score == null || Number.isNaN(score)) return null;
  return Math.max(0, Math.min(100, round2(score)));
}

function average(scores: Array<number | null>): number {
  const present = scores.filter((row): row is number => row != null);
  if (present.length === 0) return 0;
  return round2(present.reduce((sum, row) => sum + row, 0) / present.length);
}

export function scoreFundamental(fundamentals?: FundamentalView | null): number | null {
  if (!fundamentals || fundamentals.missing) return null;
  if (fundamentals.displayScore != null) return clamp(fundamentals.displayScore);
  let score = 50;
  if (fundamentals.roe != null)
    score += fundamentals.roe >= 15 ? 15 : fundamentals.roe >= 8 ? 5 : -10;
  if (fundamentals.debtEquity != null) {
    score += fundamentals.debtEquity <= 0.5 ? 10 : fundamentals.debtEquity <= 1.5 ? 0 : -15;
  }
  if (fundamentals.pe != null && fundamentals.pe > 0 && fundamentals.pe < 40) score += 5;
  if (fundamentals.revYoy != null)
    score += fundamentals.revYoy > 10 ? 10 : fundamentals.revYoy > 0 ? 3 : -8;
  return clamp(score);
}

export function scoreTechnical(quote?: StockQuote | null): number | null {
  if (!quote) return null;
  let score = 45;
  if (quote.suggestion === 'BUY') score += 25;
  if (quote.suggestion === 'SELL') score -= 25;
  score += Math.min(20, (quote.confidence ?? 0) * 0.2);
  const ind = quote.indicators;
  if (ind?.rsi != null) {
    if (ind.rsi >= 45 && ind.rsi <= 65) score += 8;
    else if (ind.rsi > 75) score -= 10;
    else if (ind.rsi < 30) score += 5;
  }
  if (ind?.macd != null && ind.macdSignal != null) {
    score += ind.macd > ind.macdSignal ? 8 : -8;
  }
  if (quote.scanner) {
    score += Math.min(15, Math.max(-15, (quote.scanner.bullScore - 50) * 0.3));
  }
  return clamp(score);
}

export function scoreSentiment(alt?: AltDataView | null): number | null {
  if (!alt || alt.missing || (!alt.news && !alt.social)) return null;
  let score = 50;
  if (alt.news) {
    score += alt.news.sentiment7d * 40;
    if (alt.news.count7d <= 0) score -= 5;
  }
  if (alt.social) {
    score += alt.social.sentiment1d * 30;
    if (alt.social.attentionSpike >= 1.5 && Math.abs(alt.social.sentiment1d) < 0.1) score -= 8;
  }
  return clamp(score);
}

export function scoreQuant(quote?: StockQuote | null): number | null {
  if (!quote || quote.confidence <= 0) return null;
  let score = quote.confidence;
  if (quote.suggestion === 'BUY') score = Math.min(100, score + 5);
  if (quote.suggestion === 'SELL') score = Math.max(0, 100 - score);
  if (quote.suggestion === 'HOLD') score = 45 + (quote.confidence - 50) * 0.2;
  return clamp(score);
}

export function scoreMacro(alt?: AltDataView | null): number | null {
  if (!alt?.macro) return null;
  let score = 55;
  const { usdinrChg20d, brentChg20d, repoChg90d } = alt.macro;
  if (usdinrChg20d != null) score += usdinrChg20d > 1.5 ? -8 : usdinrChg20d < -1 ? 5 : 0;
  if (brentChg20d != null) score += brentChg20d > 8 ? -5 : 0;
  if (repoChg90d != null) score += repoChg90d > 0 ? -6 : repoChg90d < 0 ? 4 : 0;
  return clamp(score);
}

export function scoreSector(quote?: StockQuote | null): number | null {
  if (!quote?.scanner) return null;
  const rs = quote.scanner.relativeStrengthNifty50 ?? quote.relativeStrengthNifty50;
  let score = 50;
  if (rs != null) score += rs >= 1.05 ? 20 : rs >= 1 ? 8 : rs >= 0.95 ? 0 : -15;
  if (quote.scanner.band === 'BULL_RUN_CANDIDATE' || quote.scanner.band === 'STRONG_BULLISH') {
    score += 15;
  }
  if (quote.scanner.risk === 'HIGH_RISK_BULLISH') score -= 12;
  return clamp(score);
}

export function scoreRisk(quote?: StockQuote | null, cash = 0): number | null {
  if (!quote) return null;
  let score = 70;
  if (quote.manipulation?.band === 'INVESTIGATE') score -= 35;
  else if (quote.manipulation?.band === 'SUSPICIOUS') score -= 15;
  if (quote.scanner?.risk === 'HIGH_RISK_BULLISH') score -= 20;
  else if (quote.scanner?.risk === 'EXTENDED') score -= 10;
  if (cash <= 0) score -= 40;
  const rr =
    quote.entry && quote.stopLoss && quote.target
      ? Math.abs(quote.target - quote.entry) /
        Math.max(0.01, Math.abs(quote.entry - quote.stopLoss))
      : null;
  if (rr != null) score += rr >= 2 ? 15 : rr >= 1.5 ? 5 : -10;
  return clamp(score);
}

function decideFromScores(
  scores: AgentScoreBreakdown,
  quote: StockQuote | null | undefined,
  requiredMissing: boolean,
): AgentDecision {
  if (requiredMissing) return 'WAIT';
  if (!quote || quote.price <= 0) return 'NO_TRADE';
  if (quote.manipulation?.band === 'INVESTIGATE') return 'NO_TRADE';
  if (scores.risk != null && scores.risk < 35) return 'NO_TRADE';

  const overall = scores.overall;
  const tech = scores.technical ?? 50;
  const quant = scores.quant ?? 50;

  if (overall >= 78 && tech >= 65 && quant >= 60 && quote.suggestion !== 'SELL') {
    return quote.scanner?.breakouts?.high20 ? 'BUY_ON_BREAKOUT' : 'STRONG_BUY';
  }
  if (overall >= 68 && quote.suggestion === 'BUY') return 'BUY';
  if (overall >= 62 && quote.suggestion === 'BUY') return 'BUY_ON_PULLBACK';
  if (overall <= 32 || quote.suggestion === 'SELL') {
    return overall <= 25 ? 'STRONG_SELL' : 'SELL';
  }
  if (overall < 55) return 'WAIT';
  return 'HOLD';
}

function buildSetup(
  quote: StockQuote | null | undefined,
  decision: AgentDecision,
  cash: number,
  riskPct: number,
  confidence: number,
): AgentTradeSetup {
  const price = quote?.price && quote.price > 0 ? quote.price : null;
  const entry = quote?.entry && quote.entry > 0 ? quote.entry : price;
  const stop = quote?.stopLoss && quote.stopLoss > 0 ? quote.stopLoss : entry ? entry * 0.97 : null;
  const t1 = quote?.target && quote.target > 0 ? quote.target : entry ? entry * 1.04 : null;
  const t2 = t1 && entry ? round2(entry + (t1 - entry) * 1.6) : null;
  const t3 = t1 && entry ? round2(entry + (t1 - entry) * 2.4) : null;
  const longish = decision.includes('BUY') || decision === 'HOLD';
  let size = 0;
  if (longish && entry && stop && cash > 0) {
    size = positionSize(cash, riskPct, entry, stop);
    // Never let one setup consume more than 5% of cash — bulk approve used to drain the book on the first name.
    const maxByCashShare = Math.floor((cash * 0.05) / entry);
    if (maxByCashShare >= 1) size = Math.min(size, maxByCashShare);
    // Risk math can floor to 0 on wide stops / expensive names; still allow 1 lot if cash covers it.
    if (size <= 0 && decision.includes('BUY') && cash >= entry) {
      size = 1;
    }
  }
  const rr =
    entry && stop && t1
      ? round2(Math.abs(t1 - entry) / Math.max(0.01, Math.abs(entry - stop)))
      : null;
  return {
    instrument: quote?.symbol ?? '',
    direction: decision.includes('SELL') ? 'SHORT' : longish ? 'LONG' : 'FLAT',
    entry: entry != null ? round2(entry) : null,
    stopLoss: stop != null ? round2(stop) : null,
    target1: t1 != null ? round2(t1) : null,
    target2: t2,
    target3: t3,
    riskReward: rr,
    positionSize: size,
    expectedHoldingPeriod: quote?.horizon === 'NEXT_WEEK' ? '5–10 sessions' : '1–5 sessions',
    confidence,
    invalidation: stop
      ? `Daily close below ₹${round2(stop)} or thesis failure (reversal / risk-off).`
      : 'No valid stop — NO TRADE until levels exist.',
  };
}

/** Combine existing app parameters into a professional trading decision card. */
export function composeAgentAnalysis(input: AnalystInputs): AgentAnalysis {
  const { quote, fundamentals, altData, cash, riskPerTradePercent } = input;
  const scores: AgentScoreBreakdown = {
    fundamental: scoreFundamental(fundamentals),
    technical: scoreTechnical(quote),
    sentiment: scoreSentiment(altData),
    quant: scoreQuant(quote),
    macro: scoreMacro(altData),
    sector: scoreSector(quote),
    risk: scoreRisk(quote, cash),
    overall: 0,
  };
  scores.overall = average([
    scores.fundamental,
    scores.technical,
    scores.sentiment,
    scores.quant,
    scores.macro,
    scores.sector,
    scores.risk,
  ]);

  const decision = decideFromScores(scores, quote, input.requiredMissing);
  const setup = buildSetup(quote, decision, cash, riskPerTradePercent, scores.overall);

  const regime =
    scores.macro == null
      ? 'UNKNOWN'
      : scores.macro >= 60
        ? 'RISK_ON'
        : scores.macro <= 40
          ? 'RISK_OFF'
          : 'NEUTRAL';

  const profit = quote ? expectedProfitPct(quote) : 0;
  const thesisParts = [
    quote?.suggestion ? `Scanner/advisory leans ${quote.suggestion}` : null,
    scores.technical != null ? `technical ${scores.technical}` : null,
    scores.fundamental != null ? `fundamentals ${scores.fundamental}` : null,
    scores.sentiment != null ? `sentiment ${scores.sentiment}` : null,
    profit > 0 ? `expected move/profit ~${profit.toFixed(1)}%` : null,
  ].filter(Boolean);

  const counter = [
    scores.risk != null && scores.risk < 50 ? 'elevated risk score' : null,
    quote?.manipulation?.band && quote.manipulation.band !== 'NORMAL'
      ? `unusual activity ${quote.manipulation.band}`
      : null,
    quote?.scanner?.risk === 'HIGH_RISK_BULLISH' ? 'overextended bull risk' : null,
    input.missingCapabilities.length
      ? `missing data: ${input.missingCapabilities.join(', ')}`
      : null,
  ].filter(Boolean);

  const action =
    decision === 'NO_TRADE' || decision === 'WAIT'
      ? 'Do not execute. Resolve missing capabilities or wait for a cleaner setup.'
      : decision.includes('BUY')
        ? `Propose LONG ${setup.positionSize} shares with stop ${setup.stopLoss ?? '—'} and T1 ${setup.target1 ?? '—'}. Requires approval.`
        : decision.includes('SELL')
          ? 'Reduce or avoid long exposure; prefer exit if holding.'
          : 'Hold / monitor; no new risk.';

  return {
    symbol: quote?.symbol ?? 'UNKNOWN',
    currentPrice: quote?.price && quote.price > 0 ? round2(quote.price) : null,
    decision,
    scores,
    setup,
    marketRegime: regime,
    thesis: thesisParts.join(' · ') || 'Insufficient confirmed evidence.',
    counterThesis: counter.join(' · ') || 'No major counter-signals from available data.',
    invalidation: setup.invalidation,
    risks: [
      ...(quote?.manipulation?.band === 'INVESTIGATE' ? ['Investigate-band unusual activity'] : []),
      ...(quote?.scanner?.risk ? [`Overextension: ${quote.scanner.risk}`] : []),
      ...(input.requiredMissing ? ['Required market capabilities missing'] : []),
    ],
    action,
    usedCapabilities: input.usedCapabilities,
    missingCapabilities: input.missingCapabilities,
    capabilityRequests: input.capabilityRequests,
    generatedAt: Date.now(),
    disclaimer: AGENT_DISCLAIMER,
  };
}
