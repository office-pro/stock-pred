#!/usr/bin/env node
/**
 * Load repo env files then run a command.
 *
 *   node scripts/with-stockpred-env.js              # local (.env + .env.local)
 *   node scripts/with-stockpred-env.js test-cloud -- <cmd...>
 *   node scripts/with-stockpred-env.js local -- <cmd...>
 *
 * test-cloud overlays `.env.test-cloud` (Supabase + Upstash) on top of local defaults.
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

const root = path.resolve(__dirname, '..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));

let args = process.argv.slice(2);
let profile = 'local';
if (args[0] === 'test-cloud' || args[0] === 'local') {
  profile = args[0];
  args = args.slice(1);
}
if (args[0] === '--') args = args.slice(1);

if (profile === 'test-cloud') {
  loadEnvFile(path.join(root, '.env.test-cloud'));
  process.env.STOCKPRED_ENV_PROFILE = 'test-cloud';
} else {
  process.env.STOCKPRED_ENV_PROFILE = 'local';
}

if (args.length === 0) {
  const dbHost = ((process.env.DATABASE_URL || '').match(/@([^/]+)\//) || [])[1] || '(unset)';
  const redisHost =
    ((process.env.REDIS_URL || '').match(/@([^/]+)/) || [])[1] ||
    (process.env.REDIS_URL || '').replace(/^rediss?:\/\//, '').split('/')[0] ||
    '(unset)';
  console.log(
    JSON.stringify({ profile: process.env.STOCKPRED_ENV_PROFILE, dbHost, redisHost }, null, 2),
  );
  process.exit(0);
}

const result = spawnSync(args[0], args.slice(1), {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
  shell: process.platform === 'win32',
  windowsHide: true,
});
process.exit(result.status === null ? 1 : result.status);
