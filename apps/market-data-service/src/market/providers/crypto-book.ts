import type { Candle } from '@stockpred/shared-types';
import { Exchange, Timeframe } from '@stockpred/shared-types';
import {
  loadActiveUniverseSnapshot,
  membershipIdentity,
  type CanonicalUniverseInstrument,
} from '@stockpred/database';
import type { SymbolState } from '../market-state';
import {
  configuredCryptoMarketDataProvider,
  cryptoUniverseMatchesMarketData,
  remapBinanceFuturesPrints,
  resolveCryptoPrintKeys,
  type CryptoQuotePrint,
} from './crypto-market-data';

function emptyState(row: CanonicalUniverseInstrument, key: string): SymbolState {
  return {
    info: {
      symbol: key,
      name: row.name,
      exchange: Exchange.NSE,
      sector: row.assetClass === 'CRYPTO_FUTURE' ? 'CRYPTO_FUTURE' : 'CRYPTO_SPOT',
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

export class CryptoMarketBook {
  readonly states = new Map<string, SymbolState>();
  readonly rows = new Map<string, CanonicalUniverseInstrument>();
  spotUniverseProvider: string | null = null;

  loadSnapshots(): void {
    this.states.clear();
    this.rows.clear();
    const spot = loadActiveUniverseSnapshot('CRYPTO_SPOT_ALL');
    const futures = loadActiveUniverseSnapshot('CRYPTO_FUTURES_ALL');
    this.spotUniverseProvider =
      spot?.ingestionRun?.provider ?? spot?.instruments[0]?.provider ?? null;
    for (const snapshot of [spot, futures]) {
      if (!snapshot) continue;
      for (const row of snapshot.instruments) {
        if (row.eligibilityStatus !== 'ELIGIBLE') continue;
        const key = membershipIdentity(row);
        if (!key) continue;
        this.rows.set(key, row);
        this.states.set(key, emptyState(row, key));
      }
    }
  }

  /** Spot universe provider vs CRYPTO_MARKET_DATA_PROVIDER. Futures stay Binance independently. */
  marketDataMatchesSpotUniverse(): boolean {
    return cryptoUniverseMatchesMarketData(
      this.spotUniverseProvider,
      configuredCryptoMarketDataProvider(),
    );
  }

  get(symbol: string): SymbolState | undefined {
    const key = symbol.trim();
    return this.states.get(key) ?? this.states.get(key.toUpperCase());
  }

  applyPrints(prints: CryptoQuotePrint[]): void {
    for (const print of prints) {
      const keys = resolveCryptoPrintKeys(print, this.rows);
      for (const key of keys) {
        const state = this.states.get(key);
        if (!state) continue;
        const candle: Candle = {
          symbol: key,
          timeframe: Timeframe.ONE_DAY,
          time: print.listedAt,
          open: print.open,
          high: print.high,
          low: print.low,
          close: print.price,
          volume: print.volume,
        };
        const last = state.daily[state.daily.length - 1];
        if (last && Math.abs(last.time - candle.time) < 86_400_000) {
          state.daily[state.daily.length - 1] = candle;
        } else {
          state.daily.push(candle);
        }
        state.previousClose = print.open;
        state.dayVolume = print.volume;
        state.dataSource = 'live';
        state.lastTick = {
          symbol: key,
          exchange: Exchange.NSE,
          price: print.price,
          volume: print.volume,
          time: print.listedAt,
        };
      }
    }
  }

  applyFuturesTickers(prints: CryptoQuotePrint[]): void {
    this.applyPrints(remapBinanceFuturesPrints(prints, [...this.rows.values()]));
  }

  eligibleSpotIds(): Set<string> {
    const ids = new Set<string>();
    for (const row of this.rows.values()) {
      if (row.assetClass === 'CRYPTO_FUTURE') continue;
      ids.add(row.providerAssetId ?? row.symbol);
    }
    return ids;
  }

  eligibleFuturesSymbols(): Set<string> {
    const ids = new Set<string>();
    for (const row of this.rows.values()) {
      if (row.assetClass !== 'CRYPTO_FUTURE') continue;
      ids.add(row.symbol);
    }
    return ids;
  }

  hasFutures(): boolean {
    for (const row of this.rows.values()) {
      if (row.assetClass === 'CRYPTO_FUTURE') return true;
    }
    return false;
  }
}
