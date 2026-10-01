-- Run while connected to stockpred_dev or stockpred_prod (via db-console tunnel).
-- Does not DROP anything. Set a strong password in place of CHANGE_ME.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockpred_readonly') THEN
    CREATE ROLE stockpred_readonly LOGIN PASSWORD 'CHANGE_ME';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO stockpred_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO stockpred_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO stockpred_readonly;
