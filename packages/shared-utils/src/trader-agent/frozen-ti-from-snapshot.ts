import {
  Candle,
  MarketIndex,
  Timeframe,
  type BatchCandle,
  type BatchDataSnapshot,
  type BatchInstrumentData,
  type StockQuote,
} from '@stockpred/shared-types';
import { compareToBenchmark } from '../relative';
import { approximateW1ClosesFromD1, inferTradeHorizon } from './multi-horizon-agreement-engine';

function toCandles(symbol: string, rows: BatchCandle[] | undefined): Candle[] {
  return (rows ?? []).map((c) => ({
    symbol,
    timeframe: Timeframe.ONE_DAY,
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

export function marketContextFromShared(snapshot: BatchDataSnapshot | null | undefined):
  | {
      scannerRegime?: string;
      vixLevel?: number | null;
      niftyChangePercent?: number | null;
      breadthPercentAboveEma50?: number | null;
      asOf?: string | number;
    }
  | undefined {
  const nifty = snapshot?.shared?.benchmarks?.NIFTY_50?.candles;
  if (!nifty || nifty.length < 2) return undefined;
  const prev = nifty[nifty.length - 2]?.close;
  const last = nifty[nifty.length - 1]?.close;
  if (!(prev > 0) || !(last > 0)) return undefined;
  return {
    niftyChangePercent: ((last - prev) / prev) * 100,
    asOf: nifty[nifty.length - 1]?.time,
  };
}

export function tiCrossSectionalFromFrozen(input: {
  symbol: string;
  row?: BatchInstrumentData;
  quote?: StockQuote | null;
  snapshot?: BatchDataSnapshot | null;
}): {
  rsVsNifty50?: number | null;
  sector?: string | null;
  peVsMedianPct?: number | null;
  pbVsMedianPct?: number | null;
  asOf?: string | number;
  quoteRs?: number | null;
  scannerRs?: number | null;
  niftyRs?: number | null;
  benchmarkAvailable?: boolean;
  benchmarkDailyLength?: number | null;
  rsSource?: 'QUOTE' | 'SCANNER' | 'MISSING';
} {
  const quoteRs =
    typeof input.quote?.relativeStrengthNifty50 === 'number'
      ? input.quote.relativeStrengthNifty50
      : typeof input.row?.quote?.relativeStrengthNifty50 === 'number'
        ? input.row.quote.relativeStrengthNifty50
        : null;
  const nifty = input.snapshot?.shared?.benchmarks?.NIFTY_50?.candles ?? [];
  let computed: number | null = null;
  if (quoteRs == null && (input.row?.candles?.length ?? 0) >= 2 && nifty.length >= 2) {
    const cmp = compareToBenchmark(
      input.symbol,
      MarketIndex.NIFTY_50,
      toCandles(input.symbol, input.row?.candles),
      toCandles('NIFTY_50', nifty),
      60,
    );
    computed = cmp?.relativeStrength ?? null;
  }
  const rs = quoteRs ?? computed;
  const rsSource: 'QUOTE' | 'SCANNER' | 'MISSING' =
    quoteRs != null ? 'QUOTE' : rs != null ? 'SCANNER' : 'MISSING';
  return {
    rsVsNifty50: rs,
    sector:
      (typeof input.quote?.sector === 'string' && input.quote.sector) ||
      input.row?.quote?.sector ||
      null,
    peVsMedianPct: null,
    pbVsMedianPct: null,
    asOf: input.row?.dataAsOf ?? input.quote?.updatedAt,
    quoteRs,
    scannerRs: computed,
    niftyRs: quoteRs,
    benchmarkAvailable: nifty.length > 0,
    benchmarkDailyLength: nifty.length,
    rsSource,
  };
}

export function tiMultiHorizonFromFrozen(input: {
  row?: BatchInstrumentData;
  expectedHoldingPeriod?: string | null;
}): {
  tradeHorizon: ReturnType<typeof inferTradeHorizon>;
  intendedSide: 'LONG';
  closesByHorizon: Partial<Record<'M5' | 'M15' | 'H1' | 'H4' | 'D1' | 'W1', number[]>>;
  sourceDataTimestamp?: string;
  asOf?: number;
} | null {
  const candles = input.row?.candles ?? [];
  const d1 = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  if (!d1.length) return null;
  const lastTs = candles[candles.length - 1]?.time;
  return {
    tradeHorizon: inferTradeHorizon(input.expectedHoldingPeriod),
    intendedSide: 'LONG',
    closesByHorizon: {
      D1: d1,
      W1: approximateW1ClosesFromD1(d1),
    },
    sourceDataTimestamp:
      lastTs != null && Number.isFinite(lastTs) ? new Date(lastTs).toISOString() : undefined,
    asOf: lastTs != null && Number.isFinite(lastTs) ? lastTs : undefined,
  };
}
