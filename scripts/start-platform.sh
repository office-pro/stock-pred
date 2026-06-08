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

if [ ! -f .env ]; then
  echo "==> No .env found; creating one from .env.example"
  cp .env.example .env
fi

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
echo "==> Building and starting all services (this builds images on first run)"

# Build with retry logic (npm timeout during build is common on first run)
BUILD_RETRIES=3
BUILD_ATTEMPT=1
BUILD_TIMEOUT=600  # 10 minutes per attempt
while [ $BUILD_ATTEMPT -le $BUILD_RETRIES ]; do
  echo "    [Attempt $BUILD_ATTEMPT/$BUILD_RETRIES] Building Docker images (timeout: ${BUILD_TIMEOUT}s)..."
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
      echo "    Retrying in 10 seconds..."
      sleep 10
      # Clean up any partial containers
      docker compose --profile apps down 2>/dev/null || true
    else
      echo "    ❌ Build failed after $BUILD_RETRIES attempts"
      echo "    Check logs with: docker compose logs --tail 100"
      exit 1
    fi
  fi
  BUILD_ATTEMPT=$((BUILD_ATTEMPT + 1))
done

# 8: verify health checks
echo "==> Verifying service health (max 90s per service)"
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

failures=0
for name in "${!endpoints[@]}"; do
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

echo ""
echo "==> StockPred is up:"
echo "    Frontend:     http://localhost:8080"
echo "    API Gateway:  http://localhost:3000"
echo "    ML Engine:    http://localhost:8000/health"
echo ""
echo "    Train ML models:   npm run train:ml   (or: docker compose exec ml-engine python -m app.train --synthetic)"
echo "    Run a backtest:    npm run backtest -- --symbol RELIANCE --years 3"
echo ""
echo "==> Useful commands:"
echo "    View logs:         docker compose logs -f <service>"
echo "    Stop services:     npm run stop:all"
echo "    Restart services:  npm run restart:all"
echo ""
echo "This is not investment advice. Paper trading is enabled by default."
