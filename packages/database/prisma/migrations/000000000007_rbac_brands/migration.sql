-- RBAC + brand multi-tenancy
CREATE TABLE IF NOT EXISTS "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "paper_capital" DOUBLE PRECISION NOT NULL DEFAULT 10000000,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "logo_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "brands_name_key" ON "brands"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "brands_domain_key" ON "brands"("domain");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_views" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "access_expires_at" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "users_brand_id_role_idx" ON "users"("brand_id", "role");
CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users"("status");

ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "brand_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "trades" ADD CONSTRAINT "trades_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "trades_brand_id_user_id_idx" ON "trades"("brand_id", "user_id");

CREATE TABLE IF NOT EXISTS "access_extension_requests" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "requested_until" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reviewer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_extension_requests_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "access_extension_requests" ADD CONSTRAINT "access_extension_requests_viewer_id_fkey"
    FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "access_extension_requests" ADD CONSTRAINT "access_extension_requests_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "access_extension_requests" ADD CONSTRAINT "access_extension_requests_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "access_extension_requests_brand_id_status_idx"
  ON "access_extension_requests"("brand_id", "status");
CREATE INDEX IF NOT EXISTS "access_extension_requests_viewer_id_status_idx"
  ON "access_extension_requests"("viewer_id", "status");

-- Migrate legacy TRADER role → USER
UPDATE "users" SET "role" = 'USER' WHERE "role" = 'TRADER';
