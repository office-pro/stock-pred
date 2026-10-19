-- ARTURO feature flags (dev/test)
CREATE TABLE IF NOT EXISTS "arturo_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "release_mode" TEXT NOT NULL DEFAULT 'OFF',
    "account_rules_raw" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arturo_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "arturo_flags_key_key" ON "arturo_flags"("key");
CREATE INDEX IF NOT EXISTS "arturo_flags_updated_at_idx" ON "arturo_flags"("updated_at");

CREATE TABLE IF NOT EXISTS "arturo_flag_audits" (
    "id" TEXT NOT NULL,
    "flag_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arturo_flag_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "arturo_flag_audits_flag_id_created_at_idx" ON "arturo_flag_audits"("flag_id", "created_at");

ALTER TABLE "arturo_flag_audits"
  DROP CONSTRAINT IF EXISTS "arturo_flag_audits_flag_id_fkey";
ALTER TABLE "arturo_flag_audits"
  ADD CONSTRAINT "arturo_flag_audits_flag_id_fkey"
  FOREIGN KEY ("flag_id") REFERENCES "arturo_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
