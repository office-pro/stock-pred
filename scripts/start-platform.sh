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
docker compose --profile apps up -d --build

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
failures=0
for name in "${!endpoints[@]}"; do
  url="${endpoints[$name]}"
  ok=0
  for i in $(seq 1 45); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  if [ "$ok" = "1" ]; then
    echo "    $name: OK"
  else
    echo "    $name: FAILED ($url)"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "WARNING: $failures service(s) failed health checks. Inspect with: docker compose logs <service>"
  exit 1
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
echo "This is not investment advice. Paper trading is enabled by default."
