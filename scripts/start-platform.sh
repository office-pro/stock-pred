#!/usr/bin/env bash
# StockPred platform startup (spec):
# 1. Start Docker services  2. Redis  3. Kafka  4. PostgreSQL
# 5. Run migrations  6. Seed database  7. Start all microservices
# 8. Verify health checks
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> StockPred platform starting"

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
  echo "ERROR: Docker engine is not running (pipe dockerDesktopLinuxEngine missing)." >&2
  echo "Start Docker Desktop, wait until it is idle, then re-run npm run start:all." >&2
  exit 1
}

wait_for_docker

# Local `npm start` / orphaned node processes bind the same ports as Docker services.
# Must not kill com.docker.backend (it owns published container ports).
echo "==> Freeing local dev ports before Docker start"
node scripts/free-platform-ports.js || true
wait_for_docker

if [ ! -f .env ]; then
  echo "==> No .env found; creating one from .env.example"
  cp .env.example .env
fi

# Export .env for compose substitution + visible startup config
set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a
echo "==> Config: STOCK_UNIVERSE_MODE=${STOCK_UNIVERSE_MODE:-quick-start} MARKET_DATA_PROVIDER=${MARKET_DATA_PROVIDER:-yahoo} SKIP_ML_BOOTSTRAP=${SKIP_ML_BOOTSTRAP:-0}"

# Configure npm to prevent timeout during Docker build
echo "==> Configuring npm (increasing timeout for Docker build)"
npm config set fetch-timeout 600000 2>/dev/null || true
npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true

# 1-4: infrastructure (Postgres, Redis, Kafka)
echo "==> Starting infrastructure (postgres, redis, kafka)"
docker compose up -d postgres redis kafka

echo "==> Waiting for infrastructure health"
for service in postgres redis kafka; do
  for i in $(seq 1 60); do
    status=$(docker compose ps --format '{{.Health}}' "$service" 2>/dev/null || echo "")
    if [ "$status" = "healthy" ]; then
      echo "    $service: healthy"
      break
    fi
    if [ "$i" = "60" ]; then
      echo "ERROR: $service failed to become healthy" >&2
      docker compose logs "$service" | tail -50
      exit 1
    fi
    sleep 2
  done
done

# 5-7: migrations + seed + all microservices (the migrate one-shot runs first)
# Clear any half-created one-shot container left behind by an interrupted run.
docker compose --profile apps rm -fs migrate >/dev/null 2>&1 || true

RUNNING_APPS="$(docker compose --profile apps ps --status running -q 2>/dev/null | wc -l | tr -d ' ')"
if [ "${FORCE_PLATFORM_BUILD:-0}" != "1" ] && [ "${RUNNING_APPS:-0}" -ge 8 ]; then
  echo "==> App containers already running ($RUNNING_APPS) — refreshing without image rebuild"
  echo "    (set FORCE_PLATFORM_BUILD=1 to force docker compose --build)"
  wait_for_docker
  node scripts/free-platform-ports.js || true
  docker compose --profile apps up -d --remove-orphans
else
echo "==> Building and starting all services (this builds images on first run)"

# Build with retry logic (npm timeout during build is common on first run).
# Full --profile apps rebuild (10 Node images + frontend + ml-engine) often
# exceeds 10 minutes on Windows/Docker Desktop; killing mid-build wastes cache.
BUILD_RETRIES=3
BUILD_ATTEMPT=1
BUILD_TIMEOUT="${BUILD_TIMEOUT:-1800}"  # 30 minutes per attempt (override via env)
while [ $BUILD_ATTEMPT -le $BUILD_RETRIES ]; do
  echo "    [Attempt $BUILD_ATTEMPT/$BUILD_RETRIES] Building Docker images (timeout: ${BUILD_TIMEOUT}s)..."
  wait_for_docker
  # Local `npm start` can reclaim ports during a long image build.
  node scripts/free-platform-ports.js || true
  if timeout $BUILD_TIMEOUT docker compose --profile apps up -d --build; then
    echo "    ✅ Build succeeded"
    break
  else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "    ⚠️  Build timed out after ${BUILD_TIMEOUT}s (attempt $BUILD_ATTEMPT/$BUILD_RETRIES)"
    else
      echo "    ⚠️  Build failed with exit code $EXIT_CODE (attempt $BUILD_ATTEMPT/$BUILD_RETRIES)"
    fi
    if [ $BUILD_ATTEMPT -lt $BUILD_RETRIES ]; then
      echo "    Retrying in 10 seconds (keeping image cache; not tearing the stack down)..."
      sleep 10
    else
      echo "    ❌ Build failed after $BUILD_RETRIES attempts"
      echo "    Check logs with: docker compose logs --tail 100"
      exit 1
    fi
  fi
  BUILD_ATTEMPT=$((BUILD_ATTEMPT + 1))
done
fi

# 8: verify health checks
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

# Check for crashed services before health checks
echo "==> Checking service status..."
crashed=0
for name in api-gateway auth-service market-data-service signal-engine pattern-engine backtest-service auto-trader notification-service ml-engine; do
  container_status=$(docker compose ps --format '{{.Status}}' "$name" 2>/dev/null || echo "")
  if [ -z "$container_status" ]; then
    echo "    $name: NOT STARTED"
  elif echo "$container_status" | grep -q "Exited"; then
    echo "    $name: CRASHED - $(docker compose logs --tail 5 "$name" 2>&1 | tail -1)"
    crashed=$((crashed + 1))
  else
    echo "    $name: $container_status"
  fi
done

if [ "$crashed" -gt 0 ]; then
  echo "ERROR: $crashed service(s) crashed. Check logs with: docker compose logs <service>"
  exit 1
fi

# Check market-data-service first (max 180s = 90 retries × 2s)
# It has dependencies on postgres, redis, kafka, and migrate, so it needs extra time
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
  docker compose logs --tail 20 market-data-service
  exit 1
fi

# Check remaining services (max 90s per service)
echo "==> Verifying remaining services (max 90s each)..."
failures=0
for name in "${!endpoints[@]}"; do
  if [ "$name" = "market-data-service" ]; then
    continue  # Already checked
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
  echo "Run 'docker compose logs <service>' to debug"
fi

# Train + predict the configured universe once services can serve history.
# SKIP_ML_BOOTSTRAP=1 skips this (start stays fast; run npm run train:ml:all later).
bash scripts/ml-bootstrap.sh

echo ""
echo "==> StockPred is up:"
echo "    Frontend:     http://localhost:8080"
echo "    API Gateway:  http://localhost:3000"
echo "    ML Engine:    http://localhost:8000/health"
echo ""
echo "    Train ML models:   npm run train:ml:all"
echo "    Predict all names: npm run predict:ml:all"
echo "    Run a backtest:    npm run backtest -- --symbol RELIANCE --years 3"
echo ""
echo "==> Useful commands:"
echo "    View logs:         docker compose logs -f <service>"
echo "    Stop services:     npm run stop:all"
echo "    Restart services:  npm run restart:all"
echo ""
echo "This is not investment advice. Paper trading is enabled by default."
