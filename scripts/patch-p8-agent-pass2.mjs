import { readFileSync, writeFileSync } from 'fs';

const path = 'apps/trader-agent/src/agent/agent.service.ts';
let c = readFileSync(path, 'utf8');

// Fix constant name if still present
c = c.replace(
  /const AUTONOMOUS_MAX_PER_CYCLE = 3;/,
  'const AUTONOMOUS_MAX_PER_CYCLE_LEGACY = 3; // P8: use this.scaleConfig',
);

// getMode: add scale + lastCycleMetrics to type and return
if (!c.includes('scale: ScaleThroughputConfig') && !c.includes('scale: ReturnType')) {
  c = c.replace(
    'breakers: ReturnType<AgentService[\'getBreakerStatus\']>;',
    `breakers: ReturnType<AgentService['getBreakerStatus']>;
    scale: ReturnType<typeof loadScaleConfig>;
    lastCycleMetrics: AgentService['lastCycleMetrics'];`,
  );
  // alternate type name
  c = c.replace(
    'breakers: ReturnType<AgentService["getBreakerStatus"]>;',
    `breakers: ReturnType<AgentService['getBreakerStatus']>;
    scale: ReturnType<typeof loadScaleConfig>;
    lastCycleMetrics: AgentService['lastCycleMetrics'];`,
  );
}

if (!c.includes('scale: this.scaleConfig')) {
  c = c.replace(
    'breakers: this.getBreakerStatus(),',
    `breakers: this.getBreakerStatus(),
      scale: this.scaleConfig,
      lastCycleMetrics: this.lastCycleMetrics,`,
  );
}

// runAutonomousCycle: sequential accept with scale config
c = c.replace(
  /recommendationIds\.slice\(0,\s*AUTONOMOUS_MAX_PER_CYCLE(?:_LEGACY)?\)/,
  'recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle)',
);

writeFileSync(path, c);
console.log('pass2', {
  scaleInMode: c.includes('scale: this.scaleConfig'),
  acceptsSlice: c.includes('this.scaleConfig.maxAutonomousAcceptsPerCycle'),
  legacyConst: c.includes('AUTONOMOUS_MAX_PER_CYCLE_LEGACY'),
});
