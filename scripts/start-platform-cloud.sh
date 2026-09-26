#!/usr/bin/env bash
# StockPred platform startup - TEST-CLOUD profile
# Local Kafka + apps; Postgres/Redis from `.env.test-cloud` (Supabase + Upstash).
# Default local path remains: npm run start:all
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.test-cloud.yml)
# Disable Compose interactive menu (w/d prompts) - hangs Git Bash / non-TTY startups on Windows.
export COMPOSE_MENU=0

echo "==> StockPred platform starting (test-cloud: Supabase + Upstash + local Kafka)"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required. Install Docker Desktop / Engine first." >&2
  exit 1
fi

docker_engine_ready() {
  local ver
  ver="$(docker info --format '{{.ServerVersion}}' 2>/dev/null || true)"
  [ -n "$ver" ]
}

try_start_docker_desktop() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      local desktop=""
      for candidate in \
        "/c/Program Files/Docker/Docker/Docker Desktop.exe" \
        "/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe"
      do
        if [ -x "$candidate" ] || [ -f "$candidate" ]; then
          desktop="$candidate"
          break
        fi
      done
      if [ -n "$desktop" ]; then
        echo "==> Docker engine is down; launching Docker Desktop"
        "$desktop" >/dev/null 2>&1 &
      fi
      ;;
  esac
}

wait_for_docker() {
  if docker_engine_ready; then
    echo "==> Docker engine: ready"
    return 0
  fi
  try_start_docker_desktop
  echo "==> Waiting for Docker engine (start Docker Desktop if it is not running)"
  local i
  for i in $(seq 1 60); do
    if docker_engine_ready; then
      echo "    Docker engine: ready"
      return 0
    fi
    echo "    not ready ($i/60)..."
    sleep 3
  done
  echo "ERROR: Docker engine is not running." >&2
  echo "Start Docker Desktop, wait until it is idle, then re-run npm run start:all-cloud." >&2
  exit 1
}

wait_for_docker

echo "==> Freeing local dev ports before Docker start"
node scripts/free-platform-ports.js || true
wait_for_docker

if [ ! -f .env ]; then
  echo "==> No .env found; creating one from .env.example"
  cp .env.example .env
fi

if [ ! -f .env.test-cloud ]; then
  echo "ERROR: .env.test-cloud missing." >&2
  echo "Create it with Supabase DATABASE_URL (and REDIS_CLOUD_URL when REDIS_MODE=test-cloud)." >&2
  exit 1
fi

# Local defaults, then cloud overlay (cloud wins for DATABASE_URL).
# Redis is selected only via REDIS_MODE + REDIS_LOCAL_URL / REDIS_CLOUD_URL.
# Do NOT `source` .env files: unquoted `&` in sslmode=require truncates the value
# and leaves the previous localhost DATABASE_URL from .env in place.
# shellcheck disable=SC1091
eval "$(node scripts/export-stockpred-env.js test-cloud)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL must be set (typically in .env.test-cloud for start:all-cloud)." >&2
  exit 1
fi

REDIS_MODE="${REDIS_MODE:-test-cloud}"
export REDIS_MODE

if [ "${REDIS_MODE}" = "test-cloud" ]; then
  if [ -z "${REDIS_CLOUD_URL:-}" ] && [ -n "${REDIS_URL:-}" ]; then
    # Backward-compatible: older .env.test-cloud used REDIS_URL for Upstash.
    export REDIS_CLOUD_URL="${REDIS_URL}"
  fi
  if [ -z "${REDIS_CLOUD_URL:-}" ]; then
    echo "ERROR: REDIS_MODE=test-cloud requires REDIS_CLOUD_URL (Upstash rediss://...)." >&2
    exit 1
  fi
elif [ "${REDIS_MODE}" != "default" ]; then
  echo "ERROR: Invalid REDIS_MODE=${REDIS_MODE}. Expected default or test-cloud." >&2
  exit 1
fi

db_host="$(node scripts/cloud-env-host.js database)"
redis_host="$(node scripts/cloud-env-host.js redis)"

# Refuse accidental local docker hostnames inside the cloud DB profile (host only).
case "${db_host}" in
  postgres|localhost|127.0.0.1|host.docker.internal)
    echo "ERROR: DATABASE_URL host '${db_host}' still looks local. Use your Supabase Session pooler URI." >&2
    exit 1
    ;;
esac
# Direct db.*.supabase.co is IPv6-only. Docker Desktop on Windows cannot reach it
# (Prisma P1001). Use the Session pooler (IPv4, port 5432), not Transaction 6543.
case "${db_host}" in
  db.*.supabase.co)
    echo "ERROR: DATABASE_URL uses the IPv6-only db.*.supabase.co host (${db_host})." >&2
    echo "In Supabase: Connect â†’ Session pooler (port 5432)." >&2
    echo "User must be postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432" >&2
    echo "Add sslmode=require. Do not use the direct db.<ref>.supabase.co:5432 URI." >&2
    exit 1
    ;;
