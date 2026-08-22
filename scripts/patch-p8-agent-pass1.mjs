import { readFileSync, writeFileSync } from 'fs';

const path = 'apps/trader-agent/src/agent/agent.service.ts';
let c = readFileSync(path, 'utf8');

if (!c.includes('loadScaleConfig')) {
  if (c.includes('evaluateBreakers,')) {
    c = c.replace(
      'evaluateBreakers,',
      `evaluateBreakers,
  loadScaleConfig,
  mapPool,
  TenantBreakerStore,`,
    );
  } else if (c.includes('evaluateBreakers')) {
    c = c.replace(
      'evaluateBreakers',
      `evaluateBreakers,
  loadScaleConfig,
  mapPool,
  TenantBreakerStore`,
    );
  } else {
    throw new Error('evaluateBreakers import not found');
  }
}

// Normalize legacy constant
c = c.replace(
  /const AUTONOMOUS_MAX_PER_CYCLE = 3;/,
  'const AUTONOMOUS_MAX_PER_CYCLE_LEGACY = 3; // P8: prefer this.scaleConfig',
);
c = c.replace(
  /const AUTONOMOUS_MAX_PER_CYCLE = 3;/,
  'const AUTONOMOUS_MAX_PER_CYCLE_LEGACY = 3; // P8: prefer this.scaleConfig',
);

if (!c.includes('private readonly scaleConfig')) {
  const markers = [
    'private lastBreakerReasons: string[] = [];',
    'private lastBreakerReasons: string[] = [];',
    'private lastBreakerReasons =',
  ];
  let inserted = false;
  for (const marker of markers) {
    const idx = c.indexOf(marker);
    if (idx >= 0) {
      const end = c.indexOf('\n', idx);
      const insert = `
  /** Phase 8 throughput knobs (analysis parallel; accept sequential). */
  private readonly scaleConfig = loadScaleConfig();
  private readonly tenantBreakers = new TenantBreakerStore();
  private lastCycleMetrics: {
    scanMs: number;
    analysisMs: number;
    acceptMs: number;
    symbolsScanned: number;
    opportunitiesBuilt: number;
    autonomousAttempted: number;
    autonomousAccepted: number;
  } | null = null;
`;
      c = c.slice(0, end + 1) + insert + c.slice(end + 1);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    // fallback: after tenantBreakers search failed, insert after exec fail streak
    const m = 'private execFailStreak = 0;';
    const idx = c.indexOf(m);
    if (idx < 0) throw new Error('could not insert scaleConfig fields');
    const end = c.indexOf('\n', idx);
    c =
      c.slice(0, end + 1) +
      `
  private readonly scaleConfig = loadScaleConfig();
  private readonly tenantBreakers = new TenantBreakerStore();
  private lastCycleMetrics: {
    scanMs: number;
    analysisMs: number;
    acceptMs: number;
    symbolsScanned: number;
    opportunitiesBuilt: number;
    autonomousAttempted: number;
    autonomousAccepted: number;
  } | null = null;
` +
      c.slice(end + 1);
  }
}

writeFileSync(path, c);
console.log('pass1', {
  loadScaleConfig: c.includes('loadScaleConfig'),
  scaleConfig: c.includes('scaleConfig'),
  mapPool: c.includes('mapPool'),
  TenantBreakerStore: c.includes('TenantBreakerStore'),
});
