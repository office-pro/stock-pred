#!/usr/bin/env bash
# Comprehensive diagnostics and cleanup script for StockPred platform
# Usage: npm run clean
#        npm run clean -- --full  (full cleanup + restart)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

cd "$(dirname "$0")/.."

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  StockPred Platform - Diagnostics & Cleanup              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Docker is running
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker not found${NC}"
  exit 1
fi

if ! docker ps >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker daemon not running${NC}"
  echo "Please start Docker Desktop and try again"
  exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"
echo ""

# ============================================================================
# DIAGNOSIS SECTION
# ============================================================================

echo -e "${BLUE}=== DIAGNOSIS ===${NC}"
echo ""

# 1. Check container status
echo -e "${YELLOW}1. Container Status:${NC}"
echo "────────────────────────"
docker compose ps 2>/dev/null | tail -n +2 || echo "  (No containers running)"
echo ""

# 2. Check infrastructure health
echo -e "${YELLOW}2. Infrastructure Health:${NC}"
echo "────────────────────────"
for service in postgres redis kafka; do
  status=$(docker compose ps --format '{{.Health}}' "$service" 2>/dev/null || echo "unknown")
  if [ "$status" = "healthy" ]; then
    echo -e "  ${GREEN}✓${NC} $service: healthy"
  else
    echo -e "  ${RED}✗${NC} $service: $status"
  fi
done
echo ""

# 3. Check service logs for errors
echo -e "${YELLOW}3. Recent Service Logs (last 20 lines):${NC}"
echo "────────────────────────"

FAILED_SERVICES=()
for service in api-gateway auth-service market-data-service signal-engine pattern-engine backtest-service auto-trader notification-service; do
  # Check if container exists
  if docker compose ps --services --filter "status=running" 2>/dev/null | grep -q "^$service\$"; then
    # Check for errors in logs
    if docker compose logs "$service" 2>/dev/null | grep -i "error\|failed\|exception" >/dev/null; then
      FAILED_SERVICES+=("$service")
      echo -e "${RED}✗ $service:${NC} Has errors"
      docker compose logs "$service" 2>/dev/null | grep -i "error\|failed\|exception" | head -3 | sed 's/^/    /'
    else
      echo -e "${GREEN}✓${NC} $service: OK"
    fi
  else
    echo -e "${YELLOW}⊘${NC} $service: Not running"
  fi
done
echo ""

# 4. Check connectivity
echo -e "${YELLOW}4. Service Connectivity:${NC}"
echo "────────────────────────"
declare -A endpoints=(
  [api-gateway]="http://localhost:3000/health"
  [auth-service]="http://localhost:3001/health"
  [market-data-service]="http://localhost:3002/health"
)

for name in "${!endpoints[@]}"; do
  url="${endpoints[$name]}"
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $name: responding"
  else
    echo -e "  ${RED}✗${NC} $name: not responding ($url)"
  fi
done
echo ""

# 5. Check disk space & resources
echo -e "${YELLOW}5. System Resources:${NC}"
echo "────────────────────────"
DOCKER_SIZE=$(docker system df 2>/dev/null | grep -E "^Containers|^Images|^Volumes" | head -3 | awk '{print $2, $3, $4, $5}' || echo "  N/A")
echo "  Docker usage:"
echo "$DOCKER_SIZE" | sed 's/^/    /'
echo ""

# ============================================================================
# RECOMMENDATIONS
# ============================================================================

echo -e "${BLUE}=== RECOMMENDATIONS ===${NC}"
echo ""

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
  echo -e "${RED}Services with errors:${NC} ${FAILED_SERVICES[*]}"
  echo "  → Run: docker compose logs <service-name> -f"
  echo ""
fi

# Check if full cleanup was requested
FULL_CLEANUP=${1:-}

if [ "$FULL_CLEANUP" = "--full" ]; then
  echo -e "${YELLOW}=== PERFORMING FULL CLEANUP ===${NC}"
  echo ""

  echo "Stopping all services..."
  docker compose down -v --remove-orphans 2>/dev/null || true
  echo -e "${GREEN}✓ All containers stopped${NC}"
  echo ""

  echo "Removing dangling Docker resources..."
  docker system prune -f --volumes 2>/dev/null || true
  echo -e "${GREEN}✓ Cleaned up Docker resources${NC}"
  echo ""

  echo "Reconfiguring npm..."
  npm config set fetch-timeout 600000 2>/dev/null || true
  npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
  npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
  echo -e "${GREEN}✓ npm configured${NC}"
  echo ""

  echo -e "${YELLOW}=== RESTARTING PLATFORM ===${NC}"
  echo ""
  npm run start:all

else
  echo -e "${YELLOW}Quick Actions:${NC}"
  echo "  • View service logs:      docker compose logs <service> -f"
  echo "  • Restart platform:       npm run restart:all"
  echo "  • Full cleanup & restart: npm run clean -- --full"
  echo "  • Stop all services:      npm run stop:all"
  echo ""
  echo -e "${YELLOW}Detailed Troubleshooting:${NC}"
  echo "  • Database issues:        docker compose logs postgres"
  echo "  • Market data issues:     docker compose logs market-data-service"
  echo "  • Check port conflicts:   netstat -ano | findstr :3000 (Windows)"
  echo "  • Full documentation:     cat NPM_TIMEOUT_FIX.md"
  echo ""
fi

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
