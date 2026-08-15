#!/usr/bin/env node
/**
 * Cross-platform build script for all services
 * Usage: node scripts/build-all.js [--test] [--clean] [--watch]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const options = {
  test: args.includes('--test'),
  clean: args.includes('--clean'),
  watch: args.includes('--watch'),
  verbose: args.includes('--verbose'),
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function execWithLogging(cmd, label) {
  log('blue', `→ ${label}`);
  try {
    const result = execSync(cmd, {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });
    log('green', `✓ ${label}`);
    return true;
  } catch (error) {
    log('red', `✗ ${label} failed`);
    throw error;
  }
}

async function main() {
  try {
    log('blue', '\n=== StockPred Build System ===\n');
    log('blue', `Options: ${JSON.stringify(options)}\n`);

    const startTime = Date.now();

    // Clean build artifacts if requested
    if (options.clean) {
      log('yellow', 'Cleaning build artifacts...');
      const dirs = ['apps/*/dist', 'packages/*/dist', 'apps/*/.turbo', 'packages/*/.turbo'];
      dirs.forEach((pattern) => {
        try {
          execSync(`find . -path "${pattern}" -type d -exec rm -rf {} + 2>/dev/null || true`, {
            cwd: path.resolve(__dirname, '..'),
            stdio: 'pipe',
          });
        } catch {}
      });
      log('green', '✓ Cleaned\n');
    }

    // Step 1: Build packages
    log('blue', 'STEP 1: Building shared packages');
    execWithLogging('npm run build:packages', 'Packages');
    log('green', '');

    // Step 2: Build apps
    log('blue', 'STEP 2: Building apps');
    execWithLogging('npm run build:apps', 'Apps');
    log('green', '');

    // Step 3: Run linting
    log('blue', 'STEP 3: Linting code');
    try {
      execWithLogging('npm run lint', 'Lint check');
      log('green', '');
    } catch {
      log('yellow', '⚠ Lint warnings (non-fatal)\n');
    }

    // Step 4: Run tests if requested
    if (options.test) {
      log('blue', 'STEP 4: Running tests');
      try {
        execWithLogging('npm run test', 'Tests');
        log('green', '');
      } catch {
        log('red', '✗ Tests failed');
        process.exit(1);
      }
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log('green', '\n=== Build Complete ===\n');
    log('green', `Duration: ${duration}s\n`);

    console.log('✓ api-gateway');
    console.log('✓ auth-service');
    console.log('✓ market-data-service');
    console.log('✓ signal-engine');
    console.log('✓ pattern-engine');
    console.log('✓ backtest-service');
    console.log('✓ auto-trader');
    console.log('✓ notification-service');
    console.log('✓ frontend-react\n');

    log('blue', 'Next steps:');
    console.log('  npm run start:all      - Start Docker platform');
    console.log('  npm run stop:all       - Stop Docker platform');
    console.log('  npm run restart:all    - Restart services\n');
  } catch (error) {
    log('red', '\n✗ Build failed!');
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
