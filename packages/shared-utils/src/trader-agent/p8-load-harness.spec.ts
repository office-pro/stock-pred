import { runP8AcceptHarness, runP8AnalysisHarness } from './p8-load-harness';

describe('p8-load-harness', () => {
  it('analysis harness: peakConcurrency <= configured, order preserved, all symbols processed', async () => {
    const result = await runP8AnalysisHarness({
      symbolCount: 24,
      concurrency: 4,
      workerDelayMs: 2,
    });
    expect(result.verdict).toBe('PASS');
    expect(result.peakConcurrency).toBeLessThanOrEqual(4);
    expect(result.processedCount).toBe(24);
    expect(result.orderPreserved).toBe(true);
    expect(result.outputs).toEqual(Array.from({ length: 24 }, (_, i) => i * 10 + i));
    expect(result.timingMs.p50).toBeGreaterThanOrEqual(0);
    expect(result.timingMs.p95).toBeGreaterThanOrEqual(result.timingMs.p50);
  });

  it('accept harness: accepted <= cap, sequential, no duplicates', () => {
    const result = runP8AcceptHarness({
      candidates: ['a', 'b', 'c', 'd', 'e', 'f'],
      acceptsPerCycle: 3,
    });
    expect(result.verdict).toBe('PASS');
    expect(result.accepted).toBe(3);
    expect(result.acceptedIds).toEqual(['a', 'b', 'c']);
    expect(result.sequential).toBe(true);
    expect(result.noDuplicates).toBe(true);
  });

  it('accept harness FAIL when duplicate candidate supplied', () => {
    const result = runP8AcceptHarness({
      candidates: ['x', 'x', 'y'],
      acceptsPerCycle: 5,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.some((f) => f.includes('duplicate'))).toBe(true);
  });
});
