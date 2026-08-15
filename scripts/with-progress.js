#!/usr/bin/env node
/**
 * Generic progress bar wrapper for long-running commands
 * Usage: node with-progress.js <command> [args...]
 *
 * Example:
 *   node scripts/with-progress.js python ml/train.py
 *   node scripts/with-progress.js python ml/predict.py
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node with-progress.js <command> [args...]');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);
const cwd = path.resolve(__dirname, '..');

// Progress bar settings
let progress = 0;
const maxProgress = 100;
let isComplete = false;
let hasStarted = false;

// Patterns that indicate progress
const progressPatterns = [
  { pattern: /\[train\]/i, increment: 3 },
  { pattern: /loading|preparing/i, increment: 5 },
  { pattern: /processing|training|predicting|computing/i, increment: 2 },
  { pattern: /saving|saved/i, increment: 10 },
  { pattern: /✓|✔|done|complete/i, increment: 15 },
];

function drawProgressBar(current, total) {
  const width = 40;
  const percentage = Math.min(Math.round((current / total) * 100), 100);
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const status = percentage < 100 ? 'Running' : 'Complete';

  process.stdout.write(`\r[${bar}] ${percentage}% - ${status}`);

  if (percentage >= 100) {
    process.stdout.write('\n');
  }
}

function updateProgress(increment = 1) {
  if (!isComplete) {
    progress = Math.min(progress + increment, 95); // Cap at 95% until complete
    drawProgressBar(progress, maxProgress);
  }
}

function autoIncrement() {
  // Slow automatic increment when no output is detected
  if (!isComplete && progress < 90) {
    const randomIncrement = Math.random() * 0.5 + 0.1;
    progress += randomIncrement;
    drawProgressBar(progress, maxProgress);
  }
}

// Main process
const proc = spawn(command, commandArgs, {
  cwd,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

// Start progress display
console.log(`\n🚀 Running: ${command} ${commandArgs.join(' ')}\n`);

// Auto-increment progress every 500ms
const autoIncrementInterval = setInterval(autoIncrement, 500);

// Monitor stdout for progress indicators
proc.stdout.on('data', (data) => {
  const output = data.toString();
  hasStarted = true;

  // Print the output
  process.stdout.write(output);

  // Check for progress patterns
  for (const { pattern, increment } of progressPatterns) {
    if (pattern.test(output)) {
      updateProgress(increment);
    }
  }

  // Check for completion patterns
  if (/error|failed|exception/i.test(output) && !isComplete) {
    isComplete = true;
    progress = 100;
    drawProgressBar(progress, maxProgress);
  }
});

// Monitor stderr
proc.stderr.on('data', (data) => {
  const output = data.toString();
  process.stderr.write(output);
  hasStarted = true;

  if (/error|failed|exception/i.test(output)) {
    isComplete = true;
  }
});

// Handle completion
proc.on('close', (code) => {
  clearInterval(autoIncrementInterval);

  // Ensure we reach 100%
  if (!isComplete) {
    progress = 100;
    isComplete = true;
    drawProgressBar(progress, maxProgress);
  }

  if (code === 0) {
    console.log('✅ Process completed successfully\n');
  } else {
    console.error(`\n❌ Process failed with exit code ${code}\n`);
  }

  process.exit(code);
});

// Handle interruption
process.on('SIGINT', () => {
  clearInterval(autoIncrementInterval);
  proc.kill('SIGINT');
  console.log('\n\n⚠️  Process interrupted\n');
  process.exit(130);
});
