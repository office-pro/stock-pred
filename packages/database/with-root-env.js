#!/usr/bin/env node
/**
 * Run a command with the repo-root .env applied (file wins over inherited shell vars).
 * Prisma CLI otherwise looks only at packages/database/.env, which we do not keep.
 *
 * Optional overlay (later file wins on duplicate keys):
 *   node with-root-env.js --env-file ../../.env.test-cloud prisma migrate deploy
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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
    process.env[key] = value;
  }
}

const root = path.resolve(__dirname, '../..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.resolve(__dirname, '.env'));

let args = process.argv.slice(2);
while (args[0] === '--env-file') {
  if (!args[1]) {
    console.error('usage: node with-root-env.js --env-file <path> <command> [args...]');
    process.exit(1);
  }
  const overlay = path.isAbsolute(args[1]) ? args[1] : path.resolve(__dirname, args[1]);
  loadEnvFile(overlay);
  args = args.slice(2);
}

if (args.length === 0) {
  console.error('usage: node with-root-env.js [--env-file <path>] <command> [args...]');
  process.exit(1);
}

const result = spawnSync(args[0], args.slice(1), {
  stdio: 'inherit',
  env: process.env,
  cwd: __dirname,
  shell: process.platform === 'win32',
  windowsHide: true,
});
process.exit(result.status === null ? 1 : result.status);
