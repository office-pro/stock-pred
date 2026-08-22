/**
 * Phase 3 agent walk-forward CLI.
 * Usage:
 *   node dist/walk-forward-cli.js [--fixtures path] [--out path]
 * Default: synthetic demo opportunities → apps/trader-agent/data/agent-walkforward.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { AgentWalkForwardConfig, WalkForwardOpportunity } from '@stockpred/shared-types';
import { runAgentWalkForward, serializeWalkForwardReport } from '@stockpred/shared-utils';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 2, 10, 0, 0);

function defaultOutPath(): string {
  return resolve(__dirname, '../data/agent-walkforward.json');
}

function syntheticOpportunities(): WalkForwardOpportunity[] {
  const baseSetup = {
    instrument: 'TCS',
    direction: 'LONG' as const,
    entry: 3500,
    stopLoss: 3400,
    target1: 3700,
    target2: null,
    target3: null,
    riskReward: 2,
    positionSize: 10,
    expectedHoldingPeriod: '1-5d',
    confidence: 80,
    invalidation: 'Close below stop',
  };
  return [
    {
      opportunityId: 'demo-tcs-1',
      timestamp: T0,
      symbol: 'TCS',
      sector: 'IT',
      quote: { price: 3500, timestamp: T0 },
      regimeSnapshot: {
        marketRegime: 'RISK_ON',
        trend: 'BULL',
        volatility: 'MID',
        trendVolKey: 'BULL|MID',
      },
      analysis: {
        symbol: 'TCS',
        currentPrice: 3500,
        decision: 'BUY',
        scores: {
          fundamental: 70,
          technical: 80,
          sentiment: 60,
          quant: 65,
          macro: 55,
          sector: 60,
          risk: 70,
          overall: 78,
        },
        setup: { ...baseSetup },
        marketRegime: 'RISK_ON',
        thesis: 'Demo breakout',
        counterThesis: 'Risk-off',
        invalidation: 'Close below stop',
        risks: [],
        action: 'Propose long',
        usedCapabilities: ['quotes'],
        missingCapabilities: [],
        capabilityRequests: [],
        generatedAt: T0,
        disclaimer: 'Synthetic walk-forward fixture',
      },
      bars: [
        { timestamp: T0, open: 3490, high: 3510, low: 3480, close: 3500 },
        { timestamp: T0 + DAY, open: 3500, high: 3550, low: 3485, close: 3520 },
        { timestamp: T0 + DAY * 2, open: 3520, high: 3720, low: 3510, close: 3710 },
      ],
      horizonBars: 5,
    },
    {
      opportunityId: 'demo-infy-gap',
      timestamp: T0 + DAY,
      symbol: 'INFY',
      sector: 'IT',
      quote: { price: 1500, timestamp: T0 + DAY },
      regimeSnapshot: {
        marketRegime: 'NEUTRAL',
        trend: 'NEUTRAL',
        volatility: 'HIGH',
        trendVolKey: 'NEUTRAL|HIGH',
      },
      analysis: {
        symbol: 'INFY',
        currentPrice: 1500,
        decision: 'BUY',
        scores: {
          fundamental: 72,
          technical: 76,
          sentiment: 58,
          quant: 64,
          macro: 50,
          sector: 62,
          risk: 68,
          overall: 76,
        },
        setup: {
          ...baseSetup,
          instrument: 'INFY',
          entry: 1500,
          stopLoss: 1450,
          target1: 1600,
        },
        marketRegime: 'NEUTRAL',
        thesis: 'Demo pullback',
        counterThesis: 'Gap risk',
        invalidation: 'Close below stop',
        risks: [],
        action: 'Propose long',
        usedCapabilities: ['quotes'],
        missingCapabilities: [],
        capabilityRequests: [],
        generatedAt: T0 + DAY,
        disclaimer: 'Synthetic walk-forward fixture',
      },
      bars: [
        { timestamp: T0 + DAY, open: 1495, high: 1505, low: 1490, close: 1500 },
        // Large gap → may trip PRICE_DEVIATION depending on budgets
        { timestamp: T0 + DAY * 2, open: 1540, high: 1550, low: 1530, close: 1545 },
        { timestamp: T0 + DAY * 3, open: 1545, high: 1610, low: 1540, close: 1605 },
      ],
      horizonBars: 5,
    },
  ];
}

function parseArgs(argv: string[]): { fixtures?: string; out: string } {
  let fixtures: string | undefined;
  let out = defaultOutPath();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixtures' && argv[i + 1]) {
      fixtures = resolve(argv[++i]);
    } else if (arg === '--out' && argv[i + 1]) {
      out = resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: walk-forward-cli [--fixtures path.json] [--out path.json]
Default out: ${defaultOutPath()}`);
      process.exit(0);
    }
  }
  return { fixtures, out };
}

function loadOpportunities(fixturesPath?: string): {
  config: AgentWalkForwardConfig;
  opportunities: WalkForwardOpportunity[];
} {
  if (!fixturesPath) {
    return {
      config: { initialCash: 1_000_000, slippageBps: 5, confidenceSweep: [70, 100] },
      opportunities: syntheticOpportunities(),
    };
  }
  if (!existsSync(fixturesPath)) {
    throw new Error(`Fixtures not found: ${fixturesPath}`);
  }
  const raw = JSON.parse(readFileSync(fixturesPath, 'utf8')) as {
    config?: AgentWalkForwardConfig;
    opportunities?: WalkForwardOpportunity[];
  };
  if (!Array.isArray(raw.opportunities) || raw.opportunities.length === 0) {
    throw new Error('Fixtures JSON must include non-empty opportunities[]');
  }
  return {
    config: raw.config ?? { initialCash: 1_000_000, slippageBps: 5 },
    opportunities: raw.opportunities,
  };
}

function main(): void {
  const { fixtures, out } = parseArgs(process.argv.slice(2));
  const { config, opportunities } = loadOpportunities(fixtures);
  const report = runAgentWalkForward(config, opportunities);
  report.metadata.generatedAt = Date.now();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    serializeWalkForwardReport(report, { generatedAt: report.metadata.generatedAt }),
    'utf8',
  );
  console.log(
    `Wrote ${out} schema=${report.schemaVersion} technical=${report.verdict.technical} trading=${report.verdict.trading} filled=${report.funnel.filled}`,
  );
}

main();
