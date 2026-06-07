#!/usr/bin/env node
/**
 * Cross-platform diagnostics and cleanup script for StockPred
 * Works on Windows, Mac, and Linux without requiring bash
 *
 * Usage:
 *   npm run clean                # Diagnostics only
 *   npm run clean -- --full      # Full cleanup + restart
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

// Colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  header: (msg) => console.log(`${colors.blue}${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⊘${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.yellow}${msg}${colors.reset}`),
  divider: () => console.log('────────────────────────'),
};

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...options }).trim();
  } catch {
    return '';
  }
}

function main() {
  console.log('');
  log.header('╔════════════════════════════════════════════════════════════╗');
  log.header('║  StockPred Platform - Diagnostics & Cleanup              ║');
  log.header('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Check Docker
  if (!exec('docker --version')) {
    log.error('Docker not found');
    process.exit(1);
  }

  log.success('Docker is running');
  console.log('');

  // ===== DIAGNOSIS =====
  log.header('=== DIAGNOSIS ===');
  console.log('');

  // 1. Container Status
  log.info('1. Container Status:');
  log.divider();
  const containers = exec('docker compose ps');
  if (containers) {
    containers
      .split('\n')
      .slice(1)
      .forEach((line) => {
        if (line.trim()) console.log(`  ${line}`);
      });
  } else {
    console.log('  (No containers running)');
  }
  console.log('');

  // 2. Infrastructure Health
  log.info('2. Infrastructure Health:');
  log.divider();
  const services = ['postgres', 'redis', 'kafka'];
  const failedInfra = [];
  services.forEach((service) => {
    const health = exec(`docker compose ps --format "{{.Health}}" "${service}"`);
    if (health === 'healthy') {
      log.success(`${service}: healthy`);
    } else {
      log.error(`${service}: ${health || 'unknown'}`);
      failedInfra.push(service);
    }
  });
  console.log('');

  // 3. Service Logs
  log.info('3. Service Errors:');
  log.divider();
  const serviceList = [
    'api-gateway',
    'auth-service',
    'market-data-service',
    'signal-engine',
    'pattern-engine',
    'backtest-service',
    'auto-trader',
    'notification-service',
  ];

  const failedServices = [];
  serviceList.forEach((service) => {
    // Check if service is running (simpler approach)
    const psOutput = exec(`docker compose ps`);
    const isRunning = psOutput.includes(service) && psOutput.includes('Up');

    if (isRunning) {
      // Try to get logs (best effort)
      const allLogs = exec(`docker compose logs "${service}" 2>&1`) || '';
      const hasErrors =
        allLogs.toLowerCase().includes('error') ||
        allLogs.toLowerCase().includes('failed') ||
        allLogs.toLowerCase().includes('exception');

      if (hasErrors) {
        log.error(`${service}: Has errors`);
        const errorLines = allLogs
          .split('\n')
          .filter(
            (line) =>
              line.toLowerCase().includes('error') ||
              line.toLowerCase().includes('failed') ||
              line.toLowerCase().includes('exception'),
          )
          .slice(0, 2);
        errorLines.forEach((line) => {
          if (line.trim()) console.log(`    ${line.trim().substring(0, 80)}`);
        });
        failedServices.push(service);
      } else {
        log.success(`${service}: OK`);
      }
    } else if (psOutput) {
      log.warning(`${service}: Not running (${psOutput})`);
    } else {
      log.warning(`${service}: Not running`);
    }
  });
  console.log('');

  // 4. Connectivity
  log.info('4. Service Connectivity:');
  log.divider();
  const endpoints = {
    'api-gateway': 'http://localhost:3000/health',
    'auth-service': 'http://localhost:3001/health',
    'market-data-service': 'http://localhost:3002/health',
  };

  Object.entries(endpoints).forEach(([name, url]) => {
    const result = exec(`curl -fsS "${url}"`, { stdio: 'pipe' });
    if (result) {
      log.success(`${name}: responding`);
    } else {
      log.error(`${name}: not responding (${url})`);
    }
  });
  console.log('');

  // ===== RECOMMENDATIONS =====
  log.header('=== RECOMMENDATIONS ===');
  console.log('');

  if (failedServices.length > 0) {
    log.info(`Services with errors: ${failedServices.join(', ')}`);
    console.log(`  → Run: docker compose logs ${failedServices[0]} -f\n`);
  }

  if (failedInfra.length > 0) {
    log.info(`Infrastructure issues: ${failedInfra.join(', ')}`);
    console.log(`  → Check with: docker compose logs ${failedInfra[0]}\n`);
  }

  // Check for --full flag
  const fullCleanup = process.argv.includes('--full');

  if (fullCleanup) {
    performFullCleanup();
  } else {
    showQuickActions();
  }

  log.header('════════════════════════════════════════════════════════════');
}

function performFullCleanup() {
  console.log('');
  log.header('=== PERFORMING FULL CLEANUP ===');
  console.log('');

  console.log('Stopping all services...');
  exec('docker compose down -v --remove-orphans');
  log.success('All containers stopped');
  console.log('');

  console.log('Removing dangling Docker resources...');
  exec('docker system prune -f --volumes');
  log.success('Cleaned up Docker resources');
  console.log('');

  console.log('Reconfiguring npm...');
  exec('npm config set fetch-timeout 600000');
  exec('npm config set fetch-retry-mintimeout 20000');
  exec('npm config set fetch-retry-maxtimeout 120000');
  log.success('npm configured');
  console.log('');

  log.header('=== RESTARTING PLATFORM ===');
  console.log('');

  // Use platform.js to ensure bash detection works
  const result = spawnSync('npm', ['run', 'start:all'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  process.exit(result.status || 0);
}

function showQuickActions() {
  console.log('');
  log.info('Quick Actions:');
  console.log('  • View service logs:      docker compose logs <service> -f');
  console.log('  • Restart platform:       npm run restart:all');
  console.log('  • Full cleanup & restart: npm run clean -- --full');
  console.log('  • Stop all services:      npm run stop:all');
  console.log('');

  log.info('Detailed Troubleshooting:');
  console.log('  • Database issues:        docker compose logs postgres');
  console.log('  • Market data issues:     docker compose logs market-data-service');
  console.log('  • Check port conflicts:   netstat -ano | findstr :3000 (Windows)');
  console.log('  • Full documentation:     cat NPM_TIMEOUT_FIX.md');
  console.log('');
}

main();
