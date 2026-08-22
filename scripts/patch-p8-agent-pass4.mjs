import { readFileSync, writeFileSync } from 'fs';

const path = 'apps/trader-agent/src/agent/agent.service.ts';
let c = readFileSync(path, 'utf8');

// Remove unused legacy const (any variant)
c = c.replace(
  /\nconst AUTONOMOUS_MAX_PER_CYCLE_LEGACY = 3;[^\n]*\n/,
  '\n',
);

// Wire tenant into enforceBreakers calls
c = c.replace(
  /!this\.enforceBreakers\('autonomous-cycle'\)/,
  "!this.enforceBreakers('autonomous-cycle', userId, brandId)",
);

// Replace void metrics with acceptStarted + later lastCycleMetrics
if (c.includes('void analysisMs;')) {
  c = c.replace(
    `    const scanMs = Date.now() - cycleStarted;
    void analysisMs;
    void scanMs;
    const synced = await this.opportunitiesDb.syncPending(userId, brandId, limited);`,
    `    const scanMs = Date.now() - cycleStarted;
    const acceptStarted = Date.now();
    const synced = await this.opportunitiesDb.syncPending(userId, brandId, limited);`,
  );
}

// Insert lastCycleMetrics before return in getOpportunities if missing
if (!c.includes('this.lastCycleMetrics = {')) {
  const needle = `      autonomous = await this.runAutonomousCycle(
        userId,
        brandId,
        synced.map((row) => row.id),
      );
    }

    return {`;
  const insert = `      autonomous = await this.runAutonomousCycle(
        userId,
        brandId,
        synced.map((row) => row.id),
      );
    }

    this.lastCycleMetrics = {
      scanMs,
      analysisMs,
      acceptMs: Date.now() - acceptStarted,
      symbolsScanned: candidates.length,
      opportunitiesBuilt: limited.length,
      autonomousAttempted: autonomous?.attempted ?? 0,
      autonomousAccepted: autonomous?.accepted ?? 0,
    };

    return {`;
  if (!c.includes(needle)) throw new Error('autonomous return needle not found');
  c = c.replace(needle, insert);
}

// Update collectBreakerMetrics / enforceBreakers / getBreakerStatus / runAutonomousCycle for tenants
const oldEnforce = `  private enforceBreakers(context: string): boolean {
    const evaluation = evaluateBreakers(this.collectBreakerMetrics(), DEFAULT_BREAKER_CONFIG);
    if (!evaluation.tripped) {
      return false;
    }
    this.lastBreakerTripAt = Date.now();
    this.lastBreakerReasonCodes = evaluation.reasonCodes;
    this.lastBreakerReasons = evaluation.reasons;
    if (this.decisionMode === 'AUTONOMOUS') {
      this.decisionMode = 'APPROVAL';
      this.persistState();
      console.warn(
        \`[trader-agent] Phase 7 breaker trip (\${context}): \${evaluation.reasonCodes.join(',')} ? APPROVAL\`,
      );
    }
    return true;
  }`;

const newEnforce = `  private enforceBreakers(
    context: string,
    userId?: string,
    brandId?: string | null,
  ): boolean {
    const evaluation = evaluateBreakers(
      this.collectBreakerMetrics(userId, brandId),
      DEFAULT_BREAKER_CONFIG,
    );
    if (!evaluation.tripped) {
      return false;
    }
    this.lastBreakerTripAt = Date.now();
    this.lastBreakerReasonCodes = evaluation.reasonCodes;
    this.lastBreakerReasons = evaluation.reasons;
    if (this.decisionMode === 'AUTONOMOUS') {
      this.decisionMode = 'APPROVAL';
      this.persistState();
      console.warn(
        \`[trader-agent] Phase 7 breaker trip (\${context}): \${evaluation.reasonCodes.join(',')} → APPROVAL\`,
      );
    }
    return true;
  }`;

if (c.includes('private enforceBreakers(context: string): boolean')) {
  // more flexible replace via regex
  c = c.replace(
    /private enforceBreakers\(context: string\): boolean \{[\s\S]*?return true;\n  \}/,
    newEnforce.replace(/^  /gm, '  ').trim().replace(/^/, '  '),
  );
}

// collectBreakerMetrics with optional tenant
c = c.replace(
  /private collectBreakerMetrics\(\) \{\n    this\.rollBreakerDayIfNeeded\(\);\n    const brokerConnected = this\.mode !== 'LIVE' \|\| this\.brokerTestOk;\n    return emptyBreakerMetrics\(\{\n      dailyAutoAcceptCount: this\.dailyAutoAcceptCount,\n      autoPnlDrawdownPct: this\.autoPnlDrawdownPct,\n      consecutiveVetoCount: this\.consecutiveVetoCount,/,
  `private collectBreakerMetrics(userId?: string, brandId?: string | null) {
    this.rollBreakerDayIfNeeded();
    const tenant = userId
      ? this.tenantBreakers.get(userId, brandId)
      : null;
    const brokerConnected = this.mode !== 'LIVE' || this.brokerTestOk;
    return emptyBreakerMetrics({
      dailyAutoAcceptCount: tenant?.dailyAutoAcceptCount ?? this.dailyAutoAcceptCount,
      autoPnlDrawdownPct: tenant?.autoPnlDrawdownPct ?? this.autoPnlDrawdownPct,
      consecutiveVetoCount: tenant?.consecutiveVetoCount ?? this.consecutiveVetoCount,`,
);

// runAutonomousCycle: record tenant accepts; enforce before each accept sequentially
c = c.replace(
  /for \(const id of recommendationIds\.slice\(0, this\.scaleConfig\.maxAutonomousAcceptsPerCycle\)\) \{\n      attempted \+= 1;\n      try \{\n        await this\.approveRecommendation\(id, userId, undefined, brandId, \{ autonomous: true \}\);\n        accepted \+= 1;\n      \} catch \{\n        skipped \+= 1;\n      \}\n    \}/,
  `for (const id of recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle)) {
      // Sequential / single-flight accept — never parallelize authorization.
      if (this.enforceBreakers('autonomous-accept', userId, brandId)) {
        skipped += 1;
        break;
      }
      attempted += 1;
      try {
        await this.approveRecommendation(id, userId, undefined, brandId, { autonomous: true });
        accepted += 1;
        this.tenantBreakers.recordAutoAccept(userId, brandId);
        this.dailyAutoAcceptCount += 1;
      } catch {
        skipped += 1;
        this.tenantBreakers.recordVeto(userId, brandId);
        this.consecutiveVetoCount += 1;
      }
    }`,
);

// getBreakerStatus uses optional undefined tenant (global fallback ok for desk)
c = c.replace(
  'const evaluation = evaluateBreakers(this.collectBreakerMetrics());',
  'const evaluation = evaluateBreakers(this.collectBreakerMetrics());',
);

writeFileSync(path, c);
console.log('pass4', {
  legacyGone: !c.includes('AUTONOMOUS_MAX_PER_CYCLE_LEGACY'),
  lastCycleMetrics: c.includes('this.lastCycleMetrics = {'),
  enforceTenant: c.includes("enforceBreakers('autonomous-cycle', userId, brandId)"),
  recordAutoAccept: c.includes('tenantBreakers.recordAutoAccept'),
  collectTenant: c.includes('collectBreakerMetrics(userId?: string'),
});
