#!/usr/bin/env node
/**
 * Training with visual progress bar (0-100%)
 * Usage: npm run train:ml
 */
const { spawn } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);

const cwd = path.resolve(__dirname, '..');
let progress = 0;
let isComplete = false;
let currentHorizon = '';
const horizons = ['short', 'medium', 'long'];
let horizonIndex = 0;

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
  let status = 'Training';
  if (currentHorizon) status += ` (${currentHorizon})`;
  if (label) status += ` - ${label}`;

  process.stdout.write(`\r📊 ML Training: [${bar}] ${percentage}%  ${status}`);

  if (percentage >= 100) {
    process.stdout.write('\n');
  }
}

// Track timing
const startTime = Date.now();
let lastOutput = Date.now();
let tickCount = 0;

// Main process
const proc = spawn('python', ['ml/train.py', ...args], {
  cwd,
  stdio: ['inherit', 'pipe', 'pipe'],
});

console.log(`\n🚀 Training ML Models\n`);
drawProgressBar(0, 'Initializing...');

// Auto-increment progress
const autoTickInterval = setInterval(() => {
  tickCount++;
  const timeSinceStart = Date.now() - startTime;

  // Different increment rates based on time elapsed
  let increment = 0.2;
  if (timeSinceStart > 60000) increment = 0.3; // After 1 min: faster increment
  if (timeSinceStart > 180000) increment = 0.5; // After 3 min: even faster

  if (progress < 98) {
    progress += increment;
    const stage =
      progress < 25
        ? 'Loading Data'
        : progress < 50
          ? 'Building Features'
          : progress < 75
            ? 'Training Models'
            : progress < 90
              ? 'Saving Models'
              : 'Finalizing';
    drawProgressBar(progress, stage);
  }
}, 500);

// Monitor output for progress indicators
proc.stdout.on('data', (data) => {
  const output = data.toString();
  lastOutput = Date.now();

  // Display ALL output with logging
  const lines = output.split('\n').filter((line) => line.trim());
  if (lines.length > 0) {
    // Clear progress line and show logs
    process.stdout.write('\n');
    lines.forEach((line) => {
      // Format log line with timestamp
      const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
      const logPrefix = /error|failed|exception|Traceback/.test(line)
        ? '❌'
        : /\[train\]|saved|complete/i.test(line)
          ? '✓'
          : /warning|deprecated/i.test(line)
            ? '⚠️'
            : '📝';
      console.log(`[${timestamp}] ${logPrefix} ${line}`);
    });
    drawProgressBar(progress);
  }

  // Detect horizon completion
  if (/✓.*saved/.test(output) || /transformer saved/.test(output)) {
    horizonIndex++;
    progress = Math.min(25 + horizonIndex * 25, 98);
    currentHorizon = horizons[horizonIndex] || 'finalizing';
  }

  // Check for completion patterns
  if (/successfully|all.*models.*trained|training.*complete/i.test(output)) {
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
          : /warning|deprecated/.test(line)
            ? '⚠️'
            : '📝';
        if (!/WARNING|deprecated|FutureWarning/.test(line)) {
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
    console.log(`\n✅ Training Complete in ${totalTime}\n`);
    console.log('📁 Models saved to: ml-models/');
    console.log('\nNext steps:');
    console.log('  npm run predict           - Generate predictions');
    console.log('  npm run predict:view      - View prediction results\n');
  } else {
    console.error(`\n❌ Training Failed (exit code ${code})\n`);
  }

  process.exit(code);
});

// Handle interruption
process.on('SIGINT', () => {
  clearInterval(autoTickInterval);
  proc.kill('SIGINT');
  console.log('\n\n⚠️  Training interrupted\n');
  process.exit(130);
});
