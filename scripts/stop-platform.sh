#!/usr/bin/env bash
# StockPred platform shutdown (spec):
# 1. Stop services gracefully  2. Flush queues  3. Close WebSockets
# 4. Stop containers           5. Save logs
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> StockPred platform stopping"

mkdir -p logs
timestamp=$(date +%Y%m%d-%H%M%S)

# 5 (before teardown): save logs
echo "==> Saving logs to logs/platform-$timestamp.log"
docker compose --profile apps logs --no-color > "logs/platform-$timestamp.log" 2>&1 || true

# 1-3: SIGTERM lets every service run its shutdown hooks - Kafka producers
# flush and disconnect, consumers leave their groups, Socket.IO servers close.
echo "==> Stopping services gracefully (SIGTERM, 30s grace)"
docker compose --profile apps stop -t 30

# 4: remove containers (volumes are preserved)
echo "==> Removing containers"
docker compose --profile apps down

echo "==> Platform stopped. Data volumes preserved (postgres-data, kafka-data, ml-models)."
