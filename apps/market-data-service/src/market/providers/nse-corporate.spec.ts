import {
  parseNseAnnouncements,
  parseNseCorporateActions,
  shareholdingFromFundamentals,
} from './nse-corporate';

describe('NSE corporate parsers', () => {
  it('maps announcement payload to corporate panel rows', () => {
    const rows = parseNseAnnouncements('RELIANCE', {
      data: [{ subject: 'Board meeting', an_dt: '2026-09-01', desc: 'Board meeting' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('ANNOUNCEMENT');
    expect(rows[0].symbol).toBe('RELIANCE');
  });

  it('maps corporate actions separately from announcements', () => {
    const rows = parseNseCorporateActions('TCS', {
      data: [{ subject: 'Dividend', exDate: '2026-08-10', purpose: 'DIVIDEND' }],
    });
    expect(rows[0].kind).toBe('CORPORATE_ACTION');
    expect(rows[0].action_type).toContain('DIVIDEND');
  });

  it('emits shareholding evidence from fundamentals holdings', () => {
    const rows = shareholdingFromFundamentals({
      symbol: 'INFY',
      promoter_holding: 14.5,
      institution_holding: 50,
      available_at: '2026-08-01T00:00:00.000Z',
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'SHAREHOLDING')).toBe(true);
  });
});
