import {
  EngineRefreshGuard,
  ML_ENGINE_FAILURE_COOLDOWN_MS,
  classifyEngineFailureType,
} from './engine-refresh-guard';

describe('EngineRefreshGuard', () => {
  it('blocks overlapping refreshes (single-flight)', () => {
    const guard = new EngineRefreshGuard(120_000);
    expect(guard.tryBegin(1000)).toEqual({ ok: true });
    expect(guard.tryBegin(1001)).toEqual({
      ok: false,
      reason: 'IN_FLIGHT',
      remainingMs: 0,
    });
    guard.end();
    expect(guard.tryBegin(1002).ok).toBe(true);
    guard.end();
  });

  it('keeps in-flight through markFailure until end', () => {
    const guard = new EngineRefreshGuard(120_000);
    expect(guard.tryBegin(0).ok).toBe(true);
    guard.markFailure(1_000);
    expect(guard.isInFlight()).toBe(true);
    const overlap = guard.tryBegin(1_001);
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.reason).toBe('IN_FLIGHT');
    guard.end();
    expect(guard.isInFlight()).toBe(false);
  });

  it('enforces cooldown after failure independently of timer cadence', () => {
    const guard = new EngineRefreshGuard(ML_ENGINE_FAILURE_COOLDOWN_MS);
    expect(guard.tryBegin(0).ok).toBe(true);
    const { cooldownUntilMs } = guard.markFailure(1_000);
    guard.end();
    expect(cooldownUntilMs).toBe(1_000 + ML_ENGINE_FAILURE_COOLDOWN_MS);

    const skip = guard.tryBegin(60_000); // 60s later — timer would fire, cooldown still active
    expect(skip).toEqual({
      ok: false,
      reason: 'COOLDOWN',
      remainingMs: 1_000 + ML_ENGINE_FAILURE_COOLDOWN_MS - 60_000,
    });

    expect(guard.tryBegin(1_000 + ML_ENGINE_FAILURE_COOLDOWN_MS).ok).toBe(true);
    guard.end();
  });

  it('classifies timeout vs generic errors', () => {
    expect(classifyEngineFailureType(new Error('timeout of 30000ms exceeded'))).toBe('TIMEOUT');
    expect(classifyEngineFailureType(new Error('ECONNREFUSED'))).toBe('ERROR');
  });
});
