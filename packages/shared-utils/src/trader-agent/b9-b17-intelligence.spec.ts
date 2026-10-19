import {
  assessBullRunIntelligence,
  assessFnoIntelligence,
  assessGlobalEventImpact,
  assessHistoricalEvents,
  assessInverseBeneficiaries,
  assessRelationship,
  buildSectorIntelligenceSnapshot,
  targetedUniverseFromGlobalEvent,
} from './index';

function synthCloses(n: number, start = 100, drift = 0.001): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] * (1 + drift + ((i % 7) - 3) * 0.0005));
  }
  return out;
}

describe('B9–B17 advisory engines', () => {
  it('B9 returns UNAVAILABLE without sector members', () => {
    const s = buildSectorIntelligenceSnapshot('IT', []);
    expect(s.status).toBe('UNAVAILABLE');
    expect(s.reason).toBe('MISSING_INPUT');
  });

  it('B9 is deterministic for same inputs', () => {
    const members = [
      {
        symbol: 'TCS',
        sector: 'IT',
        candles: synthCloses(280).map((close) => ({ close })),
        relativeStrength: 1.04,
      },
      {
        symbol: 'INFY',
        sector: 'IT',
        candles: synthCloses(280, 90, 0.0008).map((close) => ({ close })),
        relativeStrength: 1.01,
      },
      {
        symbol: 'WIPRO',
        sector: 'IT',
        candles: synthCloses(280, 80, -0.0005).map((close) => ({ close })),
        relativeStrength: 0.96,
      },
    ];
    const a = buildSectorIntelligenceSnapshot('IT', members, new Date('2026-01-01T00:00:00Z'));
    const b = buildSectorIntelligenceSnapshot('IT', members, new Date('2026-01-01T00:00:00Z'));
    expect(a.status).toBe('AVAILABLE');
    expect(a.state).toBe(b.state);
    expect(a.return20d).toBe(b.return20d);
    expect(a.return15d).toBe(b.return15d);
    expect(a.trendSeries?.length).toBeGreaterThan(5);
    expect(a.leaders.map((l) => l.symbol)).toEqual(b.leaders.map((l) => l.symbol));
  });

  it('B10 omits probabilities when history insufficient', () => {
    const snap = assessBullRunIntelligence({
      symbol: 'TCS',
      candles: synthCloses(10).map((close) => ({ close })),
    });
    expect(snap.status).toBe('UNAVAILABLE');
    expect(snap.stage).toBe('UNKNOWN');
    expect(snap.horizons.every((h) => h.bullRunProbability == null)).toBe(true);
  });

  it('B10 emits calibrated horizons with provenance when history sufficient', () => {
    const snap = assessBullRunIntelligence({
      symbol: 'TCS',
      candles: synthCloses(300).map((close) => ({ close })),
      relativeStrength: 1.05,
      sectorState: 'IMPROVING',
      mlUpProbability: 0.55,
      scannerBullScore: 72,
      regime: 'BULL',
    });
    expect(snap.status).toBe('AVAILABLE');
    expect(snap.provenance.modelVersion).toBeTruthy();
    expect(
      snap.horizons.some((h) => h.status === 'AVAILABLE' && h.bullRunProbability != null),
    ).toBe(true);
  });

  it('B11 relationship notes non-causation and needs history', () => {
    const short = assessRelationship('A', 'B', synthCloses(5), synthCloses(5), 'STOCK_STOCK');
    expect(short.status).toBe('UNAVAILABLE');
    const ok = assessRelationship(
      'A',
      'B',
      synthCloses(80),
      synthCloses(80, 100, 0.0012),
      'STOCK_STOCK',
    );
    expect(ok.status).toBe('AVAILABLE');
    expect(ok.note.toLowerCase()).toContain('not causation');
  });

  it('B12 does not invent beneficiaries without events', () => {
    const snap = assessInverseBeneficiaries(
      'RELIANCE',
      synthCloses(80, 100, 0.002),
      [{ symbol: 'TCS', closes: synthCloses(80) }],
      -0.05,
    );
    expect(snap.status).toBe('UNAVAILABLE');
    expect(['NO_COMPARABLE_EVENTS', 'INSUFFICIENT_HISTORY']).toContain(snap.reason);
  });

  it('B13 historical events require comparable sample', () => {
    const closes = synthCloses(120);
    const h = assessHistoricalEvents('TCS', closes, null, { dayReturnThreshold: -0.2 });
    expect(h.status).toBe('UNAVAILABLE');
  });

  it('B15 is always PROVIDER_NOT_CONFIGURED when provider off', () => {
    const f = assessFnoIntelligence('TCS', false);
    expect(f.status).toBe('UNAVAILABLE');
    expect(f.reason).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('B17 maps event to targeted subset without fabricating consensus', () => {
    const ev = assessGlobalEventImpact(
      {
        eventType: 'US CPI',
        source: 'test',
        actual: null,
        consensus: null,
      },
      [
        { symbol: 'TCS', sector: 'Information Technology' },
        { symbol: 'HDFCBANK', sector: 'Financial Services' },
      ],
    );
    expect(ev.status).toBe('AVAILABLE');
    expect(ev.surprise).toBe('Not available');
    const target = targetedUniverseFromGlobalEvent(ev);
    expect(target.symbols).toContain('TCS');
    expect(target.sectors.length).toBeGreaterThan(0);
  });

  it('engines never expose authorization fields', () => {
    const blob = JSON.stringify({
      sector: buildSectorIntelligenceSnapshot('IT', [
        {
          symbol: 'TCS',
          sector: 'IT',
          candles: synthCloses(50).map((close) => ({ close })),
        },
        {
          symbol: 'INFY',
          sector: 'IT',
          candles: synthCloses(50, 90).map((close) => ({ close })),
        },
      ]),
      bull: assessBullRunIntelligence({
        symbol: 'TCS',
        candles: synthCloses(100).map((close) => ({ close })),
      }),
      fno: assessFnoIntelligence('TCS'),
    });
    expect(blob).not.toMatch(/rankingScore|gateVerdict|brokerOrder|positionSize|authorization/i);
  });

  it('B9 uses live tip for return1d while longer horizons stay bar-based', () => {
    const fri = Date.UTC(2026, 8, 11, 10, 0, 0);
    const thu = Date.UTC(2026, 8, 10, 10, 0, 0);
    const tue = Date.UTC(2026, 8, 15, 5, 30, 0);
    const base = synthCloses(40, 100, 0.001);
    const mk = (symbol: string, last: number) => ({
      symbol,
      sector: 'IT',
      candles: base.map((close, i) => ({
        close: i === base.length - 1 ? 100 : close,
        time: i === base.length - 1 ? fri : thu - (base.length - i) * 86_400_000,
      })),
      lastPrice: last,
      previousClose: 100,
      quoteUpdatedAt: tue - 5_000,
      relativeStrength: 1.02,
    });
    const snap = buildSectorIntelligenceSnapshot(
      'IT',
      [mk('TCS', 103), mk('INFY', 106), mk('WIPRO', 101)],
      new Date(tue),
    );
    expect(snap.status).toBe('AVAILABLE');
    expect(snap.return1d).toBeCloseTo((0.03 + 0.06 + 0.01) / 3, 3);
    expect(snap.dataStatus).toBe('LIVE');
    expect(snap.return20d).not.toBeNull();
  });
});
