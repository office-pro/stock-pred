import {
  isUsableMlPrediction,
  resolveMlFreshness,
  type CachedMlPrediction,
} from './prediction-cache';

describe('ML prediction freshness (M1)', () => {
  const base: CachedMlPrediction = {
    symbol: 'TCS',
    horizon: 'NEXT_DAY',
    direction: 'UP',
    confidence: 72,
    expectedMove: 1.2,
    modelVersion: 'ensemble-v1',
    featureVersion: 'features.v1.4',
    datasetVersion: 'dataset.v1',
  };

  it('marks missing TTL as missing (not silently usable)', () => {
    expect(resolveMlFreshness(base)).toBe('missing');
    expect(isUsableMlPrediction(base)).toBe(false);
  });

  it('treats unexpired predictions as fresh', () => {
    const now = new Date('2026-08-23T10:00:00.000Z');
    const row: CachedMlPrediction = {
      ...base,
      expiresAt: '2026-08-23T12:00:00.000Z',
      predictionTimestamp: '2026-08-23T09:00:00.000Z',
    };
    expect(resolveMlFreshness(row, now)).toBe('fresh');
    expect(isUsableMlPrediction(row, now)).toBe(true);
  });

  it('treats expired predictions as stale', () => {
    const now = new Date('2026-08-23T13:00:00.000Z');
    const row: CachedMlPrediction = {
      ...base,
      expiresAt: '2026-08-23T12:00:00.000Z',
    };
    expect(resolveMlFreshness(row, now)).toBe('stale');
    expect(isUsableMlPrediction(row, now)).toBe(false);
  });

  it('rejects incompatible drift even when TTL is fresh (M4)', () => {
    const now = new Date('2026-08-23T10:00:00.000Z');
    const row: CachedMlPrediction = {
      ...base,
      expiresAt: '2026-08-23T12:00:00.000Z',
      driftStatus: 'incompatible',
    };
    expect(resolveMlFreshness(row, now)).toBe('fresh');
    expect(isUsableMlPrediction(row, now)).toBe(false);
  });

  it('keeps insufficient_data usable when fresh (M4)', () => {
    const now = new Date('2026-08-23T10:00:00.000Z');
    const row: CachedMlPrediction = {
      ...base,
      expiresAt: '2026-08-23T12:00:00.000Z',
      driftStatus: 'insufficient_data',
    };
    expect(isUsableMlPrediction(row, now)).toBe(true);
  });
});
