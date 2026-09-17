import type { Candle } from '@stockpred/shared-types';
import { Exchange, Timeframe } from '@stockpred/shared-types';
import {
  loadActiveUniverseSnapshot,
  membershipIdentity,
  type CanonicalUniverseInstrument,
} from '@stockpred/database';
import type { SymbolState } from '../market-state';
import type { CommodityQuotePrint } from './commodity-market-data';

function emptyState(row: CanonicalUniverseInstrument, key: string): SymbolState {
  return {
    info: {
      symbol: key,
      name: row.name,
      exchange: Exchange.NSE,
      sector: 'COMMODITY',
      indices: [],
    },
    daily: [],
    intraday: [],
    currentMinute: null,
    lastTick: null,
    previousClose: 0,
    dayVolume: 0,
    indicators: null,
    dataSource: 'listed',
  };
}

export class CommodityMarketBook {
  readonly states = new Map<string, SymbolState>();
  readonly rows = new Map<string, CanonicalUniverseInstrument>();

  loadSnapshots(): void {
    this.states.clear();
    this.rows.clear();
    const snapshot = loadActiveUniverseSnapshot('COMMODITY_ALL');
    if (!snapshot) return;
    for (const row of snapshot.instruments) {
      if (row.eligibilityStatus !== 'ELIGIBLE') continue;
      const key = membershipIdentity(row);
      if (!key) continue;
      this.rows.set(key, row);
      this.states.set(key, emptyState(row, key));
    }
  }

  get(symbol: string): SymbolState | undefined {
    const key = symbol.trim();
    return this.states.get(key) ?? this.states.get(key.toUpperCase());
  }

  applyPrint(print: CommodityQuotePrint, history: Array<{ time: number; value: number }>): void {
    const state = this.get(print.providerAssetId);
    if (!state) return;
    if (history.length) {
      state.daily = history.map(
        (bar) =>
          ({
            symbol: print.providerAssetId,
            timeframe: Timeframe.ONE_DAY,
            time: bar.time,
            open: bar.value,
            high: bar.value,
            low: bar.value,
            close: bar.value,
            volume: 0,
          }) satisfies Candle,
      );
    }
    state.previousClose = print.price;
    state.dataSource = 'live';
    state.lastTick = {
      symbol: print.providerAssetId,
      exchange: Exchange.NSE,
      price: print.price,
      volume: 0,
      time: print.listedAt,
    };
  }
}
