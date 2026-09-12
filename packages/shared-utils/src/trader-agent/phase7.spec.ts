import { DEFAULT_BREAKER_CONFIG, emptyBreakerMetrics, evaluateBreakers } from './circuit-breakers';

describe('Phase 7 — stop-only circuit breakers', () => {
  it('stays clear with healthy empty metrics', () => {
    const result = evaluateBreakers(emptyBreakerMetrics());
    expect(result.tripped).toBe(false);
    expect(result.reasonCodes).toEqual([]);
  });

  it('trips daily AUTO count ceiling', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({ dailyAutoAcceptCount: DEFAULT_BREAKER_CONFIG.maxDailyAutoAccepts }),
    );
    expect(result.tripped).toBe(true);
    expect(result.reasonCodes).toContain('BREAKER_DAILY_AUTO_COUNT');
  });

  it('trips autonomous P&L drawdown', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        autoPnlDrawdownPct: DEFAULT_BREAKER_CONFIG.maxAutoPnlDrawdownPct,
      }),
    );
    expect(result.reasonCodes).toContain('BREAKER_AUTO_PNL_DRAWDOWN');
  });

  it('trips veto streak', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({ consecutiveVetoCount: DEFAULT_BREAKER_CONFIG.maxVetoStreak }),
    );
    expect(result.reasonCodes).toContain('BREAKER_VETO_STREAK');
  });

  it('trips quote staleness', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({ quoteAgeMs: DEFAULT_BREAKER_CONFIG.maxQuoteAgeMs + 1 }),
    );
    expect(result.reasonCodes).toContain('BREAKER_QUOTE_STALE');
  });

  it('trips broker disconnect', () => {
    const result = evaluateBreakers(emptyBreakerMetrics({ brokerConnected: false }));
    expect(result.reasonCodes).toContain('BREAKER_BROKER_DISCONNECT');
  });

  it('trips score anomaly', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({ scoreAbsZ: DEFAULT_BREAKER_CONFIG.maxScoreAbsZ }),
    );
    expect(result.reasonCodes).toContain('BREAKER_SCORE_ANOMALY');
  });

  it('trips slippage anomaly', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({ lastSlippageAbsBps: DEFAULT_BREAKER_CONFIG.maxSlippageAbsBps }),
    );
    expect(result.reasonCodes).toContain('BREAKER_SLIPPAGE_ANOMALY');
  });

  it('trips quality Avg R flip (hist positive → live non-positive)', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        qualityBandScore: 85,
        qualityHistAvgR: 0.65,
        qualityLiveAvgR: -0.08,
      }),
    );
    expect(result.tripped).toBe(true);
    expect(result.reasonCodes).toContain('BREAKER_QUALITY_DRIFT');
  });

  it('does not trip quality drift when hist edge is weak', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        qualityBandScore: 85,
        qualityHistAvgR: 0.1,
        qualityLiveAvgR: -0.08,
      }),
    );
    expect(result.reasonCodes).not.toContain('BREAKER_QUALITY_DRIFT');
  });

  it('trips EV / calibration / regime / execution drift', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        evHistAvgR: 0.8,
        evLiveAvgR: 0.1,
        calibrationDrift: 0.3,
        regimeMismatchRate: 0.7,
        executionDeterioration: 0.6,
      }),
    );
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'BREAKER_EV_DRIFT',
        'BREAKER_CALIBRATION_DRIFT',
        'BREAKER_REGIME_DRIFT',
        'BREAKER_EXECUTION_DRIFT',
      ]),
    );
  });

  it('aggregates multiple reason codes and never implies AUTO_ACCEPTED', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        dailyAutoAcceptCount: 99,
        brokerConnected: false,
        consecutiveVetoCount: 99,
      }),
    );
    expect(result.tripped).toBe(true);
    expect(result.reasonCodes.length).toBeGreaterThanOrEqual(3);
    expect(result.reasonCodes.join(' ')).not.toMatch(/AUTO_ACCEPTED|LIVE_AUTONOMOUS_ARMED/);
    expect(result).not.toHaveProperty('liveAutoArmed');
    expect(result).not.toHaveProperty('outcome');
  });

  it('stays clear just below classic thresholds', () => {
    const result = evaluateBreakers(
      emptyBreakerMetrics({
        dailyAutoAcceptCount: DEFAULT_BREAKER_CONFIG.maxDailyAutoAccepts - 1,
        autoPnlDrawdownPct: DEFAULT_BREAKER_CONFIG.maxAutoPnlDrawdownPct - 0.001,
        consecutiveVetoCount: DEFAULT_BREAKER_CONFIG.maxVetoStreak - 1,
        quoteAgeMs: DEFAULT_BREAKER_CONFIG.maxQuoteAgeMs,
        scoreAbsZ: DEFAULT_BREAKER_CONFIG.maxScoreAbsZ - 0.01,
        lastSlippageAbsBps: DEFAULT_BREAKER_CONFIG.maxSlippageAbsBps - 1,
      }),
    );
    expect(result.tripped).toBe(false);
  });
});
