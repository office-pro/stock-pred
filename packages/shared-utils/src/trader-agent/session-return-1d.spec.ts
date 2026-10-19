import {
  computeCurrentSessionReturn1d,
  sessionReturn1dToPercent,
  stripFlatPhantomTip,
  istSessionDate,
} from './session-return-1d';

/** Fri 11 Sep 2026 ~15:30 IST as UTC ms for candle times. */
const FRI_CLOSE = Date.UTC(2026, 8, 11, 10, 0, 0); // 15:30 IST
const THU_CLOSE = Date.UTC(2026, 8, 10, 10, 0, 0);
/** Mon 14 Sep 2026 holiday morning IST. */
const MON_HOLIDAY = Date.UTC(2026, 8, 14, 4, 0, 0); // 09:30 IST Monday
/** Tue 15 Sep 2026 mid-session. */
const TUE_LIVE = Date.UTC(2026, 8, 15, 5, 30, 0); // 11:00 IST Tuesday

describe('computeCurrentSessionReturn1d', () => {
  it('uses live LTP vs previousClose during open session', () => {
    const candles = [
      { close: 98, time: THU_CLOSE },
      { close: 100, time: FRI_CLOSE },
    ];
    const r = computeCurrentSessionReturn1d({
      candles,
      lastPrice: 103,
      previousClose: 100,
      quoteUpdatedAt: TUE_LIVE - 5_000,
      now: TUE_LIVE,
    });
    expect(r.source).toBe('LIVE_LTP');
    expect(r.dataStatus).toBe('LIVE');
    expect(r.return1d).toBeCloseTo(0.03, 4);
    expect(r.sessionDate).toBe(istSessionDate(TUE_LIVE));
    expect(sessionReturn1dToPercent(r.return1d)).toBe(3);
  });

  it('holiday/phantom flat tip → PRIOR_SESSION Fri vs Thu, not LIVE 0%', () => {
    const candles = [
      { close: 98, time: THU_CLOSE },
      { close: 100, time: FRI_CLOSE },
      { close: 100, time: MON_HOLIDAY }, // phantom at previous close
    ];
    const r = computeCurrentSessionReturn1d({
      candles,
      lastPrice: 100,
      previousClose: 100,
      quoteUpdatedAt: MON_HOLIDAY,
      now: MON_HOLIDAY,
    });
    expect(r.dataStatus).toBe('PRIOR_SESSION');
    expect(r.source).toBe('PRIOR_SESSION');
    expect(r.return1d).toBeCloseTo(100 / 98 - 1, 4);
    expect(r.sessionDate).toBe(istSessionDate(FRI_CLOSE));
  });

  it('stale quote during session without today’s bar does not claim LIVE', () => {
    const candles = [
      { close: 98, time: THU_CLOSE },
      { close: 100, time: FRI_CLOSE },
    ];
    const r = computeCurrentSessionReturn1d({
      candles,
      lastPrice: 103,
      previousClose: 100,
      quoteUpdatedAt: TUE_LIVE - 120_000,
      now: TUE_LIVE,
    });
    expect(r.dataStatus).not.toBe('LIVE');
    expect(r.source).toBe('PRIOR_SESSION');
  });

  it('stripFlatPhantomTip removes equal trailing closes', () => {
    const out = stripFlatPhantomTip([
      { close: 98, time: 1 },
      { close: 100, time: 2 },
      { close: 100, time: 3 },
    ]);
    expect(out.map((c) => c.close)).toEqual([98, 100]);
  });

  it('cross-engine: session fraction and quote percent agree', () => {
    const r = computeCurrentSessionReturn1d({
      candles: [
        { close: 100, time: FRI_CLOSE },
        { close: 100, time: FRI_CLOSE },
      ],
      lastPrice: 103,
      previousClose: 100,
      quoteUpdatedAt: TUE_LIVE - 5_000,
      now: TUE_LIVE,
    });
    expect(r.return1d).toBeCloseTo(0.03, 4);
    expect(sessionReturn1dToPercent(r.return1d)).toBe(3);
  });
});
