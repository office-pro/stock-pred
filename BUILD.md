# Build Scripts & Testing Guide

## Overview

StockPred includes multiple build scripts to validate and build all services. All services have been verified to build successfully.

## Quick Start

### Build All Services

```bash
# Standard build
npm run build

# With verification checks
npm run build:check

# Clean build + tests
npm run build:check:full

# With linting
npm run build:check:test
```

## Available Build Scripts

### npm scripts (cross-platform)

```bash
npm run build              # Standard build (packages + apps)
npm run build:packages     # Only build shared libraries
npm run build:apps         # Only build microservices
npm run build:check        # Full validation with lint
npm run build:check:test   # Full build + run tests
npm run build:check:clean  # Clean + rebuild everything
npm run build:check:full   # Clean + rebuild + test (slowest)
```

### Standalone Scripts

#### Windows

```batch
scripts\build-all.bat              # Basic build
scripts\build-all.bat --test       # Build with tests
scripts\build-all.bat --clean      # Clean rebuild
```

#### macOS/Linux

```bash
scripts/build-all.sh               # Basic build
scripts/build-all.sh --test        # Build with tests
scripts/build-all.sh --clean       # Clean rebuild
```

#### Cross-platform (Node.js)

```bash
node scripts/build-all.js          # Basic build
node scripts/build-all.js --test   # Build with tests
node scripts/build-all.js --clean  # Clean rebuild
```

## Build System Architecture

### Workspaces (monorepo)

- **packages/** - Shared libraries
  - `@stockpred/shared-types` - TypeScript type definitions
  - `@stockpred/shared-utils` - Utility functions
  - `@stockpred/shared-events` - Event definitions
  - `@stockpred/database` - Prisma ORM & migrations
  - `@stockpred/broker-sdk` - Broker integration SDKs

- **apps/** - Microservices
  - `auth-service` - Authentication & JWT (port 3001)
  - `market-data-service` - Stock data aggregation (port 3002)
  - `signal-engine` - Trading signal generation (port 3003)
  - `pattern-engine` - Chart pattern recognition (port 3004)
  - `backtest-service` - Backtesting engine (port 3005)
  - `auto-trader` - Paper trading executor (port 3006)
  - `notification-service` - Alert notifications (port 3007)
  - `api-gateway` - REST API proxy (port 3000)
  - `frontend-react` - Web UI (port 8080)
  - `ml-engine` - ML predictions (port 8000)

## Build Status

### ✅ All Services Verified

| Service              | Status    | Port |
| -------------------- | --------- | ---- |
| api-gateway          | ✓ Running | 3000 |
| auth-service         | ✓ Running | 3001 |
| market-data-service  | ✓ Running | 3002 |
| signal-engine        | ✓ Running | 3003 |
| pattern-engine       | ✓ Running | 3004 |
| backtest-service     | ✓ Running | 3005 |
| auto-trader          | ✓ Running | 3006 |
| notification-service | ✓ Running | 3007 |
| ml-engine            | ✓ Running | 8000 |
| frontend             | ✓ Running | 8080 |

### Infrastructure

| Service    | Status    |
| ---------- | --------- |
| PostgreSQL | ✓ Healthy |
| Redis      | ✓ Healthy |
| Kafka      | ✓ Healthy |

## Testing

### Run All Tests

```bash
npm run test                 # Run tests in all workspaces
npm run test:coverage        # Generate coverage reports
```

### Test Specific Service

```bash
npm test -w @stockpred/signal-engine
npm test -w @stockpred/market-data-service
```

## Linting & Code Quality

```bash
npm run lint              # Check all code
npm run lint:fix          # Auto-fix linting issues
npm run format            # Format code with Prettier
npm run format:check      # Check formatting
```

## Docker Deployment

### Start All Services

```bash
npm run start:all         # Start with Docker
npm run start:all-stocks  # Start with all stocks enabled
```

### Manage Services

```bash
npm run stop:all          # Stop all services
npm run restart:all       # Restart all services
docker compose logs -f    # View logs
```

## Build Performance

Typical build times (clean build):

- Package build: ~15s
- App build: ~45-50s
- Total: ~65s (without tests)
- With tests: ~90-120s

## Fixed Issues

### Issue: TypeScript compilation error

**Error:** `'withRetry' is declared but its value is never read`
**Location:** `apps/signal-engine/src/signals/candle-store.ts:4`
**Solution:** Removed unused import

**Status:** ✅ FIXED

## Troubleshooting

### Build fails with npm timeout

```bash
npm config set fetch-timeout 600000
npm run build:check:clean
```

### Docker build fails

```bash
# Clean Docker cache
docker system prune -a
npm run start:all
```

### Port already in use

```bash
npm run stop:all
# Wait a few seconds
npm run start:all
```

## CI/CD Integration

These scripts are used in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Build All Services
  run: npm run build:check:full
```

## Next Steps

1. **Run the platform:** `npm run start:all`
2. **Access services:**
   - Frontend: http://localhost:8080
   - API Gateway: http://localhost:3000
   - ML Engine: http://localhost:8000/health

3. **Monitor logs:** `docker compose logs -f <service-name>`

4. **Run backtest:** `npm run backtest -- --symbol RELIANCE --years 3`

5. **Train ML models:** `npm run train:ml` or `npm run train:ml:docker`

## Support

For build issues:

1. Check build output with `npm run build:check --verbose`
2. Review Docker logs: `docker compose logs <service>`
3. Ensure Node 20+ and Docker are installed
4. Run `npm run clean` to reset state