esac

if [ "${REDIS_MODE}" = "test-cloud" ]; then
  case "${REDIS_CLOUD_URL}" in
    *redis:6379*|*localhost:6379*|redis://redis*|redis://localhost*|rediss://localhost*)
      echo "ERROR: REDIS_CLOUD_URL still looks local. Use your Upstash rediss:// URI." >&2
      exit 1
      ;;
  esac
fi

export STOCKPRED_ENV_PROFILE=test-cloud
# Cloud profile always boots the full equity master (not quick-start ~129).
# Override only with STOCK_UNIVERSE_MODE=quick-start in the shell if you need a fast smoke.
if [ "${STOCK_UNIVERSE_MODE:-}" = "quick-start" ] && [ "${ALLOW_CLOUD_QUICK_START:-0}" != "1" ]; then
  echo "==> Overriding STOCK_UNIVERSE_MODE=quick-start â†’ full-universe for start:all-cloud"
  echo "    (set ALLOW_CLOUD_QUICK_START=1 to keep quick-start)"
fi
if [ "${ALLOW_CLOUD_QUICK_START:-0}" != "1" ]; then
  export STOCK_UNIVERSE_MODE=full-universe
fi
echo "==> Profile: test-cloud (DATABASE_URL from .env.test-cloud; Redis via REDIS_MODE=${REDIS_MODE})"
echo "==> Config: STOCK_UNIVERSE_MODE=${STOCK_UNIVERSE_MODE:-full-universe} MARKET_DATA_PROVIDER=${MARKET_DATA_PROVIDER:-yahoo}"
echo "==> DB host: ${db_host}"
echo "==> Redis mode/host: ${REDIS_MODE} / ${redis_host}"

echo "==> Configuring npm (increasing timeout for Docker build)"
npm config set fetch-timeout 600000 2>/dev/null || true
npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true

# Local Postgres is never used for start:all-cloud.
echo "==> Stopping local postgres (if running) - DATABASE_URL is cloud"
"${COMPOSE[@]}" --profile local-infra stop postgres >/dev/null 2>&1 || true
docker compose stop postgres >/dev/null 2>&1 || true

if [ "${REDIS_MODE}" = "test-cloud" ]; then
  echo "==> Stopping local redis (if running) - REDIS_MODE=test-cloud uses REDIS_CLOUD_URL"
  "${COMPOSE[@]}" --profile local-infra stop redis >/dev/null 2>&1 || true
  docker compose stop redis >/dev/null 2>&1 || true
  # Compose containers need an explicit in-network local URL only for default mode.
  export REDIS_LOCAL_URL="${REDIS_LOCAL_URL:-redis://redis:6379}"
else
  echo "==> Starting local redis - REDIS_MODE=default"
  export REDIS_LOCAL_URL="${REDIS_LOCAL_URL:-redis://redis:6379}"
  "${COMPOSE[@]}" --profile local-infra up -d redis
fi

# Count app containers before pause (stop clears "running", but images may exist).
EXISTING_APP_CONTAINERS="$("${COMPOSE[@]}" --profile apps ps -aq 2>/dev/null | wc -l | tr -d ' ')"

# Supabase Session pooler free tier â‰ˆ 15 clients. Running apps hold those slots
# and migrate/seed then fails with EMAXCONNSESSION. Pause DB clients first.
CLOUD_DB_APPS=(
  auth-service market-data-service signal-engine pattern-engine
  backtest-service auto-trader trader-agent notification-service
  api-gateway ml-engine frontend
)
echo "==> Pausing app containers so migrate can use the Session pooler"
"${COMPOSE[@]}" stop "${CLOUD_DB_APPS[@]}" >/dev/null 2>&1 || true

echo "==> Starting Kafka only (cloud DB/Redis)"
"${COMPOSE[@]}" up -d kafka

echo "==> Waiting for Kafka health"
for i in $(seq 1 60); do
  status=$("${COMPOSE[@]}" ps --format '{{.Health}}' kafka 2>/dev/null || echo "")
  if [ "$status" = "healthy" ]; then
    echo "    kafka: healthy"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "ERROR: kafka failed to become healthy" >&2
    "${COMPOSE[@]}" logs kafka | tail -50
    exit 1
  fi
  sleep 2
done

# Clear prior failed migrate so depends_on service_completed_successfully can pass.
"${COMPOSE[@]}" --profile apps rm -fs migrate >/dev/null 2>&1 || true

