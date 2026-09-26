#!/usr/bin/env node
/**
 * Emit `export KEY='...'` lines for bash (safe for &/? in DATABASE_URL).
 *
 *   eval "$(node scripts/export-stockpred-env.js test-cloud)"
 *   eval "$(node scripts/export-stockpred-env.js local)"
 *
 * Bash `source .env` truncates values at `&` (sslmode=require query params),
 * which leaves the previous DATABASE_URL from .env (often localhost) in place.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile(file, into) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    into[key] = value;
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

const root = path.resolve(__dirname, '..');
const profile = process.argv[2] === 'test-cloud' ? 'test-cloud' : 'local';
const env = {};

loadEnvFile(path.join(root, '.env'), env);
loadEnvFile(path.join(root, '.env.local'), env);
if (profile === 'test-cloud') {
  loadEnvFile(path.join(root, '.env.test-cloud'), env);
  env.STOCKPRED_ENV_PROFILE = 'test-cloud';
} else {
  env.STOCKPRED_ENV_PROFILE = 'local';
}

for (const [key, value] of Object.entries(env)) {
  process.stdout.write(`export ${key}=${shellSingleQuote(value)}\n`);
}
