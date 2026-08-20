import {
  availableAtFromPeriodEnd,
  computeDisplayScore,
  FUNDAMENTAL_LAG_DAYS,
  parseQuoteSummary,
} from './yahoo-fundamentals';

const DAY_MS = 86_400_000;

function yahooRaw(value: number) {
  return { raw: value, fmt: String(value) };
}

function yahooDate(iso: string) {
  return { raw: Math.floor(Date.parse(iso) / 1000), fmt: iso.slice(0, 10) };
}

describe('yahoo fundamentals parser', () => {
  it('lags availableAt by 90 calendar days from period end', () => {
    const end = new Date(Date.UTC(2024, 2, 31));
    const available = availableAtFromPeriodEnd(end);
    expect(available.getTime() - end.getTime()).toBe(FUNDAMENTAL_LAG_DAYS * DAY_MS);
  });

  it('builds quarterly snapshots with YoY and does not invent promoter holdings', () => {
    const payload = {
      quoteSummary: {
        result: [
          {
            assetProfile: { sector: 'Technology' },
            defaultKeyStatistics: {
              sharesOutstanding: yahooRaw(1000),
              trailingEps: yahooRaw(12),
              bookValue: yahooRaw(50),
              trailingPE: yahooRaw(22),
              priceToBook: yahooRaw(4),
            },
            financialData: {
              revenueGrowth: yahooRaw(0.18),
              operatingMargins: yahooRaw(0.21),
              profitMargins: yahooRaw(0.14),
            },
            incomeStatementHistoryQuarterly: {
              incomeStatementHistory: [
                {
                  endDate: yahooDate('2025-03-31T00:00:00Z'),
                  totalRevenue: yahooRaw(120),
                  netIncome: yahooRaw(20),
                  ebit: yahooRaw(28),
                  grossProfit: yahooRaw(50),
                  operatingIncome: yahooRaw(28),
                },
                {
                  endDate: yahooDate('2024-12-31T00:00:00Z'),
                  totalRevenue: yahooRaw(110),
                  netIncome: yahooRaw(16),
                  ebit: yahooRaw(24),
                  grossProfit: yahooRaw(44),
                  operatingIncome: yahooRaw(24),
                },
                {
                  endDate: yahooDate('2024-09-30T00:00:00Z'),
                  totalRevenue: yahooRaw(100),
                  netIncome: yahooRaw(14),
                  ebit: yahooRaw(20),
                  grossProfit: yahooRaw(40),
                  operatingIncome: yahooRaw(20),
                },
                {
                  endDate: yahooDate('2024-06-30T00:00:00Z'),
                  totalRevenue: yahooRaw(90),
                  netIncome: yahooRaw(12),
                  ebit: yahooRaw(18),
                  grossProfit: yahooRaw(36),
                  operatingIncome: yahooRaw(18),
                },
                {
                  endDate: yahooDate('2024-03-31T00:00:00Z'),
                  totalRevenue: yahooRaw(80),
                  netIncome: yahooRaw(10),
                  ebit: yahooRaw(15),
                  grossProfit: yahooRaw(30),
                  operatingIncome: yahooRaw(15),
                },
              ],
            },
            balanceSheetHistoryQuarterly: {
              balanceSheetStatements: [
                {
                  endDate: yahooDate('2025-03-31T00:00:00Z'),
                  totalStockholderEquity: yahooRaw(200),
                  longTermDebt: yahooRaw(40),
                  totalCurrentAssets: yahooRaw(80),
                  totalCurrentLiabilities: yahooRaw(40),
                  cash: yahooRaw(25),
                  totalAssets: yahooRaw(300),
                },
              ],
            },
            cashflowStatementHistoryQuarterly: {
              cashflowStatements: [
                {
                  endDate: yahooDate('2025-03-31T00:00:00Z'),
                  totalCashFromOperatingActivities: yahooRaw(22),
                  capitalExpenditures: yahooRaw(-8),
                },
              ],
            },
          },
        ],
      },
    };

    const rows = parseQuoteSummary('INFY', payload);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const latest = rows[rows.length - 1];
    expect(latest.symbol).toBe('INFY');
    expect(latest.sector).toBe('Technology');
    expect(latest.asOfDate.toISOString().startsWith('2025-03-31')).toBe(true);
    expect(latest.availableAt.getTime()).toBe(availableAtFromPeriodEnd(latest.asOfDate).getTime());
    expect(latest.revYoy).not.toBeNull();
    expect(latest.revYoy as number).toBeGreaterThan(0);
    expect(latest.debtEquity).toBeCloseTo(0.2, 5);
    expect(latest.currentRatio).toBeCloseTo(2, 5);
    expect(latest.promoterHolding).toBeNull();
    expect(latest.institutionHolding).toBeNull();
    expect(latest.displayScore).not.toBeNull();
    expect(latest.displayScore as number).toBeGreaterThan(0);
    expect(latest.displayScore as number).toBeLessThanOrEqual(100);
  });

  it('scores a strong quality name higher than a weak one', () => {
    const strong = computeDisplayScore({
      revYoy: 0.25,
      patYoy: 0.2,
      roe: 0.22,
      netMargin: 0.18,
      debtEquity: 0.2,
      currentRatio: 1.8,
      ocfPat: 1.1,
      trailingPe: 18,
    });
    const weak = computeDisplayScore({
      revYoy: -0.08,
      patYoy: -0.12,
      roe: 0.02,
      netMargin: 0.01,
      debtEquity: 2.4,
      currentRatio: 0.9,
      ocfPat: 0.2,
      trailingPe: 55,
    });
    expect(strong).not.toBeNull();
    expect(weak).not.toBeNull();
    expect(strong as number).toBeGreaterThan(weak as number);
  });

  it('falls back to yahoo-live ratios when statement history is empty', () => {
    const rows = parseQuoteSummary('TINY', {
      quoteSummary: {
        result: [
          {
            assetProfile: { sector: 'Industrials' },
            defaultKeyStatistics: {
              trailingEps: yahooRaw(8),
              bookValue: yahooRaw(40),
              trailingPE: yahooRaw(18),
              priceToBook: yahooRaw(3.2),
            },
            financialData: {
              revenueGrowth: yahooRaw(0.1),
              profitMargins: yahooRaw(0.12),
              returnOnEquity: yahooRaw(0.16),
            },
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('yahoo-live');
    expect(rows[0].trailingPe).toBe(18);
    expect(rows[0].bookValue).toBe(40);
    expect(rows[0].revYoy).toBeCloseTo(0.1);
  });
});
