import { yahooTickerCandidates } from './yahoo.provider';

describe('yahooTickerCandidates', () => {
  it('tries NSE then BSE then the scrip code for an NSE listing like ABMKNO', () => {
    expect(
      yahooTickerCandidates('ABMKNO', {
        exchange: 'NSE',
        bseCode: '531161',
        yahooSymbol: 'ABMKNO.NS',
      }),
    ).toEqual(['ABMKNO.NS', 'ABMKNO.BO', '531161.BO']);
  });

  it('prefers BSE scrip codes for BSE-primary names', () => {
    expect(
      yahooTickerCandidates('SOMESTOCK', {
        exchange: 'BSE',
        bseCode: '123456',
        yahooSymbol: 'SOMESTOCK.BO',
      }),
    ).toEqual(['SOMESTOCK.BO', '123456.BO', 'SOMESTOCK.NS']);
  });

  it('maps index symbols to Yahoo index tickers', () => {
    expect(yahooTickerCandidates('NIFTY_50')).toEqual(['^NSEI']);
  });
});
