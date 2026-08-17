import { candlesFromCloses } from './test-helpers';
import {
  buildBehaviorProfile,
  buildManipulationSnapshot,
  lastManipulationFeatures,
  MANIPULATION_MIN_BARS,
  zToAnomaly,
} from './manipulation-features';

function quietCloses(bars: number, base = 100): number[] {
  return Array.from({ length: bars }, (_, i) => base * (1 + 0.001 * Math.sin(i / 7)));
}

function typicalCloses(bars: number, base = 100): number[] {
  const closes: number[] = [];
  let price = base;
  for (let i = 0; i < bars; i += 1) {
    price *= 1 + 0.01 * Math.sin(i * 1.3) + 0.004 * Math.cos(i / 4);
    closes.push(price);
  }
  return closes;
}

function quietVolumes(bars: number, base = 1000): number[] {
  return Array.from({ length: bars }, (_, i) => base + 40 * Math.sin(i / 5));
}

describe('manipulation features', () => {
  it('maps |z| to a 0–100 anomaly score', () => {
    expect(zToAnomaly(0)).toBe(0);
    expect(zToAnomaly(2)).toBe(50);
    expect(zToAnomaly(-4)).toBe(100);
    expect(zToAnomaly(10)).toBe(100);
  });

  it('returns null when history is shorter than the profile window', () => {
    const candles = candlesFromCloses(quietCloses(40));
    expect(buildManipulationSnapshot({ candles })).toBeNull();
    expect(buildBehaviorProfile(candles)).toBeNull();
  });

  it('scores a quiet series as NORMAL with low intensity', () => {
    const bars = 90;
    const candles = candlesFromCloses(quietCloses(bars), { volumes: quietVolumes(bars) });
    const nifty = candlesFromCloses(quietCloses(bars, 24000));
    const snapshot = buildManipulationSnapshot({ candles, niftyCandles: nifty });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.band).toBe('NORMAL');
    expect(snapshot?.investigateIntensity).toBeLessThan(40);
    expect(snapshot?.investigateProbability).toBeNull();
    expect(snapshot?.modelVersion).toBe('statistical-v1');
  });

  it('flags a spike-plus-volume day as INVESTIGATE vs that stock’s own history', () => {
    const bars = 90;
    const closes = [...quietCloses(bars - 1), 130];
    const volumes = [...quietVolumes(bars - 1), 12000];
    const candles = candlesFromCloses(closes, { volumes });
    const nifty = candlesFromCloses(
      quietCloses(bars, 24000).map((c, i, arr) => (i === arr.length - 1 ? c * 1.005 : c)),
    );
    const snapshot = buildManipulationSnapshot({ candles, niftyCandles: nifty });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.investigateIntensity).toBeGreaterThanOrEqual(70);
    expect(snapshot!.band).toBe('INVESTIGATE');
    expect(snapshot!.volumeAnomaly).toBeGreaterThan(50);
    expect(snapshot!.priceAnomaly).toBeGreaterThan(50);
    expect(snapshot!.marketRelativeAnomaly).toBeGreaterThan(30);
    expect(snapshot!.evidence.some((row) => /volume/i.test(row))).toBe(true);
    expect(snapshot!.flags.expansion || snapshot!.evidence.length > 0).toBe(true);
  });

  it('does not treat a modest up-day as unusual for a typical-vol name', () => {
    const bars = 90;
    const closes = typicalCloses(bars - 1);
    closes.push(closes[closes.length - 1] * 1.008);
    const candles = candlesFromCloses(closes, { volumes: quietVolumes(bars) });
    const snapshot = buildManipulationSnapshot({ candles });
    expect(snapshot?.band).toBe('NORMAL');
    expect(snapshot?.investigateIntensity).toBeLessThan(40);
  });

  it('computes n-day returns, volume z, acceleration, and Nifty-relative features', () => {
    const bars = 80;
    const closes = Array.from({ length: bars }, (_, i) => 100 + i * 0.2);
    closes[closes.length - 1] = 140;
    const volumes = [...quietVolumes(bars - 1), 9000];
    const candles = candlesFromCloses(closes, { volumes });
    const nifty = candlesFromCloses(Array.from({ length: bars }, () => 24000));
    const feat = lastManipulationFeatures(candles, nifty);
    expect(feat.return1d).toBeGreaterThan(10);
    expect(feat.return5d).toBeGreaterThan(5);
    expect(feat.return10d).toBeGreaterThan(5);
    expect(feat.return20d).toBeGreaterThan(5);
    expect(feat.volumeZ20).toBeGreaterThan(2);
    expect(feat.volumeZ60).toBeGreaterThan(2);
    expect(feat.relReturn1d).toBeGreaterThan(10);
    expect(Math.abs(feat.acceleration)).toBeGreaterThan(0);
    expect(feat.signedReturnVolumeZ).toBeGreaterThan(0);
  });

  it('attaches ML probability when provided without claiming abuse', () => {
    const candles = candlesFromCloses(quietCloses(MANIPULATION_MIN_BARS + 10));
    const snapshot = buildManipulationSnapshot({
      candles,
      investigateProbability: 0.81,
      modelVersion: 'manipulation-boosted-v1',
    });
    expect(snapshot?.investigateProbability).toBe(0.81);
    expect(snapshot?.modelVersion).toBe('manipulation-boosted-v1');
  });
});
