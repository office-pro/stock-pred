#!/usr/bin/env node
/** Print DATABASE_URL or resolved Redis URL host from process env (no secrets). */
'use strict';

function resolveRedisUrl() {
  const mode = (process.env.REDIS_MODE || 'default').toLowerCase().trim();
  if (mode === 'default') {
    return process.env.REDIS_LOCAL_URL || 'redis://localhost:6379';
  }
  if (mode === 'test-cloud') {
    return process.env.REDIS_CLOUD_URL || process.env.REDIS_URL || '';
  }
  return '';
}

const which = process.argv[2] === 'redis' ? 'redis' : 'database';
const raw = which === 'redis' ? resolveRedisUrl() : process.env.DATABASE_URL || '';
try {
  const u = new URL(raw);
  process.stdout.write(which === 'redis' && u.port ? `${u.hostname}:${u.port}` : u.hostname);
} catch {
  if (which === 'redis') {
    process.stdout.write(raw.replace(/^rediss?:\/\//, '').split('/')[0] || '');
  } else {
    process.stdout.write(((raw.match(/@([^/?]+)/) || [])[1] || '').split(':')[0]);
  }
}
