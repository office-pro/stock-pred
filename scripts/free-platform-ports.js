#!/usr/bin/env node
/**
 * Free StockPred service ports before docker compose start.
 * Stops the local dev supervisor (npm start) and kills listeners on app ports.
 */
'use strict';

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { isProtectedPid, processName } = require('./protected-pids');

const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NODE = process.execPath;
const LOG_DIR = path.join(ROOT, 'logs', 'dev');
const PID_FILE = path.join(LOG_DIR, 'supervisor.pid');

/** Ports used by docker compose --profile apps and local dev supervisor. */
const PLATFORM_PORTS = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 5173, 8000, 8080];

function log(message) {
  console.log(`[free-ports] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPid(pid) {
  if (!pid || pid === process.pid) return;
  if (isProtectedPid(pid)) {
    log(`skipping Docker/system pid ${pid} (${processName(pid) || 'unknown'})`);
    return;
  }
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
}

function pidsOnPort(port) {
  try {
    if (IS_WIN) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/\sLISTENING\s/.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] || '';
        const pid = Number(parts[parts.length - 1]);
        if (!pid || pid === process.pid) continue;
        if (local.endsWith(`:${port}`)) pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => pid && pid !== process.pid);
  } catch {
    return [];
  }
}

async function freePort(port) {
  const pids = pidsOnPort(port);
  for (const pid of pids) {
    if (isProtectedPid(pid)) {
      log(`leaving :${port} (Docker pid ${pid})`);
      continue;
    }
    log(`freeing :${port} (pid ${pid})`);
    killPid(pid);
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!open) return;
    await sleep(200);
  }
}

function stopDevSupervisor() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (!pid || pid === process.pid) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return;
  }
  log(`stopping dev supervisor pid ${pid}`);
  killPid(pid);
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

async function main() {
  stopDevSupervisor();
  // Also run the supervisor stop hook (frees catalog ports + clears pid file).
  spawnSync(NODE, [path.join(ROOT, 'scripts', 'dev-supervisor.js'), 'stop'], {
    cwd: ROOT,
    stdio: 'pipe',
    windowsHide: true,
  });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let freed = 0;
    for (const port of PLATFORM_PORTS) {
      const pids = pidsOnPort(port);
      for (const pid of pids) {
        if (isProtectedPid(pid)) {
          continue;
        }
        log(`freeing :${port} (pid ${pid})`);
        killPid(pid);
        freed += 1;
      }
    }
    if (freed === 0) break;
    await sleep(500);
  }
  log('platform ports cleared');
}

main().catch((error) => {
  console.error(`[free-ports] ${error.stack || error.message}`);
  process.exit(1);
});
