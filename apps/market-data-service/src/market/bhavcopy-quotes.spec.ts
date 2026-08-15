import { parseBhavCsv, parseIndexCloseCsv } from './bhavcopy-quotes';
import { MarketIndex } from '@stockpred/shared-types';

describe('parseBhavCsv', () => {
  it('parses NSE sec_bhavdata_full rows including prev close and volume', () => {
    const csv = [
      'SYMBOL,SERIES,DATE1,PREV_CLOSE,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,LAST_PRICE,CLOSE_PRICE,AVG_PRICE,TTL_TRD_QNTY,TURNOVER_LACS,NO_OF_TRADES,DELIV_QTY,DELIV_PER',
      '20MICRONS,EQ,14-Aug-2026,200.00,201.00,210.00,199.00,205.00,205.50,204.00,12345,25.5,100,5000,40.50',
      'SKIPME,BE,14-Aug-2026,10.00,10.00,10.00,10.00,10.00,10.00,10.00,1,1,1,1,1',
    ].join('\n');
    const rows = parseBhavCsv(csv, new Date(Date.UTC(2026, 7, 14)));
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('20MICRONS');
    expect(rows[0].close).toBe(205.5);
    expect(rows[0].prevClose).toBe(200);
    expect(rows[0].volume).toBe(12345);
  });
});

describe('parseIndexCloseCsv', () => {
  it('reads official NSE index closes, not hardcoded seeds', () => {
    const csv = [
      'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume',
      'Nifty 50,14-08-2026,24361.9,24405.2,24296.8,24366.0,-29.85,-.12,267706410',
      'NIFTY Midcap 100,14-08-2026,64114.55,64139.05,63746.1,63782.15,-339.4,-.53,1148477533',
      'India VIX,14-08-2026,11.4175,11.56,10.825,11.31,-0.11,-.99,-',
    ].join('\n');
    const rows = parseIndexCloseCsv(csv, new Date(Date.UTC(2026, 7, 14)));
    const nifty = rows.find((row) => row.index === MarketIndex.NIFTY_50);
    expect(nifty?.close).toBe(24366);
    expect(nifty?.prevClose).toBeCloseTo(24395.85, 2);
    expect(rows.find((row) => row.index === MarketIndex.INDIA_VIX)?.close).toBe(11.31);
  });
});