# Membership downloads (NSE/BSE/US/crypto) are expensive/rate-limited.
# Skip when local equity-master + active snapshots already look complete.
# Force: FORCE_UNIVERSE_INGEST=1  or  npm run ingest:universes:test-cloud
NEED_UNIVERSE_DOWNLOAD=1
if [ "${FORCE_UNIVERSE_INGEST:-0}" = "1" ]; then
  echo "==> FORCE_UNIVERSE_INGEST=1 — will refresh listings + canonical universes"
elif [ "${SKIP_LISTINGS_INGEST:-0}" = "1" ] && [ "${SKIP_UNIVERSE_INGEST:-0}" = "1" ]; then
  NEED_UNIVERSE_DOWNLOAD=0
  echo "==> Skipping listings + universe ingest (SKIP_LISTINGS_INGEST=1 SKIP_UNIVERSE_INGEST=1)"
elif node scripts/universe-cache-status.js --check; then
  NEED_UNIVERSE_DOWNLOAD=0
  echo "==> Universe cache present — skipping downloads (set FORCE_UNIVERSE_INGEST=1 to refresh)"
else
  echo "==> Universe cache incomplete — will download membership data once"
fi

if [ "${NEED_UNIVERSE_DOWNLOAD}" = "1" ] && [ "${SKIP_LISTINGS_INGEST:-0}" != "1" ]; then
  echo "==> Refreshing equity-master.json (NSE EQ + BSE listings)"
  if ! npm run ingest:listings; then
    echo "WARNING: listings download failed; migrate seed will use whatever equity-master exists." >&2
  fi
elif [ "${NEED_UNIVERSE_DOWNLOAD}" = "1" ]; then
  echo "==> Skipping listings refresh (SKIP_LISTINGS_INGEST=1)"
fi

# Leave migrate container in exited(0) state (required by later depends_on).
# Detached + `compose wait` avoids the attached TUI ("Enable Watch / Detach") hang on Windows.
echo "==> Running migrate + seed against cloud DB (apps paused)"
wait_for_docker
"${COMPOSE[@]}" --profile apps up -d --no-deps migrate
"${COMPOSE[@]}" --profile apps wait migrate || true
migrate_cid="$("${COMPOSE[@]}" --profile apps ps -aq migrate | head -n1)"
migrate_code="$(docker inspect -f '{{.State.ExitCode}}' "${migrate_cid}" 2>/dev/null || echo 1)"
if [ -z "${migrate_cid}" ] || [ "${migrate_code}" != "0" ]; then
  echo "ERROR: migrate/seed failed against Supabase (exit ${migrate_code:-unknown})." >&2
  echo "If you see EMAXCONNSESSION, stop other clients using this project and retry." >&2
  echo "Confirm DATABASE_URL is the Session pooler (port 5432), not Transaction (6543)." >&2
  "${COMPOSE[@]}" logs --tail 40 migrate || true
  exit 1
fi
echo "    migrate: completed successfully"

# Full membership ingest while apps are still paused (Session pooler capacity).
if [ "${NEED_UNIVERSE_DOWNLOAD}" = "1" ] && [ "${SKIP_UNIVERSE_INGEST:-0}" != "1" ]; then
  echo "==> Ingesting canonical universes into cloud DB (apps paused)"
  if ! bash scripts/ingest-universes-on-start.sh; then
    echo "WARNING: universe ingest exited non-zero; continuing platform start" >&2
  fi
elif [ "${NEED_UNIVERSE_DOWNLOAD}" = "1" ]; then
  echo "==> Skipping universe ingest (SKIP_UNIVERSE_INGEST=1)"
fi

if [ "${FORCE_PLATFORM_BUILD:-0}" != "1" ] && [ "${EXISTING_APP_CONTAINERS:-0}" -ge 8 ]; then
  echo "==> App containers already present ($EXISTING_APP_CONTAINERS) - refreshing without image rebuild"
  echo "    (set FORCE_PLATFORM_BUILD=1 to force docker compose --build)"
  wait_for_docker
  node scripts/free-platform-ports.js || true
  "${COMPOSE[@]}" --profile apps up -d --remove-orphans
