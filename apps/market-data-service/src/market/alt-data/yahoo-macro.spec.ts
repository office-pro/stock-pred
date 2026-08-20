import { yahooMacroAvailableAt } from './yahoo-macro';

const DAY_MS = 86_400_000;

describe('yahoo macro availableAt', () => {
  it('uses the print day for USDINR and lags US/commodity closes by one day', () => {
    const asOf = new Date(Date.UTC(2024, 0, 10));
    expect(yahooMacroAvailableAt('usdinr', asOf).getTime()).toBe(asOf.getTime());
    expect(yahooMacroAvailableAt('spx', asOf).getTime() - asOf.getTime()).toBe(DAY_MS);
    expect(yahooMacroAvailableAt('brent', asOf).getTime() - asOf.getTime()).toBe(DAY_MS);
  });
});
