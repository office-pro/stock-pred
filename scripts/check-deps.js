#!/usr/bin/env node
/**
 * Print (and optionally enforce) everything a new developer needs to run StockPred.
 *
 *   npm run check:deps          # fail if required tools are missing
 *   npm run check:deps -- --soft
 *
 * Required on the machine:
 *   Node.js 20+     NestJS services, React UI, Prisma, this supervisor
 *   npm 10+         workspaces (ships with Node 20)
 *   Docker Desktop  Postgres 16, Redis 7, Kafka (docker compose)
 *   Python 3.11     ml-engine (FastAPI / uvicorn). 3.10–3.12 also work
 *
 * Then in the repo:
 *   cp .env.example .env
 *   npm install
 *   pip install -r apps/ml-engine/requirements.txt
 *   npm start
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOFT = process.argv.includes('--soft');
const IS_WIN = process.platform === 'win32';

const NEED = {
  nodeMajor: 20,
  npmMajor: 10,
  pythonMin: [3, 10],
  pythonMax: [3, 12],
  pythonPreferred: '3.11',
};

const INSTALL = {
  node: 'https://nodejs.org (LTS 20) or: nvm install 20 / fnm install 20',
  docker: 'https://docs.docker.com/get-docker/  then start Docker Desktop',
  python: 'https://www.python.org/downloads/ (3.11)  Windows: tick "Add python.exe to PATH"',
  pip: 'python -m pip install -r apps/ml-engine/requirements.txt',
  env: 'copy .env.example to .env (npm start does this automatically)',
  npmInstall: 'npm install   (from the repo root)',
};

let failedRequired = 0;

function ok(label, detail) {
  console.log(`  OK       ${label}${detail ? `  — ${detail}` : ''}`);
}

function missing(required, label, how) {
  if (required) failedRequired += 1;
  const tag = required ? 'MISSING ' : 'WARN    ';
  console.log(`  ${tag} ${label}`);
  if (how) console.log(`           install: ${how}`);
}

function warn(label, detail) {
  console.log(`  WARN     ${label}${detail ? `  — ${detail}` : ''}`);
}

function heading(title) {
  console.log('');
  console.log(title);
}

function npmBin() {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return { cmd: process.execPath, argsPrefix: [cli] };
  return { cmd: IS_WIN ? 'npm.cmd' : 'npm', argsPrefix: [] };
}

function run(cmd, args, cwd = ROOT) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function parseMajor(version) {
  const match = String(version).match(/(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), raw: `${match[1]}.${match[2]}` };
}

function pythonCandidates() {
  return IS_WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
}

function pythonInRange(ver) {
  const tooOld =
    ver.major < NEED.pythonMin[0] ||
    (ver.major === NEED.pythonMin[0] && ver.minor < NEED.pythonMin[1]);
  const tooNew =
    ver.major > NEED.pythonMax[0] ||
    (ver.major === NEED.pythonMax[0] && ver.minor > NEED.pythonMax[1]);
  return !tooOld && !tooNew;
}

function findPython() {
  const found = [];
  for (const cmd of pythonCandidates()) {
    const probe = run(cmd[0], [...cmd.slice(1), '--version']);
    const text = `${probe.stdout} ${probe.stderr}`;
    if (probe.status !== 0 || !/Python\s+\d/i.test(text)) continue;
    const ver = parseMajor(text.replace(/^[\s\S]*?Python\s+/i, ''));
    if (!ver) continue;
    found.push({ cmd, ver, display: cmd.join(' ') });
  }
  return found.find((row) => pythonInRange(row.ver)) || found[0] || null;
}

function pythonHasModule(pythonCmd, moduleName) {
  const probe = run(pythonCmd[0], [...pythonCmd.slice(1), '-c', `import ${moduleName}`]);
  return probe.status === 0;
}

function tcpOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 800 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function checkNode() {
  const ver = parseMajor(process.versions.node);
  if (ver && ver.major >= NEED.nodeMajor) {
    ok(`Node.js ${process.versions.node}`, `need >= ${NEED.nodeMajor} (see .nvmrc)`);
    return;
  }
  missing(
    true,
    `Node.js ${process.versions.node || 'not found'} (need >= ${NEED.nodeMajor})`,
    INSTALL.node,
  );
}

function checkNpm() {
  const npm = npmBin();
  const probe = run(npm.cmd, [...npm.argsPrefix, '--version']);
  const ver = parseMajor(probe.stdout);
  if (probe.status === 0 && ver && ver.major >= NEED.npmMajor) {
    ok(`npm ${probe.stdout}`, 'workspaces / npm install');
    return;
  }
  missing(true, 'npm 10+ (bundled with Node 20)', INSTALL.node);
}

function checkDocker() {
  const docker = run('docker', ['--version']);
  if (docker.status !== 0) {
    missing(true, 'Docker', INSTALL.docker);
    return false;
  }
  const compose = run('docker', ['compose', 'version']);
  if (compose.status !== 0) {
    missing(true, 'Docker Compose plugin (`docker compose`)', INSTALL.docker);
    return false;
  }
  const info = run('docker', ['info']);
  if (info.status !== 0) {
    missing(
      true,
      `Docker installed (${docker.stdout}) but the engine is not running`,
      'Start Docker Desktop, then re-run',
    );
    return false;
  }
  ok(
    docker.stdout.replace(/^Docker version /i, 'Docker '),
    'postgres + redis + kafka via docker compose',
  );
  return true;
}

function checkPython() {
  const found = findPython();
  if (!found) {
    missing(true, `Python ${NEED.pythonPreferred} (ml-engine)`, INSTALL.python);
    return null;
  }
  const { raw } = found.ver;
  if (!pythonInRange(found.ver)) {
    warn(
      `Python ${raw} via \`${found.display}\``,
      `ml-engine image is ${NEED.pythonPreferred}; ${NEED.pythonMin.join('.')}–${NEED.pythonMax.join('.')} is supported`,
    );
  } else {
    ok(
      `Python ${raw} via \`${found.display}\``,
      `preferred ${NEED.pythonPreferred} (see .python-version)`,
    );
  }
  return found;
}

function checkPythonPackages(found) {
  if (!found) return;
  const required = ['uvicorn', 'fastapi'];
  const missingMods = required.filter((name) => !pythonHasModule(found.cmd, name));
  if (missingMods.length > 0) {
    missing(true, `Python packages: ${missingMods.join(', ')}`, INSTALL.pip);
    return;
  }
  ok('Python packages uvicorn + fastapi', INSTALL.pip);
}

function checkWorkspace() {
  if (fs.existsSync(path.join(ROOT, '.env'))) {
    ok('.env', 'copied from .env.example');
  } else {
    missing(false, '.env is missing', INSTALL.env);
  }

  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    ok('node_modules', INSTALL.npmInstall);
  } else {
    missing(true, 'node_modules (dependencies not installed)', INSTALL.npmInstall);
  }

  const master = path.join(ROOT, 'packages', 'database', 'data', 'equity-master.json');
  if (fs.existsSync(master)) {
    ok('equity-master.json', 'official NSE/BSE list');
  } else {
    warn('equity-master.json missing', 'run: npm run ingest:listings');
  }
}

async function checkPorts() {
  const envFile = path.join(ROOT, '.env');
  const env = {};
  if (fs.existsSync(envFile)) {
    for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cut = line.indexOf('=');
      if (cut <= 0) continue;
      env[line.slice(0, cut).trim()] = line.slice(cut + 1).trim();
    }
  }
  const postgresPort = Number(env.POSTGRES_PORT || 5432);
  const ports = [
    ['Postgres', postgresPort, 'docker compose up -d postgres'],
    ['Redis', 6379, 'docker compose up -d redis'],
    [
      'Kafka (host listener)',
      29092,
      'docker compose up -d kafka  (use localhost:29092 from the host)',
    ],
  ];
  for (const [name, port, how] of ports) {
    if (await tcpOpen(port)) {
      ok(`${name} :${port} is open`);
    } else {
      missing(false, `${name} is not listening on :${port}`, how);
    }
  }
}

function printGuide() {
  heading('What this app needs');
  console.log(
    `
  Runtime
    Node.js  >= ${NEED.nodeMajor}          .nvmrc
    npm      >= ${NEED.npmMajor}          comes with Node 20
    Docker Desktop           postgres:16  redis:7  kafka:3.9
    Python   ${NEED.pythonPreferred} (3.10–3.12)   .python-version
                             pip install -r apps/ml-engine/requirements.txt

  First-time setup
    1. cp .env.example .env          (Windows: copy .env.example .env)
    2. npm install
    3. pip install -r apps/ml-engine/requirements.txt
    4. npm start                     starts Docker infra + all services
    5. UI  http://localhost:5173     API  http://localhost:3000/health

  After Postgres is up
    npm run prisma:migrate
    npm run prisma:seed
    npm run ingest:listings          (if equity-master.json is missing)
    npm run ingest:bhavcopy -- --days 60
    npm run scan:patterns            (all listed symbols)

  Demo logins (local seed only)
    admin@stockpred.local   / Admin@12345
    trader@stockpred.local  / Trader@12345
`.trimEnd(),
  );
}

async function main() {
  console.log('StockPred — developer dependency check');
  console.log(`Repo: ${ROOT}`);

  heading('Tools');
  checkNode();
  checkNpm();
  checkDocker();
  const python = checkPython();

  heading('Python ML engine');
  checkPythonPackages(python);

  heading('Workspace');
  checkWorkspace();

  heading('Local infrastructure (optional until npm start)');
  await checkPorts();

  printGuide();

  console.log('');
  if (failedRequired > 0) {
    console.log(`Result: ${failedRequired} required item(s) missing.`);
    if (!SOFT) process.exitCode = 1;
    else console.log('(--soft: continuing anyway)');
  } else {
    console.log('Result: required tools look good. You can run:  npm start');
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
