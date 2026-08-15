#!/usr/bin/env bash
# Build all services with validation and optional testing
# Usage: ./scripts/build-all.sh [--test] [--clean] [--fast]

set -euo pipefail
cd "$(dirname "$0")/.."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
TEST_ENABLED=false
CLEAN_BUILD=false
FAST_BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --test) TEST_ENABLED=true; shift ;;
    --clean) CLEAN_BUILD=true; shift ;;
    --fast) FAST_BUILD=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo -e "${BLUE}=== StockPred Build System ===${NC}"
echo "TEST: $TEST_ENABLED | CLEAN: $CLEAN_BUILD | FAST: $FAST_BUILD"
echo ""

# Clean if requested
if [ "$CLEAN_BUILD" = true ]; then
  echo -e "${YELLOW}Cleaning build artifacts...${NC}"
  find apps packages -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
  find apps packages -name ".turbo" -type d -exec rm -rf {} + 2>/dev/null || true
fi

# Build packages (shared dependencies)
echo -e "${BLUE}1. Building packages (shared libraries)${NC}"
npm run build:packages 2>&1 | tail -20
echo -e "${GREEN}✓ Packages built${NC}"
echo ""

# Build apps
echo -e "${BLUE}2. Building apps${NC}"
npm run build:apps 2>&1 | tail -20
echo -e "${GREEN}✓ Apps built${NC}"
echo ""

# Run tests if requested
if [ "$TEST_ENABLED" = true ]; then
  echo -e "${BLUE}3. Running tests${NC}"
  npm run test 2>&1 | tail -50
  echo -e "${GREEN}✓ Tests passed${NC}"
  echo ""
fi

# Validate TypeScript
echo -e "${BLUE}4. TypeScript validation${NC}"
npm run build 2>&1 | grep -E "(error|✓ built)" | tail -5
echo -e "${GREEN}✓ TypeScript validated${NC}"
echo ""

# Summary
echo -e "${GREEN}=== Build Complete ===${NC}"
echo ""
echo "Services built:"
echo "  ✓ api-gateway"
echo "  ✓ auth-service"
echo "  ✓ market-data-service"
echo "  ✓ signal-engine"
echo "  ✓ pattern-engine"
echo "  ✓ backtest-service"
echo "  ✓ auto-trader"
echo "  ✓ notification-service"
echo "  ✓ frontend-react"
echo ""
echo "Next steps:"
echo "  npm run start:all      - Start Docker platform"
echo "  npm run stop:all       - Stop Docker platform"
echo "  npm run restart:all    - Restart Docker platform"
if [ "$TEST_ENABLED" = true ]; then
  echo ""
  echo -e "${YELLOW}Note: Tests were run during this build${NC}"
fi
