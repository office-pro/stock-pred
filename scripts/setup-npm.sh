#!/usr/bin/env bash
# Pre-configure npm for optimal Docker build performance
# Run once before first `npm run start:all`

echo "==> Configuring npm for optimal Docker builds..."

# Increase npm timeout (prevents EIDLETIMEOUT during npm ci)
npm config set fetch-timeout 600000
echo "    ✓ Set fetch-timeout: 600000ms (10 min)"

# Configure retry settings for transient network failures
npm config set fetch-retry-mintimeout 20000
echo "    ✓ Set fetch-retry-mintimeout: 20000ms"

npm config set fetch-retry-maxtimeout 120000
echo "    ✓ Set fetch-retry-maxtimeout: 120000ms"

# Optional: Use npm cache during builds (faster on rebuilds)
npm config set prefer-offline true
echo "    ✓ Set prefer-offline: true (use cached packages)"

echo ""
echo "✅ npm is configured. You can now run:"
echo "   npm run start:all"
echo ""
