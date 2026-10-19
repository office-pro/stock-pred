/**
 * MI-7.5 — Relationships status semantics (no fake correlation=0).
 */
import { assessAdvancedRelationshipSection } from './mi-7-relationship-engine';
import { nseEquityInstrumentRef } from './market-intelligence-core';

describe('MI-7.5 relationship engine', () => {
  const asOf = '2026-06-01T00:00:00.000Z';
  const instrument = nseEquityInstrumentRef('REL');

  it('NOT_APPLICABLE when no counterparts; never pearson=0', () => {
    const section = assessAdvancedRelationshipSection({
      instrument,
      selfCloses: Array.from({ length: 80 }, (_, i) => 100 + i * 0.1),
      counterparts: [],
      asOf,
      calculatedAt: asOf,
    });
    expect(section.status).toBe('NOT_APPLICABLE');
    expect(section.payload).toBeUndefined();
  });

  it('DATA_INCOMPLETE / UNAVAILABLE without fabricating correlation 0', () => {
    const section = assessAdvancedRelationshipSection({
      instrument,
      selfCloses: Array.from({ length: 80 }, (_, i) => 100 + i * 0.1),
      counterparts: [{ id: 'NIFTY', closes: [100, 101], kind: 'STOCK_INDEX' }],
      asOf,
      calculatedAt: asOf,
    });
    expect(['DATA_INCOMPLETE', 'UNAVAILABLE', 'PARTIAL']).toContain(section.status);
    if (section.payload) {
      for (const p of section.payload.pairs) {
        if (p.status !== 'AVAILABLE') {
          expect(p.pearson).toBeUndefined();
        }
      }
    }
  });
});