else
  echo "==> Building and starting all services (test-cloud env injected)"
  BUILD_RETRIES=3
  BUILD_ATTEMPT=1
  BUILD_TIMEOUT="${BUILD_TIMEOUT:-1800}"
  while [ $BUILD_ATTEMPT -le $BUILD_RETRIES ]; do
    echo "    [Attempt $BUILD_ATTEMPT/$BUILD_RETRIES] Building Docker images (timeout: ${BUILD_TIMEOUT}s)..."
    wait_for_docker
    node scripts/free-platform-ports.js || true
    if timeout $BUILD_TIMEOUT "${COMPOSE[@]}" --profile apps up -d --build; then
      echo "    âœ… Build succeeded"
      break
    else
      EXIT_CODE=$?
      if [ $EXIT_CODE -eq 124 ]; then
        echo "    âš ï¸  Build timed out after ${BUILD_TIMEOUT}s (attempt $BUILD_ATTEMPT/$BUILD_RETRIES)"
      else
        echo "    âš ï¸  Build failed with exit code $EXIT_CODE (attempt $BUILD_ATTEMPT/$BUILD_RETRIES)"
      fi
      if [ $BUILD_ATTEMPT -lt $BUILD_RETRIES ]; then
        echo "    Retrying in 10 seconds..."
        sleep 10
      else
        echo "    âŒ Build failed after $BUILD_RETRIES attempts"
        echo "    Check logs with: docker compose -f docker-compose.yml -f docker-compose.test-cloud.yml logs --tail 100"
        exit 1
      fi
    fi
    BUILD_ATTEMPT=$((BUILD_ATTEMPT + 1))
  done
fi

# Belts and braces: local Postgres stays down; Redis only if REDIS_MODE=test-cloud.
"${COMPOSE[@]}" --profile local-infra stop postgres >/dev/null 2>&1 || true
docker compose stop postgres >/dev/null 2>&1 || true
if [ "${REDIS_MODE}" = "test-cloud" ]; then
  "${COMPOSE[@]}" --profile local-infra stop redis >/dev/null 2>&1 || true
  docker compose stop redis >/dev/null 2>&1 || true
fi

echo "==> Verifying service health"
declare -A endpoints=(
  [api-gateway]="http://localhost:3000/health"
  [auth-service]="http://localhost:3001/health"
  [market-data-service]="http://localhost:3002/health"
  [signal-engine]="http://localhost:3003/health"
  [pattern-engine]="http://localhost:3004/health"
  [backtest-service]="http://localhost:3005/health"
  [auto-trader]="http://localhost:3006/health"
  [notification-service]="http://localhost:3007/health"
  [ml-engine]="http://localhost:8000/health"
)

echo "==> Checking service status..."
crashed=0
for name in api-gateway auth-service market-data-service signal-engine pattern-engine backtest-service auto-trader notification-service ml-engine; do
  container_status=$("${COMPOSE[@]}" ps --format '{{.Status}}' "$name" 2>/dev/null || echo "")
  if [ -z "$container_status" ]; then
    echo "    $name: NOT STARTED"
  elif echo "$container_status" | grep -q "Exited"; then
    echo "    $name: CRASHED - $("${COMPOSE[@]}" logs --tail 5 "$name" 2>&1 | tail -1)"
    crashed=$((crashed + 1))
  else
    echo "    $name: $container_status"
  fi
done

if [ "$crashed" -gt 0 ]; then
  echo "ERROR: $crashed service(s) crashed. Check logs with: docker compose logs <service>"
  exit 1
fi

echo "==> Waiting for market-data-service to be healthy (priority - max 180s)..."
ok=0
for i in $(seq 1 90); do
  if curl -fsS --max-time 5 "http://localhost:3002/health" >/dev/null 2>&1; then
    ok=1
    echo "    market-data-service: OK"
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "    market-data-service: waiting... ($((i * 2))s elapsed)"
  fi
  sleep 2
done

if [ "$ok" != "1" ]; then
  echo "ERROR: market-data-service failed to become healthy after 180s"
  "${COMPOSE[@]}" logs --tail 40 market-data-service
  exit 1
fi

echo "==> Verifying remaining services (max 90s each)..."
failures=0
for name in "${!endpoints[@]}"; do
  if [ "$name" = "market-data-service" ]; then
    continue
  fi
  url="${endpoints[$name]}"
  ok=0
  for i in $(seq 1 45); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  if [ "$ok" = "1" ]; then
    echo "    $name: OK"
  else
    echo "    $name: TIMEOUT ($url) - service may not have a health endpoint"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "WARNING: $failures service(s) failed health checks (but may still be running)"
fi

# Universe ingest already ran while apps were paused (Session pooler capacity).

bash scripts/ml-bootstrap.sh

echo ""
echo "==> StockPred is up (test-cloud):"
echo "    Frontend:     http://localhost:8080"
echo "    API Gateway:  http://localhost:3000"
echo "    ML Engine:    http://localhost:8000/health"
echo "    Data plane:   Supabase Postgres + Upstash Redis + local Kafka"
echo "    Universe:     STOCK_UNIVERSE_MODE=${STOCK_UNIVERSE_MODE:-full-universe} + canonical ingest on start"
echo ""
echo "    Back to local infra:  npm run start:all"
echo "    Stop services:        npm run stop:all"
echo ""
