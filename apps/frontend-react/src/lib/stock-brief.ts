import type { AltDataView } from '@stockpred/shared-types';

export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export interface StockBriefPrediction {
  horizon: string;
  direction: string;
  confidence: number;
}

export interface StockBriefInput {
  altData?: AltDataView | null;
  paperAction: TradeAction;
  predictions?: StockBriefPrediction[];
  patternOutlook?: string | null;
  fundamentalsScore?: number | null;
}

export interface StockBrief {
  contextLine: string;
  decisionLine: string;
}

function newsContext(news: AltDataView['news']): string {
  if (!news) return 'News feed not loaded yet';
  if (news.count7d <= 0) {
    return 'Few recent headlines — news is not driving the narrative';
  }

  const sentiment = news.sentiment7d;
  const outlook =
    sentiment >= 0.2
      ? 'Headlines lean bullish — narrative supports upside'
      : sentiment <= -0.2
        ? 'Headlines lean bearish — narrative weighs on the name'
        : 'Headlines are mixed — news neither strongly lifts nor drags';

  const parts = [`${outlook} (${Math.round(news.count7d)} articles, 7d)`];
  if (news.highImpact7d >= 1) {
    parts.push(`${Math.round(news.highImpact7d)} high-impact`);
  }
  if (Math.abs(news.earningsSentiment) >= 0.2) {
    parts.push(news.earningsSentiment > 0 ? 'earnings tone positive' : 'earnings tone cautious');
  }
  return parts.join(' · ');
}

function socialContext(social: AltDataView['social']): string {
  if (!social) return 'Social sentiment not loaded yet';
  if (social.mentions1d < 1 && social.trends7d < 0.05) {
    return 'Social buzz is quiet — neither fear nor greed is showing up';
  }

  const { sentiment1d, attentionSpike, mentions1d } = social;
  if (sentiment1d >= 0.25 && attentionSpike >= 1.3) {
    return `Crowd mood looks greedy (${Math.round(mentions1d)} mentions today, attention elevated)`;
  }
  if (sentiment1d <= -0.25) {
    return `Discussion skews fearful (${Math.round(mentions1d)} mentions today)`;
  }
  if (attentionSpike >= 1.5 && Math.abs(sentiment1d) < 0.15) {
    return 'Attention is spiking but sentiment is split — watch for volatility';
  }
  if (sentiment1d > 0.1) {
    return 'Social tone is mildly optimistic';
  }
  if (sentiment1d < -0.1) {
    return 'Social tone is mildly cautious';
  }
  return 'Social sentiment is neutral';
}

function mlReason(predictions: StockBriefPrediction[] | undefined): string | null {
  const nextDay = predictions?.find((row) => row.horizon === 'NEXT_DAY');
  if (!nextDay) return null;
  if (nextDay.direction === 'UP') {
    return `ML next-day bias up (${nextDay.confidence}% confidence)`;
  }
  if (nextDay.direction === 'DOWN') {
    return `ML next-day bias down (${nextDay.confidence}% confidence)`;
  }
  return 'ML sees a sideways near-term move';
}

function patternReason(outlook: string | null | undefined): string | null {
  if (outlook === 'GROW') return 'historic pattern matches lean up';
  if (outlook === 'FALL') return 'historic pattern matches lean down';
  return null;
}

function fundamentalsReason(score: number | null | undefined): string | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 70) return 'fundamentals screen strong';
  if (score <= 40) return 'fundamentals screen weak';
  return null;
}

function newsAligns(action: TradeAction, sentiment7d: number | undefined): string | null {
  if (sentiment7d == null) return null;
  if (action === 'BUY' && sentiment7d >= 0.15) return 'positive news aligns with buy view';
  if (action === 'SELL' && sentiment7d <= -0.15) return 'negative news aligns with sell view';
  if (action === 'HOLD' && Math.abs(sentiment7d) < 0.15)
    return 'news is inconclusive — fits a hold';
  return null;
}

export function buildStockBrief(input: StockBriefInput): StockBrief {
  const { altData, paperAction, predictions, patternOutlook, fundamentalsScore } = input;
  const news = altData?.news ?? null;
  const social = altData?.social ?? null;

  const contextLine = `${newsContext(news)} · ${socialContext(social)}`;

  const reasons: string[] = [];
  const ml = mlReason(predictions);
  if (ml) reasons.push(ml);
  const pattern = patternReason(patternOutlook);
  if (pattern) reasons.push(pattern);
  const fa = fundamentalsReason(fundamentalsScore);
  if (fa) reasons.push(fa);
  const aligned = newsAligns(paperAction, news?.sentiment7d);
  if (aligned) reasons.push(aligned);

  if (reasons.length === 0) {
    reasons.push('scanner blends price action, signals, and model scores');
  }

  const decisionLine = `Suggested ${paperAction} — ${reasons.slice(0, 3).join('; ')}.`;

  return { contextLine, decisionLine };
}
