# Hybrid free-tier development (Phases 1–5)

#

# Local: all apps + Kafka

# Cloud (you fill .env.local — never commit): managed Postgres + Redis URLs

#

# Providers are configuration only. Application code must not branch on

# "supabase", "upstash", etc. — only DATABASE*URL / REDIS_URL / KAFKA*\*.

## Prerequisites

1. Free managed **development** Postgres project → **Session pooler** URI as `DATABASE_URL`
   (IPv4 `aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`, `sslmode=require`).
   Do **not** use `db.<project>.supabase.co:5432` — that host is IPv6-only and Docker Desktop
   cannot reach it (`P1001 Can't reach database server`).
2. Free managed **development** Redis project → connection string as `REDIS_URL`
3. Docker Desktop for local Kafka
4. Node 20+ / npm 10+

Use a **dedicated development** database and Redis. Never put production credentials in `.env.local`.

## Files

| File                  | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `.env.example`        | Defaults / docs (safe to commit)                                                 |
| `.env` / `.env.local` | **Default local** — Postgres `localhost` + Redis `redis://localhost:6379`        |
| `.env.test-cloud`     | **test-cloud** — Supabase Session pooler Postgres + Upstash Redis (`rediss://…`) |

`npm run start:all-cloud` loads env via Node (`scripts/export-stockpred-env.js`), not bash `source`.
Unquoted `&` in `sslmode=require` would otherwise truncate `DATABASE_URL` and leave the localhost value from `.env`.

```bash
# Show which hosts the profile resolves to
npm run env:local
npm run env:test-cloud

# Full platform
npm run start:all          # local Postgres + Redis + Kafka + apps
npm run start:all-cloud    # Supabase + Upstash + local Kafka + apps (.env.test-cloud)

# Run any one-off command under a profile
npm run with:local -- <command>
npm run with:test-cloud -- <command>

# Prisma against cloud DB only
npm run prisma:migrate:test-cloud
```

`start:all-cloud` loads `.env` then overlays `.env.test-cloud`, starts **Kafka only** (stops local postgres/redis), and injects cloud `DATABASE_URL` / `REDIS_URL` into app containers via `docker-compose.test-cloud.yml`.

It forces **`STOCK_UNIVERSE_MODE=full-universe`** (override only with `ALLOW_CLOUD_QUICK_START=1`), refreshes **`equity-master.json`** via `npm run ingest:listings`, runs migrate/seed, then runs **canonical universe ingest** (`NSE_ALL` / US / forex / crypto / futures gates) **while apps are paused** so the Session pooler has free slots. Local `postgres`/`redis` use Compose profile `local-infra` in the overlay so a full apps `up` does not start them.

Supabase free **Session pooler** allows ~15 clients. The overlay caps Prisma `connection_limit` (MDS default 2, other services 1). Migrate uses detached + `compose wait` (Compose TUI does not hang on Windows).

Day-to-day default remains local: `npm run start:all`.

## Compose commands

```bash
npm run infra:dev-cloud          # up kafka
npm run infra:dev-cloud:down     # tear down kafka stack
docker compose -f docker-compose.dev-cloud.yml ps
```

Full local infra (Postgres + Redis + Kafka on Docker) if you are not using cloud URLs yet:

```bash
docker compose up -d postgres redis kafka
```

Do **not** mix: if `DATABASE_URL` points at cloud, stop local `postgres` (and local `redis` when using cloud Redis).

## Prisma

Migrations always use `DATABASE_URL`:

```bash
npm run prisma:migrate    # migrate deploy
npm run prisma:generate
```

Target the **development** project only from your laptop.

## Config helpers

[`packages/shared-utils/src/env.ts`](../packages/shared-utils/src/env.ts):

- `getAppEnv()`
- `requireDatabaseUrl()` / `requireRedisUrl()`
- `getKafkaBrokers()` / `getKafkaClientId()` / `getKafkaSecurityProtocol()`

No provider-specific APIs.

## Validation checklist

- [ ] `.env.local` exists and is gitignored
- [ ] Kafka healthy on `localhost:29092`
- [ ] `npm run prisma:migrate` succeeds against development `DATABASE_URL`
- [ ] A service can connect using `REDIS_URL`
- [ ] No production credentials in `.env.local`
- [ ] Application code has no `if (provider === ...)` infra branches

## Later (not this slice)

OCI production host, Cloudflare, CI/CD, managed production Kafka — deferred until Phases 1–5 PASS and you authorize the next slice.
