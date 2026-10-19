#!/usr/bin/env node
/**
 * Check whether local universe membership artifacts are already present.
 * Used by start:all-cloud to skip NSE/BSE/US/crypto downloads (rate limits).
 *
 *   node scripts/universe-cache-status.js           # print JSON status, exit 0
 *   node scripts/universe-cache-status.js --check   # exit 0 if ready, 1 if not
 *
 * Force refresh on cloud start: FORCE_UNIVERSE_INGEST=1 npm run start:all-cloud
 * Or: npm run ingest:universes:test-cloud
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'packages', 'database', 'data');
const equityPath = path.join(dataDir, 'equity-master.json');
const snapDir = path.join(dataDir, 'universe-snapshots');

/** Minimum eligible counts — below this we treat cache as missing/stale. */
const REQUIRED = [
  { id: 'equity-master', path: equityPath, min: 1000, kind: 'equity' },
  { id: 'NSE_ALL', path: path.join(snapDir, 'NSE_ALL.active.json'), min: 1000, kind: 'snapshot' },
  { id: 'US_ALL', path: path.join(snapDir, 'US_ALL.active.json'), min: 1000, kind: 'snapshot' },
  {
    id: 'CRYPTO_SPOT_ALL',
    path: path.join(snapDir, 'CRYPTO_SPOT_ALL.active.json'),
    min: 50,
    kind: 'snapshot',
  },
];

function countFor(entry) {
  if (!fs.existsSync(entry.path)) return { ok: false, count: 0, reason: 'missing' };
  try {
    const json = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    let count = 0;
    if (entry.kind === 'equity') {
      count = Array.isArray(json.stocks) ? json.stocks.length : 0;
    } else {
      count =
        Number(json.eligibleRecordCount) ||
        (Array.isArray(json.instruments) ? json.instruments.length : 0) ||
        0;
    }
    if (count < entry.min) {
      return { ok: false, count, reason: `below_min_${entry.min}` };
    }
    return { ok: true, count, reason: 'ok' };
  } catch (err) {
    return { ok: false, count: 0, reason: `parse_error:${err.message}` };
  }
}

const checks = REQUIRED.map((entry) => ({
  id: entry.id,
  min: entry.min,
  ...countFor(entry),
}));
const ready = checks.every((c) => c.ok);
const status = {
  ready,
  equityMasterPath: equityPath,
  checks,
  hint: ready
    ? 'Cache present — start:all-cloud will skip downloads. FORCE_UNIVERSE_INGEST=1 to refresh.'
    : 'Cache incomplete — start:all-cloud will download. Or run: npm run ingest:universes:test-cloud',
};

if (process.argv.includes('--check')) {
  if (!ready) {
    process.stderr.write(
      `[universe-cache] not ready: ${checks
        .filter((c) => !c.ok)
        .map((c) => `${c.id}(${c.reason})`)
        .join(', ')}\n`,
    );
  }
  process.exit(ready ? 0 : 1);
}

process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
