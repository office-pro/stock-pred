import type {
  AltDataView,
  FundamentalView,
  PeerValuationView,
  StockQuote,
} from '@stockpred/shared-types';
import type { StockBriefPrediction, TradeAction } from './stock-brief';
import { buildStockBrief } from './stock-brief';

export interface TradeThesisInput {
  stock?: StockQuote | null;
  altData?: AltDataView | null;
  fundamentals?: FundamentalView | null;
  peer?: PeerValuationView | null;
  paperAction: TradeAction;
  predictions?: StockBriefPrediction[];
  patternOutlook?: string | null;
  signalConfidence?: number | null;
  signalRules?: Record<string, boolean> | null;
}

export interface TradeThesis {
  action: TradeAction;
  headline: string;
  summary: string;
  whyBuy: string[];
  whyCaution: string[];
  levels: string[];
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** Build a plain-language thesis for the stock detail page. */
export function buildTradeThesis(input: TradeThesisInput): TradeThesis {
  const {
    stock,
    altData,
    fundamentals,
    peer,
    paperAction,
    predictions,
    patternOutlook,
    signalConfidence,
    signalRules,
  } = input;
  const brief = buildStockBrief({
    altData,
    paperAction,
    predictions,
    patternOutlook,
    fundamentalsScore: fundamentals?.displayScore ?? null,
  });

  const whyBuy: string[] = [];
  const whyCaution: string[] = [];
  const levels: string[] = [];

  if (stock?.suggestion === 'BUY' || paperAction === 'BUY') {
    whyBuy.push(
      `Model/scanner lean is BUY${stock?.confidence ? ` at ${Math.round(stock.confidence)}% confidence` : ''}.`,
    );
  } else if (paperAction === 'SELL') {
    whyCaution.push('Current lean is SELL — treat buy interest as contrary until the view flips.');
  } else {
    whyCaution.push('Lean is HOLD — wait for a clearer setup before sizing a buy.');
  }

  if (stock?.entry != null && stock.target != null && stock.stopLoss != null) {
    const risk = stock.entry - stock.stopLoss;
    const reward = stock.target - stock.entry;
    const rr = risk > 0 ? reward / risk : null;
    levels.push(
      `Paper levels: entry ₹${fmt(stock.entry)} · target ₹${fmt(stock.target)} · stop ₹${fmt(stock.stopLoss)}${rr != null ? ` · R:R ~${rr.toFixed(1)}` : ''}.`,
    );
    if (paperAction === 'BUY' && rr != null && rr >= 1.5) {
      whyBuy.push(`Reward-to-risk is about ${rr.toFixed(1)}× from entry to target vs stop.`);
    }
  }

  const ind = stock?.indicators;
  if (ind?.rsi != null) {
    if (ind.rsi < 35)
      whyBuy.push(`RSI near oversold (${ind.rsi.toFixed(0)}) — bounce setups get more attention.`);
    else if (ind.rsi > 70)
      whyCaution.push(`RSI is elevated (${ind.rsi.toFixed(0)}) — chase risk is higher.`);
    else if (paperAction === 'BUY')
      whyBuy.push(`RSI is mid-range (${ind.rsi.toFixed(0)}), not stretched.`);
  }
  if (ind?.ema20 != null && ind?.ema50 != null && stock?.price) {
    if (stock.price > ind.ema20 && ind.ema20 > ind.ema50) {
      whyBuy.push('Price is above EMA20 with EMA20 above EMA50 — short-term trend still up.');
    } else if (stock.price < ind.ema50) {
      whyCaution.push('Price is below EMA50 — trend filter is not confirming a buy.');
    }
  }

  if (stock?.scanner) {
    const s = stock.scanner;
    if (s.bullScore >= 60) {
      whyBuy.push(
        `Bull-run score ${s.bullScore}/100 (${s.band.replace(/_/g, ' ').toLowerCase()}).`,
      );
    } else if (s.bearScore >= 60) {
      whyCaution.push(`Bear pressure score ${s.bearScore}/100 — overextension / weak tape risk.`);
    }
    if (s.forecast?.upProbability != null && s.forecast.upProbability >= 55) {
      whyBuy.push(
        `Scanner 20d up probability ~${s.forecast.upProbability}% (expected ${fmtPct(s.forecast.expectedReturn20d)}).`,
      );
    }
  }

  if (stock?.relativeStrengthNifty50 != null) {
    if (stock.relativeStrengthNifty50 > 1.05) {
      whyBuy.push(
        `Outperforming Nifty 50 on ~60d relative strength (${stock.relativeStrengthNifty50.toFixed(2)}).`,
      );
    } else if (stock.relativeStrengthNifty50 < 0.95) {
      whyCaution.push(
        `Lagging Nifty 50 on relative strength (${stock.relativeStrengthNifty50.toFixed(2)}).`,
      );
    }
  }

  if (fundamentals && !fundamentals.missing) {
    if (fundamentals.displayScore != null && fundamentals.displayScore >= 65) {
      whyBuy.push(`Fundamentals screen solid (FA score ${Math.round(fundamentals.displayScore)}).`);
    } else if (fundamentals.displayScore != null && fundamentals.displayScore <= 40) {
      whyCaution.push(
        `Fundamentals screen weak (FA score ${Math.round(fundamentals.displayScore)}).`,
      );
    }
    if (fundamentals.roe != null && fundamentals.roe >= 0.15) {
      whyBuy.push(`ROE ${(fundamentals.roe * 100).toFixed(0)}% supports quality.`);
    }
  }

  if (peer && !peer.missing) {
    if (peer.peVsMedianPct != null && peer.peVsMedianPct <= -10) {
      whyBuy.push(
        `PE ${fmt(peer.pe, 1)} is ~${Math.abs(peer.peVsMedianPct).toFixed(0)}% below ${peer.sector} median (${fmt(peer.sectorMedianPe, 1)}).`,
      );
    } else if (peer.peVsMedianPct != null && peer.peVsMedianPct >= 25) {
      whyCaution.push(
        `PE ${fmt(peer.pe, 1)} is ~${peer.peVsMedianPct.toFixed(0)}% above ${peer.sector} median — valuation stretch.`,
      );
    }
  }

  const news = altData?.news;
  if (news) {
    if (news.sentiment7d >= 0.15) {
      whyBuy.push(
        `News tone is constructive (${news.count7d} articles / 7d, sentiment ${news.sentiment7d.toFixed(2)}).`,
      );
    } else if (news.sentiment7d <= -0.15) {
      whyCaution.push(
        `News tone is soft (${news.count7d} articles / 7d, sentiment ${news.sentiment7d.toFixed(2)}).`,
      );
    }
  }

  const social = altData?.social;
  if (social) {
    if (social.sentiment1d >= 0.2 && social.attentionSpike >= 1.2) {
      whyBuy.push('Social attention is elevated with a constructive tone.');
    } else if (social.sentiment1d <= -0.25) {
      whyCaution.push('Social chatter skews fearful — watch for volatility.');
    }
  }

  const macro = altData?.macro;
  if (macro) {
    if (macro.usdinrChg20d != null && macro.usdinrChg20d > 1.5) {
      whyCaution.push(
        `INR soft vs USD over 20d (${fmtPct(macro.usdinrChg20d)}) — FX headwind for importers.`,
      );
    }
    if (macro.brentChg20d != null && Math.abs(macro.brentChg20d) >= 5) {
      whyCaution.push(
        `Brent moved ${fmtPct(macro.brentChg20d)} over 20d — energy/cost sensitivity.`,
      );
    }
  }

  const nextDay = predictions?.find((row) => row.horizon === 'NEXT_DAY');
  if (nextDay?.direction === 'UP') {
    whyBuy.push(`ML next-day bias UP (${nextDay.confidence}% confidence).`);
  } else if (nextDay?.direction === 'DOWN') {
    whyCaution.push(`ML next-day bias DOWN (${nextDay.confidence}% confidence).`);
  }

  if (patternOutlook === 'GROW') whyBuy.push('Historic pattern matches lean bullish.');
  if (patternOutlook === 'FALL') whyCaution.push('Historic pattern matches lean bearish.');

  if (signalConfidence != null && signalConfidence >= 60 && paperAction === 'BUY') {
    whyBuy.push(`Live signal confidence ${Math.round(signalConfidence)}%.`);
  }
  if (signalRules) {
    const fired = Object.entries(signalRules)
      .filter(([, on]) => on)
      .map(([name]) => name.replace(/_/g, ' '));
    if (fired.length > 0 && paperAction === 'BUY') {
      whyBuy.push(`Signal rules in play: ${fired.slice(0, 4).join(', ')}.`);
    }
  }

  if (stock?.manipulation && stock.manipulation.band !== 'NORMAL') {
    whyCaution.push(
      `Unusual-activity band ${stock.manipulation.band.replace(/_/g, ' ')} — size carefully.`,
    );
  }

  if (whyBuy.length === 0 && paperAction === 'BUY') {
    whyBuy.push(brief.decisionLine);
  }

  const headline =
    paperAction === 'BUY'
      ? `Why consider buying ${stock?.symbol ?? 'this stock'}`
      : paperAction === 'SELL'
        ? `Why the view is sell / avoid chase`
        : `Why the view is hold for now`;

  return {
    action: paperAction,
    headline,
    summary: brief.decisionLine,
    whyBuy,
    whyCaution,
    levels,
  };
}
