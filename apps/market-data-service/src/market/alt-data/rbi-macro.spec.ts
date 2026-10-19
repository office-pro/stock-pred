import { parseRbiSdmxObservations, preferRbiMacroPoints } from './rbi-macro';
import type { MacroPoint } from './yahoo-macro';

describe('RBI macro binding', () => {
  it('parses loose SDMX observations without inventing', () => {
    const rows = parseRbiSdmxObservations({
      data: [
        { TIME_PERIOD: '2026-08-01', OBS_VALUE: '5.5' },
        { TIME_PERIOD: 'bad', OBS_VALUE: 'x' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(5.5);
  });

  it('prefers RBI over FRED for same series/day', () => {
    const day = new Date('2026-08-01T00:00:00Z');
    const points: MacroPoint[] = [
      {
        seriesId: 'repo_rate',
        asOfDate: day,
        availableAt: day,
        value: 6.0,
        source: 'fred',
      },
      {
        seriesId: 'repo_rate',
        asOfDate: day,
        availableAt: day,
        value: 5.5,
        source: 'rbi',
      },
    ];
    const merged = preferRbiMacroPoints(points);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('rbi');
    expect(merged[0].value).toBe(5.5);
  });
});
