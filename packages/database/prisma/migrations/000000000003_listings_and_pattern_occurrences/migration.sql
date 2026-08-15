-- Official listing metadata on stocks + historical pattern analog table.

ALTER TABLE "stocks" ADD COLUMN "isin" TEXT;
ALTER TABLE "stocks" ADD COLUMN "series" TEXT;
ALTER TABLE "stocks" ADD COLUMN "bse_code" TEXT;
ALTER TABLE "stocks" ADD COLUMN "yahoo_symbol" TEXT;
ALTER TABLE "stocks" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stocks" ADD COLUMN "listing_date" TIMESTAMP(3);

CREATE UNIQUE INDEX "stocks_isin_key" ON "stocks"("isin");
CREATE INDEX "stocks_listed_exchange_idx" ON "stocks"("listed", "exchange");

CREATE TABLE "pattern_occurrences" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1d',
    "direction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "confirmed_at" BIGINT NOT NULL,
    "return_5" DOUBLE PRECISION,
    "return_10" DOUBLE PRECISION,
    "return_20" DOUBLE PRECISION,
    "max_favorable" DOUBLE PRECISION,
    "max_adverse" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pattern_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pattern_occurrences_symbol_pattern_timeframe_confirmed_at_key"
  ON "pattern_occurrences"("symbol", "pattern", "timeframe", "confirmed_at");
CREATE INDEX "pattern_occurrences_symbol_pattern_idx" ON "pattern_occurrences"("symbol", "pattern");

ALTER TABLE "pattern_occurrences"
  ADD CONSTRAINT "pattern_occurrences_symbol_fkey"
  FOREIGN KEY ("symbol") REFERENCES "stocks"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;
