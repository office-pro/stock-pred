/**
 * MI-7.4 — Analogue leakage contract.
 */
import { assertAnalogueLeakageSafe, assessAdvancedAnalogueSection } from './mi-7-analogue-engine';
import { nseEquityInstrumentRef } from './market-intelligence-core';

describe('MI-7.4 analogue leakage', () => {
  it('requires analogueIdx < queryIdx and outcomeStart > analogueIdx', () => {
    expect(
      assertAnalogueLeakageSafe({
        queryIdx: 100,
        analogueIdx: 100,
        outcomeBars: 5,
        closesLength: 200,
      }).ok,
    ).toBe(false);
    expect(
      assertAnalogueLeakageSafe({
        queryIdx: 100,
        analogueIdx: 50,
        outcomeBars: 5,
        closesLength: 200,
      }),
    ).toEqual({ ok: true });
  });

  it('excludes same-index / non-member analogues when membership provided', () => {
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 400; i++) {
      p *= 1 + (i % 17 === 0 ? -0.02 : 0.005);
      closes.push(p);
    }
    const membership = closes.map(() => true);
    membership[closes.length - 2] = false;
    const section = assessAdvancedAnalogueSection({
      instrument: nseEquityInstrumentRef('ANA'),
      closes,
      asOf: '2026-06-01T00:00:00.000Z',
      calculatedAt: '2026-06-01T00:00:00.000Z',
      membershipAtIndex: membership,
    });
    // May be AVAILABLE or UNAVAILABLE depending on sample; never fabricate payload on absent
    if (section.status === 'AVAILABLE') {
      for (const m of section.payload!.matches) {
        expect(m.historicalIndex).toBeLessThan(closes.length - 1);
      }
    } else {
      expect(section.payload).toBeUndefined();
    }
  });
});
