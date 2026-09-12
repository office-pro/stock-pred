import { readFileSync, writeFileSync } from 'fs';

const path = 'apps/trader-agent/src/agent/agent.service.ts';
let c = readFileSync(path, 'utf8');

// Align getMode property access with field names
c = c.replace(/this\.scaleConfig/g, 'this.scaleConfig');
c = c.replace(/this\.lastCycleMetrics/g, 'this.lastCycleMetrics');
c = c.replace(
  /AgentService\['lastCycleMetrics'\]/g,
  "AgentService['lastCycleMetrics']",
);
c = c.replace(
  /typeof loadScaleConfig/g,
  'typeof loadScaleConfig',
);

// Ensure accepts use scaleConfig
c = c.replace(
  /this\.scaleConfig\.maxAutonomousAcceptsPerCycle/g,
  'this.scaleConfig.maxAutonomousAcceptsPerCycle',
);
c = c.replace(
  /recommendationIds\.slice\(0,\s*AUTONOMOUS_MAX_PER_CYCLE(?:_LEGACY)?\)/g,
  'recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle)',
);

const oldLoopStart = '    const pendingBatch: Array<{ id: string; analysis: AgentAnalysis; expiresAt: Date }> = [];';
const oldLoopIdx = c.indexOf(oldLoopStart);
if (oldLoopIdx < 0) throw new Error('pendingBatch declaration not found');

const sortMarker = '    pendingBatch.sort(';
const sortIdx = c.indexOf(sortMarker, oldLoopIdx);
if (sortIdx < 0) throw new Error('pendingBatch.sort not found');

const replacement = `    const pendingBatch: Array<{ id: string; analysis: AgentAnalysis; expiresAt: Date }> = [];
    const scanStarted = Date.now();
    const scanCap = Math.min(
      this.scaleConfig.maxSymbolsScanned,
      Math.max(limit * 3, 20),
    );
    const candidates = quotes
      .slice(0, scanCap)
      .filter((quote) => {
        const sym = quote.symbol.toUpperCase();
        return !held.has(sym) && !alreadyAdded.has(sym);
      });

    // P8: parallel ANALYSIS only — authorization stays sequential in runAutonomousCycle.
    const analysisStarted = Date.now();
    const analyzed = await mapPool(
      candidates,
      this.scaleConfig.analysisConcurrency,
      async (quote) => {
        const analysis = await this.analyzeSymbol(quote.symbol, {
          quote,
          portfolio,
          statuses,
          requests,
        });
        if (this.scaleConfig.strategyTags.length > 0) {
          (analysis as { strategyTags?: string[] }).strategyTags = [
            ...this.scaleConfig.strategyTags,
          ];
        }
        return analysis;
      },
    );
    const analysisMs = Date.now() - analysisStarted;

    for (const analysis of analyzed) {
      if (analysis.decision.includes('BUY')) {
        const entry = analysis.setup.entry ?? 0;
        const affordable = entry > 0 ? Math.floor(cash / entry) : 0;
        if (affordable < 1) continue;
        if (analysis.setup.positionSize <= 0) {
          analysis.setup.positionSize = Math.min(1, affordable);
          analysis.action = \`Propose LONG \${analysis.setup.positionSize} shares with stop \${analysis.setup.stopLoss ?? '—'} and T1 \${analysis.setup.target1 ?? '—'}. Requires approval.\`;
        }
      }

      if (
        analysis.decision.includes('BUY') ||
        analysis.decision === 'WAIT' ||
        analysis.decision === 'STRONG_SELL'
      ) {
        const id = randomUUID();
        analysis.recommendationId = id;
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        pendingBatch.push({ id, analysis, expiresAt });
      }
    }

    const scanMs = Date.now() - scanStarted;
`;

c = c.slice(0, oldLoopIdx) + replacement + c.slice(sortIdx);

// After autonomous cycle, record metrics — find return block start after autonomous
if (!c.includes('this.lastCycleMetrics =')) {
  const autoAssign = '      autonomous = await this.runAutonomousCycle(';
  const autoIdx = c.indexOf(autoAssign);
  if (autoIdx >= 0) {
    // find closing of if block after autonomous assignment
    const afterAuto = c.indexOf('    return {', autoIdx);
    if (afterAuto > 0) {
      const metricsBlock = `
    this.lastCycleMetrics = {
      scanMs,
      analysisMs,
      acceptMs: autonomous ? Date.now() - analysisStarted : 0,
      symbolsScanned: candidates.length,
      opportunitiesBuilt: limited.length,
      autonomousAttempted: autonomous?.attempted ?? 0,
      autonomousAccepted: autonomous?.accepted ?? 0,
    };

`;
      // limited may not be in scope yet at return — use pendingBatch length after sort later
      // Insert just before return instead with safe fields
    }
  }
}

writeFileSync(path, c);
console.log('pass3 loop replaced', {
  mapPoolCall: c.includes('await mapPool('),
  scanCap: c.includes('maxSymbolsScanned'),
  strategyTags: c.includes('strategyTags'),
});
