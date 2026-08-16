#!/usr/bin/env node
/**
 * Local process supervisor for the StockPred stack.
 *
 * Starts each service with a fixed command (same argv, cwd, env). If that
 * process exits or its health URL fails consecutive checks, it is killed
 * (including leftover listeners on its port) and started again with that
 * same command — not a substitute process.
 *
 *   npm run start:app
 *   npm run stop:app
 *   node scripts/dev-supervisor.js --skip-infra --skip-build
 *
 * Ctrl+C stops every child the supervisor started.
 */
'use strict';

const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs', 'dev');
const PID_FILE = path.join(LOG_DIR, 'supervisor.pid');
const NODE = process.execPath;
const IS_WIN = process.platform === 'win32';

const CHECK_MS = 5_000;
const FAIL_THRESHOLD = 3;
const HEALTH_TIMEOUT_MS = 4_000;
const STOP_WAIT_MS = 4_000;
const MAX_BACKOFF_MS = 30_000;

const args = new Set(process.argv.slice(2));
const WANT_STOP = args.has('stop');
const SKIP_INFRA = args.has('--skip-infra');
const SKIP_BUILD = args.has('--skip-build');
const DOCKER_MODE = args.has('--docker');

/** @typedef {{ name: string, port: number, health: string, cwd: string, cmd: string, args: string[], workspace?: string, distFile?: string, graceMs: number }} ServiceSpec */

/** Load .env. File values override inherited shell env by default. */
function loadDotEnv(file, override = true) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '' || override) {
      process.env[key] = value;
    }
  }
}

function log(message) {
  const stamp = new Date().toISOString();
  console.log(`[supervisor ${stamp}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function commandLine(spec) {
  return [spec.cmd, ...spec.args].join(' ');
}

function resolvePython() {
  const candidates = IS_WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd[0], [...cmd.slice(1), '-c', 'import uvicorn'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (probe.status === 0) return cmd;
  }
  log(
    'Python/uvicorn not found — ml-engine will fail until you install Python 3.11 and: pip install -r apps/ml-engine/requirements.txt',
  );
  log('Run npm run check:deps for the full tool list.');
  return candidates[0];
}

function nestService(folder, port, graceMs = 45_000) {
  return {
    name: folder,
    port,
    health: `http://127.0.0.1:${port}/health`,
    cwd: ROOT,
    cmd: NODE,
    args: [path.join('apps', folder, 'dist', 'main.js')],
    workspace: `@stockpred/${folder}`,
    distFile: path.join(ROOT, 'apps', folder, 'dist', 'main.js'),
    graceMs,
  };
}

function buildCatalog(pythonCmd) {
  const viteJs = path.join(
    ROOT,
    'apps',
    'frontend-react',
    'node_modules',
    'vite',
    'bin',
    'vite.js',
  );
  return [
    nestService('auth-service', 3001),
    nestService('market-data-service', 3002, 180_000),
    nestService('signal-engine', 3003),
    nestService('pattern-engine', 3004),
    nestService('backtest-service', 3005),
    nestService('auto-trader', 3006),
    nestService('notification-service', 3007),
    nestService('api-gateway', 3000, 60_000),
    {
      name: 'ml-engine',
      port: 8000,
      health: 'http://127.0.0.1:8000/health',
      cwd: path.join(ROOT, 'apps', 'ml-engine'),
      cmd: pythonCmd[0],
      args: [
        ...pythonCmd.slice(1),
        '-m',
        'uvicorn',
        'app.server:app',
        '--host',
        '127.0.0.1',
        '--port',
        '8000',
      ],
      graceMs: 90_000,
    },
    {
      name: 'frontend',
      port: 5173,
      health: 'http://127.0.0.1:5173/',
      cwd: path.join(ROOT, 'apps', 'frontend-react'),
      cmd: NODE,
      args: [viteJs, '--host', '127.0.0.1', '--port', '5173'],
      graceMs: 60_000,
    },
  ];
}

const START_WAVES = [
  ['auth-service', 'market-data-service'],
  ['signal-engine', 'pattern-engine', 'backtest-service', 'auto-trader', 'notification-service'],
  ['api-gateway', 'ml-engine'],
  ['frontend'],
];

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

