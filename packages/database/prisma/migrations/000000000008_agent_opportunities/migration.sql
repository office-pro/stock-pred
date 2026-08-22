-- Per-user agent desk opportunities (New / Added)
CREATE TABLE IF NOT EXISTS "agent_opportunities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "analysis" JSONB NOT NULL,
    "quantity" INTEGER,
    "expires_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_opportunities_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "agent_opportunities" ADD CONSTRAINT "agent_opportunities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_opportunities" ADD CONSTRAINT "agent_opportunities_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "agent_opportunities_user_id_status_idx"
  ON "agent_opportunities"("user_id", "status");
CREATE INDEX IF NOT EXISTS "agent_opportunities_user_id_symbol_status_idx"
  ON "agent_opportunities"("user_id", "symbol", "status");
CREATE INDEX IF NOT EXISTS "agent_opportunities_expires_at_idx"
  ON "agent_opportunities"("expires_at");
