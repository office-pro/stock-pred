#!/usr/bin/env node
/**
 * Run a command with the repo-root .env applied (file wins over inherited shell vars).
 * Prisma CLI otherwise looks only at packages/database/.env, which we do not keep.
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

loadEnvFile(path.resolve(__dirname, '../../.env'));
loadEnvFile(path.resolve(__dirname, '.env'));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node with-root-env.js <command> [args...]');
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
