import { parseNseFinancialResults, parseNseQuote } from './nse-fundamentals';

describe('NSE fundamentals parser', () => {
  it('builds snapshots from quarterly result rows', () => {
    const rows = parseNseFinancialResults('VOLTAS', [
      {
        fromDate: '01-Jan-2024',
        toDate: '31-Mar-2024',
        income: '3200',
        netProfit: '410',
        basicEPS: '12.5',
        broadcastingDate: '15-May-2024',
      },
      {
        toDate: '31-Mar-2025',
        income: 4000,
        netProfit: 500,
        basicEPS: 15,
        broadcastingDate: '12-May-2025',
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].source).toBe('nse');
    expect(rows[1].revenue).toBe(4000);
    expect(rows[1].pat).toBe(500);
    expect(rows[1].revYoy).not.toBeNull();
    expect(rows[1].netMargin).toBeCloseTo(0.125);
  });

  it('reads PE from quote-equity metadata', () => {
    const row = parseNseQuote('INFY', {
      info: { industry: 'Computers - Software' },
      metadata: { pdSymbolPe: 24.5, pdSymbolPb: 7.1 },
    });
    expect(row).not.toBeNull();
    expect(row?.source).toBe('nse-quote');
    expect(row?.trailingPe).toBe(24.5);
    expect(row?.priceToBook).toBe(7.1);
    expect(row?.sector).toBe('Computers - Software');
  });
});
