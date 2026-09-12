'use strict';

const { execSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
/** Docker Desktop / WSL proxies that publish container ports on the host. */
const PROTECTED_RE = /docker|vpnkit|wslrelay|wslhost|^System$|^Idle/i;

function processName(pid) {
  if (!pid) return '';
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = String(out).match(/^"([^"]+)"/);
      return match ? match[1].replace(/\.exe$/i, '') : '';
    }
    return execSync(`ps -p ${pid} -o comm=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function isProtectedPid(pid) {
  if (!pid || pid === 4) return true;
  return PROTECTED_RE.test(processName(pid));
}

module.exports = { isProtectedPid, processName };
