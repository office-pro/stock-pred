#!/usr/bin/env node
/**
 * Cross-platform launcher for the platform lifecycle scripts.
 *
 * The lifecycle logic lives in scripts/{start,stop,restart}-platform.sh
 * (single source of truth, used directly on Linux/macOS/CI). On Windows,
 * plain `bash` usually resolves to the WSL stub in System32 - which fails
 * with "execvpe(/bin/bash) failed" when no distro is installed - so this
 * launcher locates a real bash (Git Bash) and runs the script with it.
 */
const { spawnSync, execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const ACTIONS = ['start', 'stop', 'restart'];
const action = process.argv[2];

if (!ACTIONS.includes(action)) {
  console.error(`Usage: node scripts/platform.js <${ACTIONS.join('|')}>`);
  process.exit(1);
}

function findBash() {
  if (process.platform !== 'win32') return 'bash';

  const candidates = [];
  // Derive Git Bash from the git executable location (most reliable).
  try {
    const gitPath = execSync('where git', { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (gitPath) {
      const gitRoot = path.dirname(path.dirname(gitPath)); // <root>\cmd\git.exe -> <root>
      candidates.push(path.join(gitRoot, 'bin', 'bash.exe'));
      candidates.push(path.join(gitRoot, 'usr', 'bin', 'bash.exe'));
    }
  } catch {
    /* git not on PATH; fall through to the well-known locations */
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
const script = path.join('scripts', `${action}-platform.sh`);
const result = spawnSync(bash, [script], { cwd: repoRoot, stdio: 'inherit' });
process.exit(result.status ?? 1);
