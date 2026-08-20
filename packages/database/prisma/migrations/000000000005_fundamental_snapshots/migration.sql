-- Point-in-time fundamental snapshots (Yahoo statements + quoteSummary).

CREATE TABLE "fundamental_snapshots" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'yahoo',
    "sector" TEXT,
    "revenue" DOUBLE PRECISION,
    "pat" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "ebit" DOUBLE PRECISION,
    "ebitda" DOUBLE PRECISION,
    "equity" DOUBLE PRECISION,
    "total_debt" DOUBLE PRECISION,
    "total_assets" DOUBLE PRECISION,
    "current_assets" DOUBLE PRECISION,
    "current_liab" DOUBLE PRECISION,
    "cash" DOUBLE PRECISION,
    "ocf" DOUBLE PRECISION,
    "capex" DOUBLE PRECISION,
    "fcf" DOUBLE PRECISION,
    "rev_yoy" DOUBLE PRECISION,
    "pat_yoy" DOUBLE PRECISION,
    "eps_yoy" DOUBLE PRECISION,
    "op_margin" DOUBLE PRECISION,
    "net_margin" DOUBLE PRECISION,
    "gross_margin" DOUBLE PRECISION,
    "ebitda_margin" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "roa" DOUBLE PRECISION,
    "roce" DOUBLE PRECISION,
    "debt_equity" DOUBLE PRECISION,
    "current_ratio" DOUBLE PRECISION,
    "cash_ratio" DOUBLE PRECISION,
    "ocf_pat" DOUBLE PRECISION,
    "fcf_growth" DOUBLE PRECISION,
    "fcf_margin" DOUBLE PRECISION,
    "trailing_eps" DOUBLE PRECISION,
    "book_value" DOUBLE PRECISION,
    "trailing_pe" DOUBLE PRECISION,
    "price_to_book" DOUBLE PRECISION,
    "sector_median_pe" DOUBLE PRECISION,
    "promoter_holding" DOUBLE PRECISION,
    "institution_holding" DOUBLE PRECISION,
    "display_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fundamental_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fundamental_snapshots_symbol_as_of_date_key"
  ON "fundamental_snapshots"("symbol", "as_of_date");
CREATE INDEX "fundamental_snapshots_symbol_available_at_idx"
  ON "fundamental_snapshots"("symbol", "available_at");
CREATE INDEX "fundamental_snapshots_available_at_idx"
  ON "fundamental_snapshots"("available_at");
