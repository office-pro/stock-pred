import { readFileSync, writeFileSync } from 'fs';

const path = 'apps/trader-agent/src/agent/agent.service.ts';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);

function findLine(pred, from = 0) {
  for (let i = from; i < lines.length; i++) if (pred(lines[i], i)) return i;
  return -1;
}

// --- runAutonomousCycle loop ---
{
  const start = findLine((l) => l.includes('private async runAutonomousCycle('));
  const forLine = findLine(
    (l) => l.includes('for (const id of recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle))'),
    start,
  );
  const returnLine = findLine((l) => l.trim() === 'return { attempted, accepted, skipped };', forLine);
  if (forLine < 0 || returnLine < 0) throw new Error('runAutonomousCycle loop not found');
  const indent = '    ';
  const replacement = [
    `${indent}// Sequential / single-flight accept loop — never parallelize authorization.`,
    `${indent}for (const id of recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle)) {`,
    `${indent}  if (this.enforceBreakers('autonomous-accept', userId, brandId)) {`,
    `${indent}    skipped += 1;`,
    `${indent}    break;`,
    `${indent}  }`,
    `${indent}  attempted += 1;`,
    `${indent}  try {`,
    `${indent}    await this.approveRecommendation(id, userId, undefined, brandId, { autonomous: true });`,
    `${indent}    accepted += 1;`,
    `${indent}    this.tenantBreakers.recordAutoAccept(userId, brandId);`,
    `${indent}    this.dailyAutoAcceptCount += 1;`,
    `${indent}  } catch {`,
    `${indent}    skipped += 1;`,
    `${indent}    this.tenantBreakers.recordVeto(userId, brandId);`,
    `${indent}    this.consecutiveVetoCount += 1;`,
    `${indent}  }`,
    `${indent}}`,
  ];
  lines.splice(forLine, returnLine - forLine, ...replacement);
}

// --- collectBreakerMetrics signature ---
{
  const i = findLine((l) => l.trim() === 'private collectBreakerMetrics() {');
  if (i < 0) throw new Error('collectBreakerMetrics not found');
  lines[i] = '  private collectBreakerMetrics(userId?: string, brandId?: string | null) {';
  // After roll day line, inject tenant lookup and swap counters
  const roll = findLine((l) => l.includes('this.rollBreakerDayIfNeeded()') || l.includes('this.rollBreakerDayIfNeeded()'), i);
  const broker = findLine((l) => l.includes('const brokerConnected'), i);
  if (broker < 0) throw new Error('brokerConnected not found');
  // Insert tenant line before brokerConnected if missing
  if (!lines.slice(i, broker + 1).some((l) => l.includes('tenantBreakers.get'))) {
    lines.splice(
      broker,
      0,
      '    const tenant = userId ? this.tenantBreakers.get(userId, brandId) : null;',
    );
  }
  // Replace metric source lines
  for (let j = i; j < i + 40 && j < lines.length; j++) {
    if (lines[j].includes('dailyAutoAcceptCount: this.dailyAutoAcceptCount')) {
      lines[j] = lines[j].replace(
        'dailyAutoAcceptCount: this.dailyAutoAcceptCount',
        'dailyAutoAcceptCount: tenant?.dailyAutoAcceptCount ?? this.dailyAutoAcceptCount',
      );
    }
    if (lines[j].includes('autoPnlDrawdownPct: this.autoPnlDrawdownPct')) {
      lines[j] = lines[j].replace(
        'autoPnlDrawdownPct: this.autoPnlDrawdownPct',
        'autoPnlDrawdownPct: tenant?.autoPnlDrawdownPct ?? this.autoPnlDrawdownPct',
      );
    }
    if (lines[j].includes('consecutiveVetoCount: this.consecutiveVetoCount')) {
      lines[j] = lines[j].replace(
        'consecutiveVetoCount: this.consecutiveVetoCount',
        'consecutiveVetoCount: tenant?.consecutiveVetoCount ?? this.consecutiveVetoCount',
      );
    }
  }
}

// --- enforceBreakers signature + body ---
{
  const i = findLine((l) => l.trim() === 'private enforceBreakers(context: string): boolean {');
  if (i < 0) throw new Error('enforceBreakers not found');
  const end = findLine((l) => l.trim() === 'return true;', i);
  const close = findLine((l) => l.trim() === '}', end);
  const replacement = [
    '  private enforceBreakers(',
    '    context: string,',
    '    userId?: string,',
    '    brandId?: string | null,',
    '  ): boolean {',
    '    const evaluation = evaluateBreakers(',
    '      this.collectBreakerMetrics(userId, brandId),',
    '      DEFAULT_BREAKER_CONFIG,',
    '    );',
    '    if (!evaluation.tripped) {',
    '      return false;',
    '    }',
    '    this.lastBreakerTripAt = Date.now();',
    '    this.lastBreakerReasonCodes = evaluation.reasonCodes;',
    '    this.lastBreakerReasons = evaluation.reasons;',
    "    if (this.decisionMode === 'AUTONOMOUS') {",
    "      this.decisionMode = 'APPROVAL';",
    '      this.persistState();',
    '      console.warn(',
    '        `[trader-agent] Phase 7 breaker trip (${context}): ${evaluation.reasonCodes.join(\',\')} → APPROVAL`,',
    '      );',
    '    }',
    '    return true;',
    '  }',
  ];
  lines.splice(i, close - i + 1, ...replacement);
}

writeFileSync(path, lines.join('\n'));
console.log('line-patched OK');
