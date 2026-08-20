import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import type { AltDataView } from '@stockpred/shared-types';
import {
  ingestMacro,
  ingestNewsSymbol,
  ingestNewsUniverse,
  ingestSocialSymbol,
  ingestSocialUniverse,
  upsertNewsFromPayload,
  upsertSocialDaily,
} from './alt-data/alt-data-write';

@Injectable()
export class AltDataStore {
  private readonly prisma = getPrismaClient();

  ingestNews(symbol: string, options?: { full?: boolean }) {
    return ingestNewsSymbol(symbol.toUpperCase(), options);
  }

  ingestNewsUniverse(universe?: string, options?: { full?: boolean }) {
    return ingestNewsUniverse(universe ?? 'nifty50', options);
  }

  ingestSocial(symbol: string, options?: { full?: boolean }) {
    return ingestSocialSymbol(symbol.toUpperCase(), options);
  }

  ingestSocialUniverse(universe?: string, options?: { full?: boolean }) {
    return ingestSocialUniverse(universe ?? 'nifty50', options);
  }

  ingestMacro(options?: { full?: boolean; includeIndia?: boolean }) {
    return ingestMacro(options);
  }

  upsertNews(symbol: string, headlines: Parameters<typeof upsertNewsFromPayload>[1]) {
    return upsertNewsFromPayload(symbol.toUpperCase(), headlines);
  }

  upsertSocial(symbol: string, rows: Parameters<typeof upsertSocialDaily>[1]) {
    return upsertSocialDaily(symbol.toUpperCase(), rows);
  }

  async latestView(symbol: string): Promise<AltDataView> {
    const now = new Date();
    const news = await this.prisma.newsDailyFeature.findFirst({
      where: { symbol, availableAt: { lte: now } },
      orderBy: { availableAt: 'desc' },
    });
    const social = await this.prisma.socialDailyFeature.findFirst({
      where: { symbol, availableAt: { lte: now } },
      orderBy: { availableAt: 'desc' },
    });
    const macro = await this.prisma.macroDailyFeature.findFirst({
      where: { availableAt: { lte: now } },
      orderBy: { availableAt: 'desc' },
    });
    return {
      symbol,
      news: news
        ? {
            asOfDate: news.asOfDate.getTime(),
            availableAt: news.availableAt.getTime(),
            sentiment7d: news.newsSent7d,
            count7d: news.newsCount7d,
            highImpact7d: news.newsHighImpact7d,
            earningsSentiment: news.earningsSentiment,
          }
        : null,
      social: social
        ? {
            asOfDate: social.asOfDate.getTime(),
            availableAt: social.availableAt.getTime(),
            mentions1d: social.mentions1d,
            attentionSpike: social.attentionSpike,
            sentiment1d: social.sentiment1d,
            coordination: social.coordination,
            trends7d: social.trendsScore7d,
          }
        : null,
      macro: macro
        ? {
            asOfDate: macro.asOfDate.getTime(),
            availableAt: macro.availableAt.getTime(),
            usdinr: macro.usdinr,
            usdinrChg20d: macro.usdinrChg20d,
            brent: macro.brent,
            brentChg20d: macro.brentChg20d,
            repoRate: macro.repoRate,
            repoChg90d: macro.repoChg90d,
            indiaCpi: macro.indiaCpi,
          }
        : null,
      missing: !news && !social && !macro,
    };
  }

  async newsPanel() {
    const rows = await this.prisma.newsDailyFeature.findMany({
      orderBy: [{ symbol: 'asc' }, { availableAt: 'asc' }],
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      available_at: row.availableAt.toISOString(),
      news_count_1d: row.newsCount1d,
      news_count_7d: row.newsCount7d,
      news_count_30d: row.newsCount30d,
      news_sent_1d: row.newsSent1d,
      news_sent_7d: row.newsSent7d,
      news_sent_30d: row.newsSent30d,
      news_sent_std_7d: row.newsSentStd7d,
      news_sent_change_7d: row.newsSentChange7d,
      news_sent_trend_30d: row.newsSentTrend30d,
      news_pos_7d: row.newsPos7d,
      news_neg_7d: row.newsNeg7d,
      news_high_impact_7d: row.newsHighImpact7d,
      news_event_momentum_7d: row.newsEventMomentum7d,
      earnings_sentiment: row.earningsSentiment,
    }));
  }

  async socialPanel() {
    const rows = await this.prisma.socialDailyFeature.findMany({
      orderBy: [{ symbol: 'asc' }, { availableAt: 'asc' }],
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      available_at: row.availableAt.toISOString(),
      social_mentions_1d: row.mentions1d,
      social_mentions_7d: row.mentions7d,
      social_mention_growth: row.mentionGrowth,
      social_attention_spike: row.attentionSpike,
      social_unique_authors_1d: row.uniqueAuthors1d,
      social_sent_1d: row.sentiment1d,
      social_sent_change: row.sentimentChange,
      social_bull_ratio_7d: row.bullRatio7d,
      social_bear_ratio_7d: row.bearRatio7d,
      social_coordination: row.coordination,
      trends_score_7d: row.trendsScore7d,
      trends_change_7d: row.trendsChange7d,
    }));
  }

  async macroPanel() {
    const rows = await this.prisma.macroDailyFeature.findMany({
      orderBy: { availableAt: 'asc' },
    });
    return rows.map((row) => ({
      available_at: row.availableAt.toISOString(),
      usdinr: row.usdinr,
      usdinr_chg_20d: row.usdinrChg20d,
      usdinr_chg_60d: row.usdinrChg60d,
      brent: row.brent,
      brent_chg_20d: row.brentChg20d,
      gold_chg_20d: row.goldChg20d,
      us10y: row.us10y,
      us10y_chg_20d: row.us10yChg20d,
      spx_chg_20d: row.spxChg20d,
      nasdaq_chg_20d: row.nasdaqChg20d,
      dxy_chg_20d: row.dxyChg20d,
      india_cpi: row.indiaCpi,
      india_cpi_chg: row.indiaCpiChg,
      repo_rate: row.repoRate,
      repo_chg_90d: row.repoChg90d,
      fii_flow_20d: row.fiiFlow20d,
      dii_flow_20d: row.diiFlow20d,
    }));
  }
}