function killPid(pid) {
  if (!pid || pid === process.pid) return;
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

async function freePort(port) {
  const pids = pidsOnPort(port);
  for (const pid of pids) {
    log(`freeing :${port} (pid ${pid})`);
    killPid(pid);
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline && pidsOnPort(port).length > 0) {
    await sleep(200);
  }
}

function tcpOpen(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function httpOk(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function dockerAvailable() {
  const probe = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return probe.status === 0;
}

function compose(args, opts = {}) {
  return spawnSync('docker', ['compose', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    stdio: opts.stdio || 'pipe',
  });
}

async function startInfra() {
  if (SKIP_INFRA) {
    log('skipping docker infrastructure (--skip-infra)');
    return false;
  }
  if (!dockerAvailable()) {
    log('docker compose not available — starting app processes without postgres/redis/kafka');
    return false;
  }
  log('starting docker infrastructure: postgres redis kafka');
  const up = compose(['up', '-d', 'postgres', 'redis', 'kafka'], { stdio: 'inherit' });
  if (up.status !== 0) {
    log('docker compose up failed — continuing with local processes only');
    return false;
  }
  const checks = [
    ['postgres', Number(process.env.POSTGRES_PORT || 5432)],
    ['redis', 6379],
    ['kafka', 29092],
  ];
  for (const [name, port] of checks) {
    let ok = false;
    for (let i = 0; i < 40; i += 1) {
      if (await tcpOpen(port)) {
        ok = true;
        break;
      }
      await sleep(1000);
    }
    log(
      ok
        ? `${name} reachable on :${port}`
        : `${name} not reachable on :${port} (services will retry)`,
    );
  }
  return true;
}

function overlayEnv(startedInfra) {
  const env = { ...process.env };
  env.NODE_ENV = env.NODE_ENV || 'development';
  env.AUTH_SERVICE_URL = env.AUTH_SERVICE_URL || 'http://localhost:3001';
  env.MARKET_DATA_SERVICE_URL = env.MARKET_DATA_SERVICE_URL || 'http://localhost:3002';
  env.SIGNAL_ENGINE_URL = env.SIGNAL_ENGINE_URL || 'http://localhost:3003';
  env.PATTERN_ENGINE_URL = env.PATTERN_ENGINE_URL || 'http://localhost:3004';
  env.BACKTEST_SERVICE_URL = env.BACKTEST_SERVICE_URL || 'http://localhost:3005';
  env.AUTO_TRADER_URL = env.AUTO_TRADER_URL || 'http://localhost:3006';
  env.NOTIFICATION_SERVICE_URL = env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007';
  env.ML_ENGINE_URL = env.ML_ENGINE_URL || 'http://localhost:8000';
  env.ML_MODELS_DIR = path.resolve(ROOT, env.ML_MODELS_DIR || './ml-models');
  env.CORS_ORIGIN = env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:5173';
  env.STOCK_UNIVERSE_MODE = env.STOCK_UNIVERSE_MODE || 'full-universe';
  if (startedInfra) {
    env.KAFKA_BROKERS = 'localhost:29092';
  }
  return env;
}

function buildIfNeeded(spec) {
  if (!spec.distFile || SKIP_BUILD) return;
  if (fs.existsSync(spec.distFile)) return;
  if (!spec.workspace) return;
  log(`${spec.name}: ${spec.distFile} missing — building ${spec.workspace}`);
  const result = spawnSync('npm', ['run', 'build', '-w', spec.workspace], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell: IS_WIN,
  });
  if (result.status !== 0) {
    throw new Error(`${spec.name} build failed (npm run build -w ${spec.workspace})`);
  }
}

function spawnChild(runtime, spec, env) {
  ensureDir(LOG_DIR);
  const logPath = path.join(LOG_DIR, `${spec.name}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n---- start ${new Date().toISOString()} ----\n${commandLine(spec)}\n`);
  const child = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.on('exit', () => {
    logStream.end();
  });
  runtime.child = child;
  runtime.logPath = logPath;
  runtime.startedAt = Date.now();
  runtime.failures = 0;
  log(`${spec.name}: started pid=${child.pid} cmd=${commandLine(spec)}`);
  child.on('exit', (code, signal) => {
    runtime.child = null;
    if (runtime.stopping || runtime.restarting || shuttingDown) return;
    log(`${spec.name}: exited code=${code} signal=${signal || 'none'} — scheduling exact restart`);
    scheduleRestart(runtime, spec, env, `process exit (code ${code})`);
  });
}

async function stopChild(runtime) {
  runtime.stopping = true;
  const child = runtime.child;
  runtime.child = null;
  if (child && child.pid) {
    killPid(child.pid);
  }
  await freePort(runtime.spec.port);
  await sleep(400);
  runtime.stopping = false;
}

const runtimes = new Map();
let shuttingDown = false;
let checkTimer = null;

function backoffMs(runtime) {
  const n = Math.min(runtime.restarts, 8);
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n);
}

function scheduleRestart(runtime, spec, env, reason) {
  if (shuttingDown || runtime.restartQueued) return;
  runtime.restartQueued = true;
  const wait = backoffMs(runtime);
  log(`${spec.name}: restart in ${wait}ms (${reason})`);
  log(`${spec.name}: exact command: ${commandLine(spec)}`);
  setTimeout(() => {
    runtime.restartQueued = false;
    void restartService(runtime, spec, env, reason);
  }, wait);
}

async function restartService(runtime, spec, env, reason) {
  if (shuttingDown) return;
  runtime.restarts += 1;
  runtime.restarting = true;
  log(`${spec.name}: restart #${runtime.restarts} — ${reason}`);
  log(`${spec.name}: ${commandLine(spec)}`);
  await stopChild(runtime);
  try {
    buildIfNeeded(spec);
  } catch (error) {
    log(`${spec.name}: rebuild failed: ${error.message}`);
    runtime.restarting = false;
    scheduleRestart(runtime, spec, env, 'rebuild failed');
    return;
  }
  await freePort(spec.port);
  spawnChild(runtime, spec, env);
  runtime.restarting = false;
}

async function waitHealthy(spec, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpOk(spec.health)) return true;
    await sleep(1000);
  }
  return false;
}

