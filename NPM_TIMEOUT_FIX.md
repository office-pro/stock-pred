# NPM Timeout Fix for Docker Builds

## Problem

When running `npm run start:all`, the Docker build fails with:

```
npm error code EIDLETIMEOUT
npm error Idle timeout reached for host `registry.npmjs.org:443`
```

This happens because the default npm timeout (5 minutes) is too short when installing 300+ dependencies during the Docker build.

## Solution Implemented

The `npm run start:all` script now:

1. ✅ **Pre-configures npm** with longer timeouts (10 minutes)
2. ✅ **Adds retry logic** for transient network failures
3. ✅ **Retries the build** up to 3 times if Docker build fails
4. ✅ **Cleans up** partial containers between retries

## What Was Changed

### Files Modified

- `scripts/start-platform.sh` - Added npm config + build retry logic
- `package.json` - Added `setup:npm` script

### Files Created

- `scripts/setup-npm.sh` - Manual npm configuration helper

## How to Use

### Option 1: Auto-Configuration (Recommended)

Just run the normal command - npm is configured automatically:

```bash
npm run start:all
```

The script will:

1. Configure npm with longer timeouts
2. Start Docker infrastructure
3. Build and start all services with automatic retries
4. Verify health checks

### Option 2: Pre-Configure npm Once

If you want to configure npm manually first:

```bash
npm run setup:npm
npm run start:all
```

### Option 3: Docker Build Retries

If the build still fails due to network issues, it will automatically retry up to 3 times.

## Technical Details

### NPM Configuration Applied

```bash
fetch-timeout: 600000ms         # 10 minutes (default: 5 minutes)
fetch-retry-mintimeout: 20000ms # Minimum retry delay
fetch-retry-maxtimeout: 120000ms # Maximum retry delay
prefer-offline: true             # Use cached packages when available
```

### Build Retry Logic

- **Attempt 1:** Initial build
- **Attempt 2:** If failed, wait 10s and retry
- **Attempt 3:** If failed again, wait 10s and retry
- **Fail:** After 3 attempts, exit with error

## Troubleshooting

### Still Getting Timeout?

**Option A: Check Network Connection**

```bash
# Test npm registry connectivity
curl -I https://registry.npmjs.org
ping registry.npmjs.org
```

**Option B: Build Without Docker** (Fastest)

```bash
# Clean up Docker
docker compose down

# Install locally
npm install

# Build locally
npm run build

# Run migrations
npm run prisma:migrate
npm run prisma:seed

# Start services directly
node apps/api-gateway/dist/main.js
```

**Option C: Use Alternative npm Registry**

```bash
npm config set registry https://registry.npmmirror.com
npm run start:all
npm config set registry https://registry.npmjs.org
```

**Option D: Increase Timeout Further**

```bash
npm config set fetch-timeout 1200000  # 20 minutes
npm run start:all
```

## Verification

When the fix works, you'll see:

```
==> Configuring npm (increasing timeout for Docker build)
==> Starting infrastructure (postgres, redis, kafka)
✔ Container stockpred-postgres-1  Running
✔ Container stockpred-redis-1     Running
✔ Container stockpred-kafka-1     Running
==> Building and starting all services
    [Attempt 1/3] Building Docker images...
    [+] Building ...
    ✅ Build succeeded
```

Then all services will start successfully:

```
==> StockPred is up:
    Frontend:     http://localhost:8080
    API Gateway:  http://localhost:3000
    ML Engine:    http://localhost:8000/health
```

## Why This Matters

- **Windows users**: Often hit network timeouts due to WSL2/Hyper-V overhead
- **WiFi users**: Intermittent connectivity issues during long builds
- **Slow connections**: ISP throttling or distance from npm CDN
- **First run**: ~300 dependencies = 5+ minutes download time

The fix provides:

- ✅ Automatic npm optimization
- ✅ Transparent retry logic
- ✅ No manual intervention needed
- ✅ Works on all platforms (Windows, Mac, Linux)

## References

- [npm fetch-timeout docs](https://docs.npmjs.com/cli/v10/using-npm/config#fetch-timeout)
- [npm fetch-retry-\* docs](https://docs.npmjs.com/cli/v10/using-npm/config#fetch-retry-mintimeout)
