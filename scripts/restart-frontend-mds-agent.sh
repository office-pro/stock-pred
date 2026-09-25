#!/usr/bin/env bash
# Rebuild and recreate only:
#   market-data-service  (MDS candles / quotes)
#   trader-agent         (batch hydrate)
#   frontend             (nginx bundle on :8080)
#
# Does not restart postgres/kafka/api-gateway or rebuild the rest of the stack.
# Usage:
#   bash scripts/restart-frontend-mds-agent.sh
#   npm run restart:ui-agent
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICES=(market-data-service trader-agent frontend)
COMPOSE=(docker compose --profile apps)

echo "==> Quick restart: ${SERVICES[*]}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker engine is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

wait_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-45}"
  local i
  for i in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "    $name: OK ($url)"
      return 0
    fi
    echo "    $name: waiting... (${i}/${attempts})"
    sleep 2
  done
  echo "ERROR: $name did not become ready at $url" >&2
  docker compose logs --tail 30 "$name" || true
  return 1
}

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo "==> Building images (parallel, cache kept)"
"${COMPOSE[@]}" build --parallel "${SERVICES[@]}"

echo "==> Recreating market-data-service"
"${COMPOSE[@]}" up -d --no-deps --force-recreate --no-build market-data-service
wait_http market-data-service "http://localhost:3002/health" 90

echo "==> Recreating trader-agent"
"${COMPOSE[@]}" up -d --no-deps --force-recreate --no-build trader-agent
wait_http trader-agent "http://localhost:3008/health" 45

echo "==> Recreating frontend"
"${COMPOSE[@]}" up -d --no-deps --force-recreate --no-build frontend
wait_http frontend "http://localhost:8080" 30

echo "==> Done"
echo "    frontend             http://localhost:8080"
echo "    market-data-service  http://localhost:3002/health"
echo "    trader-agent         http://localhost:3008/health"
echo "    /batch               http://localhost:8080/batch"
