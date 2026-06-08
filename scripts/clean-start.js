#!/usr/bin/env node
/**
 * Clean start launcher: kills all, clears cache, restarts.
 * Uses the same bash-finding logic as platform.js.
 */
const { spawnSync, execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

function findBash() {
  if (process.platform !== 'win32') return 'bash';

  const candidates = [];
  try {
    const gitPath = execSync('where git', { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (gitPath) {
      const gitRoot = path.dirname(path.dirname(gitPath));
      candidates.push(path.join(gitRoot, 'bin', 'bash.exe'));
      candidates.push(path.join(gitRoot, 'usr', 'bin', 'bash.exe'));
    }
  } catch {
    /* git not on PATH; fall through to well-known locations */
  }
  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  );

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const bash = findBash();
if (!bash) {
  console.error(
    'No usable bash found. Install Git for Windows (https://gitforwindows.org) ' +
      'or a WSL distro, then re-run this command.',
  );
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const script = path.join('scripts', 'clean-start.sh');
const result = spawnSync(bash, [script], { cwd: repoRoot, stdio: 'inherit' });
process.exit(result.status ?? 1);