async function monitorOnce(env) {
  for (const runtime of runtimes.values()) {
    if (shuttingDown || runtime.restartQueued || runtime.stopping || runtime.restarting) continue;
    const spec = runtime.spec;
    const childAlive = Boolean(
      runtime.child && runtime.child.pid && runtime.child.exitCode === null,
    );
    if (!childAlive) continue;
    if (Date.now() - runtime.startedAt < spec.graceMs) continue;
    const ok = await httpOk(spec.health);
    if (ok) {
      runtime.failures = 0;
      continue;
    }
    runtime.failures += 1;
    log(`${spec.name}: health failed ${runtime.failures}/${FAIL_THRESHOLD} GET ${spec.health}`);
    if (runtime.failures >= FAIL_THRESHOLD) {
      runtime.failures = 0;
      scheduleRestart(runtime, spec, env, `health check failed (${spec.health})`);
    }
  }
}

function printDependencyPreflight() {
  const script = path.join(ROOT, 'scripts', 'check-deps.js');
  if (!fs.existsSync(script)) return;
  log('dependency preflight (npm run check:deps)');
  spawnSync(NODE, [script, '--soft'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
}

async function startLocal() {
  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'));
    log('created .env from .env.example');
  }
  loadDotEnv(path.join(ROOT, '.env'));
  printDependencyPreflight();
  ensureDir(LOG_DIR);
  fs.writeFileSync(PID_FILE, String(process.pid));

  const startedInfra = await startInfra();
  const env = overlayEnv(startedInfra);
  const pythonCmd = resolvePython();
  const catalog = buildCatalog(pythonCmd);

  for (const spec of catalog) {
    runtimes.set(spec.name, {
      spec,
      child: null,
      failures: 0,
      restarts: 0,
      startedAt: 0,
      stopping: false,
      restarting: false,
      restartQueued: false,
    });
  }

  for (const wave of START_WAVES) {
    for (const name of wave) {
      const runtime = runtimes.get(name);
      const spec = runtime.spec;
      try {
        buildIfNeeded(spec);
      } catch (error) {
        log(`${name}: ${error.message}`);
        continue;
      }
      await freePort(spec.port);
      spawnChild(runtime, spec, env);
    }
    for (const name of wave) {
      const spec = runtimes.get(name).spec;
      const ok = await waitHealthy(spec, Math.min(spec.graceMs, 90_000));
      log(
        ok
          ? `${name}: healthy ${spec.health}`
          : `${name}: not healthy yet (${spec.health}) — monitor will restart if it stays down`,
      );
    }
  }

  log('stack is up. UI http://localhost:5173  API http://localhost:3000/health');
  log(`logs: ${LOG_DIR}`);
  log('Ctrl+C stops every supervised process');

  checkTimer = setInterval(() => {
    void monitorOnce(env);
  }, CHECK_MS);
}

const DOCKER_APPS = [
  { name: 'auth-service', health: 'http://127.0.0.1:3001/health' },
  { name: 'market-data-service', health: 'http://127.0.0.1:3002/health' },
  { name: 'signal-engine', health: 'http://127.0.0.1:3003/health' },
  { name: 'pattern-engine', health: 'http://127.0.0.1:3004/health' },
  { name: 'backtest-service', health: 'http://127.0.0.1:3005/health' },
  { name: 'auto-trader', health: 'http://127.0.0.1:3006/health' },
  { name: 'notification-service', health: 'http://127.0.0.1:3007/health' },
  { name: 'api-gateway', health: 'http://127.0.0.1:3000/health' },
  { name: 'ml-engine', health: 'http://127.0.0.1:8000/health' },
  { name: 'frontend', health: 'http://127.0.0.1:8080/' },
];

const dockerFails = new Map();

async function startDockerMode() {
  if (!dockerAvailable()) {
    throw new Error('docker compose is required for --docker');
  }
  log('docker mode: docker compose --profile apps up -d --build');
  const up = compose(['--profile', 'apps', 'up', '-d', '--build'], { stdio: 'inherit' });
  if (up.status !== 0) {
    throw new Error('docker compose up failed');
  }
  checkTimer = setInterval(() => {
    void (async () => {
      for (const svc of DOCKER_APPS) {
        const ok = await httpOk(svc.health);
        const fails = dockerFails.get(svc.name) || 0;
        if (ok) {
          dockerFails.set(svc.name, 0);
          continue;
        }
        const next = fails + 1;
        dockerFails.set(svc.name, next);
        log(`${svc.name}: health failed ${next}/${FAIL_THRESHOLD} GET ${svc.health}`);
        if (next >= FAIL_THRESHOLD) {
          dockerFails.set(svc.name, 0);
          log(`${svc.name}: docker compose restart ${svc.name}`);
          compose(['restart', svc.name], { stdio: 'inherit' });
        }
      }
    })();
  }, CHECK_MS);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (checkTimer) clearInterval(checkTimer);
  log('stopping supervised processes');
  for (const runtime of runtimes.values()) {
    await stopChild(runtime);
  }
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

async function stopAll() {
  loadDotEnv(path.join(ROOT, '.env'));
  if (fs.existsSync(PID_FILE)) {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (pid && pid !== process.pid) {
      log(`stopping supervisor pid ${pid}`);
      killPid(pid);
      await sleep(1000);
    }
  }
  const pythonCmd = resolvePython();
  const catalog = buildCatalog(pythonCmd);
  for (const spec of catalog) {
    await freePort(spec.port);
  }
  log('ports cleared');
}

async function main() {
  if (WANT_STOP) {
    await stopAll();
    return;
  }
  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });
  if (DOCKER_MODE) {
    await startDockerMode();
    log('monitoring docker services. Ctrl+C exits the monitor (containers keep running).');
    return;
  }
  await startLocal();
}

main().catch((error) => {
  console.error(`[supervisor] ${error.stack || error.message}`);
  process.exit(1);
});
