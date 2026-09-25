import { DbWritePressureTracker } from './db-write-pressure';

describe('DbWritePressureTracker', () => {
  it('enters degraded then paused on repeated pool-pressure failures', () => {
    const lines: string[] = [];
    let now = 1_000;
    const tracker = new DbWritePressureTracker({
      now: () => now,
      sleep: async () => undefined,
      log: (line) => lines.push(line),
    });

    tracker.recordPoolPressureFailure();
    expect(tracker.getLevel()).toBe('degraded');
    expect(lines.some((l) => l.includes('pressure_entered level=degraded'))).toBe(true);

    now = 2_000;
    tracker.recordPoolPressureFailure();
    expect(tracker.getLevel()).toBe('paused');
    expect(lines.some((l) => l.includes('pressure_entered level=paused'))).toBe(true);
  });

  it('skips low-priority writes while paused and proceeds when healthy', async () => {
    const tracker = new DbWritePressureTracker({
      sleep: async () => undefined,
      log: () => undefined,
    });
    tracker.recordPoolPressureFailure();
    tracker.recordPoolPressureFailure();
    expect(await tracker.beforeLowPriorityWrite()).toBe('skip');

    // recover via successes after quiet window
    let now = 100_000;
    const recovering = new DbWritePressureTracker({
      now: () => now,
      sleep: async () => undefined,
      log: () => undefined,
      quietMs: 1_000,
    });
    recovering.recordPoolPressureFailure(1_000);
    recovering.recordPoolPressureFailure(2_000);
    expect(recovering.getLevel()).toBe('paused');
    now = 20_000;
    recovering.recordWriteSuccess();
    recovering.recordWriteSuccess();
    recovering.recordWriteSuccess();
    expect(recovering.getLevel()).toBe('degraded');
    recovering.recordWriteSuccess();
    recovering.recordWriteSuccess();
    expect(recovering.getLevel()).toBe('healthy');
    expect(await recovering.beforeLowPriorityWrite()).toBe('proceed');
  });

  it('awaitBootstrapGate pauses then resumes without crashing', async () => {
    const lines: string[] = [];
    let now = 0;
    const tracker = new DbWritePressureTracker({
      now: () => now,
      pausePollMs: 1,
      quietMs: 5,
      failureWindowMs: 20,
      sleep: async () => {
        now += 25;
      },
      log: (line) => lines.push(line),
    });

    tracker.recordPoolPressureFailure(1);
    tracker.recordPoolPressureFailure(2);
    expect(tracker.getLevel()).toBe('paused');

    await tracker.awaitBootstrapGate();

    expect(tracker.getLevel()).not.toBe('paused');
    expect(lines.some((l) => l.includes('bootstrap_paused'))).toBe(true);
    expect(lines.some((l) => l.includes('bootstrap_resumed'))).toBe(true);
  });

  it('does not retry-storm: pause causes skip not endless writes', async () => {
    const tracker = new DbWritePressureTracker({
      sleep: async () => undefined,
      log: () => undefined,
    });
    tracker.recordPoolPressureFailure();
    tracker.recordPoolPressureFailure();
    const results = await Promise.all([
      tracker.beforeLowPriorityWrite(),
      tracker.beforeLowPriorityWrite(),
      tracker.beforeLowPriorityWrite(),
    ]);
    expect(results).toEqual(['skip', 'skip', 'skip']);
  });
});
