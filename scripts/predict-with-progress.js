#!/usr/bin/env node
/**
 * Predictions with visual progress bar (0-100%)
 * Usage: npm run predict:ml
 */
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const cwd = path.resolve(__dirname, '..');
const allStocks = args.includes('--all');
const pythonArgs = allStocks
  ? ['ml/predict-all.py', ...args.filter((arg) => arg !== '--all')]
  : ['ml/predict.py', ...args];
let progress = 0;
let isComplete = false;
let stockCount = 0;
let processedCount = 0;

function formatTime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / 1000 / 60) % 60);
  return `${minutes}m ${seconds}s`;
}

function drawProgressBar(current, label = '') {
  const width = 50;
  const percentage = Math.min(Math.round((current / 100) * 100), 100);
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Build status line
  let status = 'Generating Predictions';
  if (stockCount > 0) {
    status = `Processing ${processedCount}/${stockCount} stocks`;
  }
  if (label) status += ` - ${label}`;

  process.stdout.write(`\r🔮 Predictions: [${bar}] ${percentage}%  ${status}`);

  if (percentage >= 100) {
    process.stdout.write('\n');
  }
}

const startTime = Date.now();
let lastOutput = Date.now();
let autoProgressRate = 0.1;

// Main process
const proc = spawn('python', pythonArgs, {
  cwd,
  stdio: ['inherit', 'pipe', 'pipe'],
});

console.log(
  allStocks
    ? `\n🚀 Generating predictions for every listed stock\n`
    : `\n🚀 Generating Predictions\n`,
);
drawProgressBar(0, 'Initializing...');

// Auto-increment progress
const autoTickInterval = setInterval(() => {
  const timeSinceStart = Date.now() - startTime;

  // Adjust increment based on time
  if (timeSinceStart > 120000) {
    autoProgressRate = 0.8; // Speed up as we progress
  } else if (timeSinceStart > 60000) {
    autoProgressRate = 0.4;
  } else {
    autoProgressRate = 0.2;
  }

  if (progress < 98) {
    progress += autoProgressRate;

    // Estimate stage
    let stage = 'Loading models';
    if (progress > 20) stage = 'Loading data';
    if (progress > 40) stage = 'Computing features';
    if (progress > 60) stage = 'Running predictions';
    if (progress > 80) stage = 'Finalizing';
    if (progress > 90) stage = 'Saving results';

    drawProgressBar(progress, stage);
  }
}, 500);

// Monitor output for progress
proc.stdout.on('data', (data) => {
  const output = data.toString();
  lastOutput = Date.now();

  // Display ALL output with logging
  const lines = output.split('\n').filter((line) => line.trim());

  if (lines.length > 0) {
    process.stdout.write('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        // Format log line with timestamp and emoji
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        const logPrefix = /error|failed|exception|Traceback/.test(line)
          ? '❌'
          : /✓|complete|done/i.test(line)
            ? '✓'
            : /processing|predicting|loading/i.test(line)
              ? '⚙️'
              : /warning|deprecated/i.test(line)
                ? '⚠️'
                : '📝';
        console.log(`[${timestamp}] ${logPrefix} ${line}`);

        // Extract stock count if available
        const countMatch = line.match(/(\d+)\s+stocks?/i);
        if (countMatch) {
          stockCount = parseInt(countMatch[1], 10);
          progress = Math.min(30 + processedCount * (50 / Math.max(stockCount, 1)), 85);
        }

        // Extract processed count
        const processMatch = line.match(/\[(\d+)\/(\d+)\]/);
        if (processMatch) {
          processedCount = parseInt(processMatch[1], 10);
          stockCount = parseInt(processMatch[2], 10);
          progress = Math.min(30 + processedCount * (50 / Math.max(stockCount, 1)), 85);
        }
      }
    });
    drawProgressBar(progress);
  }

  // Check for completion patterns
  if (
    /successfully|predictions.*generated|all.*stocks.*processed|saved.*predictions/i.test(output)
  ) {
    isComplete = true;
    progress = 100;
    process.stdout.write('\n');
  }

  // Check for errors
  if (/error|failed|exception|Traceback/.test(output)) {
    isComplete = true;
    progress = 100;
    process.stdout.write('\n');
  }
});

// Monitor stderr
proc.stderr.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n').filter((line) => line.trim());

  if (lines.length > 0) {
    process.stdout.write('\n');
    lines.forEach((line) => {
      if (line.trim()) {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        const logPrefix = /error|failed|exception|Traceback/.test(line)
          ? '❌'
          : /warning|deprecated/i.test(line)
            ? '⚠️'
            : '📝';
        if (!/WARNING|deprecated|FutureWarning|INFO/.test(line)) {
          console.log(`[${timestamp}] ${logPrefix} [STDERR] ${line}`);
        }
      }
    });
    drawProgressBar(progress);
  }
});

// Handle completion
proc.on('close', (code) => {
  clearInterval(autoTickInterval);

  // Ensure 100%
  progress = 100;
  drawProgressBar(progress, 'Complete!');

  const totalTime = formatTime(Date.now() - startTime);

  if (code === 0) {
    console.log(`\n✅ Predictions Generated in ${totalTime}\n`);
    console.log('📊 Results saved to: predictions.jsonl');
    console.log('\nNext steps:');
    console.log('  npm run predict:view      - View predictions');
    console.log('  npm run predict:view:html - Export as HTML');
    console.log('  npm run predict:view:csv  - Export as CSV\n');
  } else {
    console.error(`\n❌ Predictions Failed (exit code ${code})\n`);
  }

  process.exit(code);
});

// Handle interruption
process.on('SIGINT', () => {
  clearInterval(autoTickInterval);
  proc.kill('SIGINT');
  console.log('\n\n⚠️  Prediction interrupted\n');
  process.exit(130);
});
