# Hybrid free-tier development (Phases 1–5 + REDIS_MODE follow-up)

#

# Local: all apps + Kafka

# Cloud DB (optional): managed Postgres URL in `.env.test-cloud`

# Redis: selected only by REDIS_MODE (independent of DATABASE_URL)

#

# Providers are configuration only. Application code must not branch on

# "supabase", "upstash", etc. — only DATABASE*URL / REDIS_MODE / REDIS*_*URL / KAFKA*_.

## Prerequisites

1. Free managed **development** Postgres project → **Session pooler** URI as `DATABASE_URL`
   (IPv4 `aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`, `sslmode=require`).
   Do **not** use `db.<project>.supabase.co:5432` — that host is IPv6-only and Docker Desktop
   cannot reach it (`P1001 Can't reach database server`).
2. Free managed **development** Redis project → `REDIS_CLOUD_URL` (`rediss://…`) when using `REDIS_MODE=test-cloud`
3. Docker Desktop for local Kafka / local Redis
4. Node 20+ / npm 10+

Use a **dedicated development** database and Redis. Never put production credentials in env files.

## Files

| File                  | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `.env.example`        | Defaults / docs (safe to commit)                      |
| `.env` / `.env.local` | Local defaults (gitignored)                           |
| `.env.test-cloud`     | Cloud `DATABASE_URL` + `REDIS_CLOUD_URL` (gitignored) |

## REDIS_MODE (Redis only)

```env
# Local DB + local Redis
DATABASE_URL=postgresql://stockpred:stockpred@localhost:5433/stockpred?schema=public
REDIS_MODE=default
REDIS_LOCAL_URL=redis://localhost:6379

# Local DB + Upstash
REDIS_MODE=test-cloud
REDIS_CLOUD_URL=rediss://default:…@….upstash.io:6379

# Supabase + local Redis
DATABASE_URL=<SUPABASE_SESSION_POOLER>
REDIS_MODE=default

# Supabase + Upstash
DATABASE_URL=<SUPABASE_SESSION_POOLER>
REDIS_MODE=test-cloud
REDIS_CLOUD_URL=rediss://…
```

`getRedisUrl()` in `packages/shared-utils/src/env.ts` is the only Redis selector used by MDS.

## Platform commands

```bash
npm run env:local
npm run env:test-cloud

npm run start:all          # local Postgres + Redis (REDIS_MODE=default) + Kafka + apps
npm run start:all-cloud    # Supabase DATABASE_URL + Redis per REDIS_MODE + local Kafka

npm run with:local -- <command>
npm run with:test-cloud -- <command>
npm run prisma:migrate:test-cloud
```

`start:all-cloud` loads `.env` then overlays `.env.test-cloud` (via `scripts/export-stockpred-env.js`).
It always uses cloud `DATABASE_URL`. Redis follows `REDIS_MODE` independently.

Universe membership downloads (NSE/BSE/US/crypto) run **only when local cache is missing**:
`equity-master.json` + `NSE_ALL` / `US_ALL` / `CRYPTO_SPOT_ALL` active snapshots.
If those files already look complete, start skips the HTTP downloads.

```bash
npm run universe:cache-status          # inspect cache
FORCE_UNIVERSE_INGEST=1 npm run start:all-cloud   # force refresh on boot
npm run ingest:universes:test-cloud    # dedicated refresh against .env.test-cloud
```

## Config helpers

- `getAppEnv()` / `requireDatabaseUrl()`
- `getRedisMode()` / `getRedisUrl()`
- `getKafkaBrokers()` / `getKafkaClientId()` / `getKafkaSecurityProtocol()`

No provider-specific APIs.

## Later (not this slice)

OCI, CI/CD, production Kafka — deferred until explicitly authorized.
