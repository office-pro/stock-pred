-- Point-in-time alternative data: news, social, macro.

CREATE TABLE "symbol_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "symbol_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "symbol_aliases_alias_symbol_key" ON "symbol_aliases"("alias", "symbol");
CREATE INDEX "symbol_aliases_symbol_idx" ON "symbol_aliases"("symbol");

CREATE TABLE "news_articles" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_articles_url_key" ON "news_articles"("url");
CREATE INDEX "news_articles_published_at_idx" ON "news_articles"("published_at");

CREATE TABLE "news_mentions" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "pos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "neg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "neu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "event_type" TEXT NOT NULL,
    "event_strength" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_mentions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_mentions_article_id_symbol_key" ON "news_mentions"("article_id", "symbol");
CREATE INDEX "news_mentions_symbol_idx" ON "news_mentions"("symbol");

ALTER TABLE "news_mentions" ADD CONSTRAINT "news_mentions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "news_daily_features" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'news',
    "news_count_1d" DOUBLE PRECISION NOT NULL,
    "news_count_7d" DOUBLE PRECISION NOT NULL,
    "news_count_30d" DOUBLE PRECISION NOT NULL,
    "news_sent_1d" DOUBLE PRECISION NOT NULL,
    "news_sent_7d" DOUBLE PRECISION NOT NULL,
    "news_sent_30d" DOUBLE PRECISION NOT NULL,
    "news_sent_std_7d" DOUBLE PRECISION NOT NULL,
    "news_sent_change_7d" DOUBLE PRECISION NOT NULL,
    "news_sent_trend_30d" DOUBLE PRECISION NOT NULL,
    "news_pos_7d" DOUBLE PRECISION NOT NULL,
    "news_neg_7d" DOUBLE PRECISION NOT NULL,
    "news_high_impact_7d" DOUBLE PRECISION NOT NULL,
    "news_event_momentum_7d" DOUBLE PRECISION NOT NULL,
    "earnings_sentiment" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_daily_features_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_daily_features_symbol_as_of_date_key" ON "news_daily_features"("symbol", "as_of_date");
CREATE INDEX "news_daily_features_symbol_available_at_idx" ON "news_daily_features"("symbol", "available_at");

CREATE TABLE "social_daily_features" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'social',
    "social_mentions_1d" DOUBLE PRECISION NOT NULL,
    "social_mentions_7d" DOUBLE PRECISION NOT NULL,
    "social_mention_growth" DOUBLE PRECISION NOT NULL,
    "social_attention_spike" DOUBLE PRECISION NOT NULL,
    "social_unique_authors_1d" DOUBLE PRECISION NOT NULL,
    "social_sent_1d" DOUBLE PRECISION NOT NULL,
    "social_sent_change" DOUBLE PRECISION NOT NULL,
    "social_bull_ratio_7d" DOUBLE PRECISION NOT NULL,
    "social_bear_ratio_7d" DOUBLE PRECISION NOT NULL,
    "social_coordination" DOUBLE PRECISION NOT NULL,
    "trends_score_7d" DOUBLE PRECISION NOT NULL,
    "trends_change_7d" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_daily_features_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_daily_features_symbol_as_of_date_key" ON "social_daily_features"("symbol", "as_of_date");
CREATE INDEX "social_daily_features_symbol_available_at_idx" ON "social_daily_features"("symbol", "available_at");

CREATE TABLE "macro_observations" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "macro_observations_series_id_as_of_date_key" ON "macro_observations"("series_id", "as_of_date");
CREATE INDEX "macro_observations_series_id_available_at_idx" ON "macro_observations"("series_id", "available_at");

CREATE TABLE "macro_daily_features" (
    "id" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'macro',
    "usdinr" DOUBLE PRECISION,
    "usdinr_chg_20d" DOUBLE PRECISION,
    "usdinr_chg_60d" DOUBLE PRECISION,
    "brent" DOUBLE PRECISION,
    "brent_chg_20d" DOUBLE PRECISION,
    "gold_chg_20d" DOUBLE PRECISION,
    "us10y" DOUBLE PRECISION,
    "us10y_chg_20d" DOUBLE PRECISION,
    "spx_chg_20d" DOUBLE PRECISION,
    "nasdaq_chg_20d" DOUBLE PRECISION,
    "dxy_chg_20d" DOUBLE PRECISION,
    "india_cpi" DOUBLE PRECISION,
    "india_cpi_chg" DOUBLE PRECISION,
    "repo_rate" DOUBLE PRECISION,
    "repo_chg_90d" DOUBLE PRECISION,
    "fii_flow_20d" DOUBLE PRECISION,
    "dii_flow_20d" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "macro_daily_features_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "macro_daily_features_as_of_date_key" ON "macro_daily_features"("as_of_date");
CREATE INDEX "macro_daily_features_available_at_idx" ON "macro_daily_features"("available_at");
