#!/usr/bin/env node
/** Print DATABASE_URL or REDIS_URL host from the current process env (no secrets). */
'use strict';

const which = process.argv[2] === 'redis' ? 'REDIS_URL' : 'DATABASE_URL';
const raw = process.env[which] || '';
try {
  const u = new URL(raw);
  process.stdout.write(which === 'REDIS_URL' && u.port ? `${u.hostname}:${u.port}` : u.hostname);
} catch {
  if (which === 'REDIS_URL') {
    process.stdout.write(raw.replace(/^rediss?:\/\//, '').split('/')[0] || '');
  } else {
    process.stdout.write(((raw.match(/@([^/?]+)/) || [])[1] || '').split(':')[0]);
  }
}
