import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_BREAKER_CONFIG, emptyBreakerMetrics, evaluateBreakers } from './circuit-breakers';
import { applyDecisionPolicy } from './decision-policy';
import { isLiveAutoEffectivelyArmed, readP5EvidenceUnlock } from './p5-evidence-unlock';
import {
  DEFAULT_SCALE_CONFIG,
  TenantBreakerStore,
  loadScaleConfig,
  mapPool,
  tenantKey,
} from './throughput-scale';

const okRisk = {
  allowed: true as const,
  riskScore: 1,
  quantity: 10,
  riskAmount: 500,
  stopLoss: 95,
  maxLoss: 500,
  riskReward: 2,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

const okPortfolio = {
  allowed: true as const,
  openPositions: 0,
  cash: 100_000,
  requiredCapital: 1_000,
  nameExposurePct: 5,
  sectorExposurePct: 10 as number | null,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

describe('Phase 8 — scale throughput (same brain)', () => {
  it('raises throughput knobs above legacy hardcodes (3 accepts / 80 scan)', () => {
    const cfg = loadScaleConfig({});
    expect(cfg.maxAutonomousAcceptsPerCycle).toBeGreaterThanOrEqual(3);
    expect(cfg.maxSymbolsScanned).toBeGreaterThan(80);
    expect(cfg.analysisConcurrency).toBeGreaterThanOrEqual(1);
    expect(cfg.maxOpportunities).toBeGreaterThanOrEqual(5);
  });

  it('parses env overrides within safe bounds', () => {
    const cfg = loadScaleConfig({
      AGENT_MAX_SYMBOLS_SCANNED: '200',
      AGENT_MAX_OPPORTUNITIES: '60',
      AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '12',
      AGENT_ANALYSIS_CONCURRENCY: '6',
      AGENT_STRATEGY_TAGS: 'MOMENTUM,BREAKOUT',
    });
    expect(cfg.maxSymbolsScanned).toBe(200);
    expect(cfg.maxOpportunities).toBe(60);
    expect(cfg.maxAutonomousAcceptsPerCycle).toBe(12);
    expect(cfg.analysisConcurrency).toBe(6);
    expect(cfg.strategyTags).toEqual(['MOMENTUM', 'BREAKOUT']);
  });

  it('mapPool bounds concurrency and preserves order (analysis-only helper)', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('tenant breaker counters are isolated by (userId, brandId)', () => {
    const store = new TenantBreakerStore();
    store.recordAutoAccept('u1', 'b1');
    store.recordAutoAccept('u1', 'b1');
    store.recordVeto('u1', 'b2');
    store.recordVeto('u2', 'b1');

    expect(store.snapshot('u1', 'b1').dailyAutoAcceptCount).toBe(2);
    expect(store.snapshot('u1', 'b1').consecutiveVetoCount).toBe(0);
    expect(store.snapshot('u1', 'b2').consecutiveVetoCount).toBe(1);
    expect(store.snapshot('u1', 'b2').dailyAutoAcceptCount).toBe(0);
    expect(store.snapshot('u2', 'b1').consecutiveVetoCount).toBe(1);
    expect(tenantKey('u1', 'b1')).not.toBe(tenantKey('u1', 'b2'));
  });

  it('P7 breakers still stop when daily auto count hits ceiling', () => {
    const evaluation = evaluateBreakers(
      emptyBreakerMetrics({
        dailyAutoAcceptCount: DEFAULT_BREAKER_CONFIG.maxDailyAutoAccepts,
      }),
    );
    expect(evaluation.tripped).toBe(true);
    expect(evaluation.reasonCodes).toContain('BREAKER_DAILY_AUTO_COUNT');
  });

  it('LIVE + AUTONOMOUS stays HUMAN_REQUIRED while evidence NO-GO (P5/P6 unchanged)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p8-ev-'));
    const path = join(dir, 'review.json');
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 'p5-evidence-review.v1',
        overallDecision: 'NO-GO',
        generatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    expect(readP5EvidenceUnlock(path).unlocked).toBe(false);
    expect(isLiveAutoEffectivelyArmed(true, path)).toBe(false);

    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk as never,
      portfolio: okPortfolio as never,
      liveAutoArmed: false,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
    expect(live.reasonCodes).toContain('LIVE_AUTONOMOUS_NOT_ARMED');
  });

  it('scale config does not create an alternate policy outcome path', () => {
    const cfg = loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '50' });
    expect(cfg.maxAutonomousAcceptsPerCycle).toBe(50);
    const paper = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk as never,
      portfolio: okPortfolio as never,
    });
    expect(paper.outcome).toBe('AUTO_ACCEPTED');
    expect(DEFAULT_SCALE_CONFIG).not.toHaveProperty('outcome');
  });
});
