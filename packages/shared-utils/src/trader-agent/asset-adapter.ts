/**
 * AssetAdapter — market-specific identity/session/horizon/series seams.
 * Not an intelligence engine. Feeds normalized series into existing Bull-Run / Historical math.
 */

import type {
  AnalysisTimeframe,
  AssetClass,
  Candle,
  DataCapability,
  HorizonDefinition,
  InstrumentRef,
  PredictionHorizonKind,
  SeriesProvenance,
  SessionContextId,
  TemporalContext,
  VenueId,
} from '@stockpred/shared-types';
import { BULL_RUN_HORIZON_BARS, type BullRunCalendarHorizon } from '@stockpred/shared-types';
import { isNseCashSessionOpen } from '../market-hours';

export interface CanonicalSeries {
  closes: number[];
  volumes?: number[];
  times?: number[];
  priceReturnBasis?: 'CLOSE' | 'ADJUSTED_CLOSE' | 'LAST';
  seriesProvenance: SeriesProvenance;
}

export interface ResolvedHorizonWindow {
  definition: HorizonDefinition;
  /** Bar count when calendarSemantics allows bar mapping; undefined for NEXT_* kinds. */
  barCount?: number;
}

export interface AssetAdapter {
  readonly id: string;
  resolveInstrument(symbol: string, venueHint?: VenueId): InstrumentRef;
  temporalContext(now?: number): TemporalContext;
  isSessionOpen(now?: number): boolean;
  resolveHorizon(id: string, kind?: PredictionHorizonKind): ResolvedHorizonWindow;
  normalizeSeries(candles: Candle[]): CanonicalSeries;
  benchmarkId(): string | null;
  featureHints(): string[];
  capabilities(): DataCapability;
  productLabel(): 'BULL_RUN';
}

function equityCapabilityBase(partial: Partial<DataCapability> = {}): DataCapability {
  return {
    marketData: 'AVAILABLE',
    historicalCandles: 'AVAILABLE',
    benchmark: 'AVAILABLE',
    sector: 'AVAILABLE',
    fundamentals: 'PARTIAL',
    catalyst: 'PARTIAL',
    sentiment: 'UNAVAILABLE',
    ml: 'PARTIAL',
    historicalAnalogues: 'AVAILABLE',
    bullRun: 'AVAILABLE',
    relationships: 'PARTIAL',
    fno: 'PARTIAL',
    derivatives: 'UNAVAILABLE',
    positioning: 'UNAVAILABLE',
    globalImpact: 'PARTIAL',
    paperTrading: 'AVAILABLE',
    ...partial,
  };
}

const NSE_HORIZON_DEFS: Record<string, HorizonDefinition> = {
  '1D': {
    id: '1D',
    label: '1 Day',
    kind: 'DURATION',
    duration: 1,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['1D'],
  },
  '1W': {
    id: '1W',
    label: '1 Week',
    kind: 'DURATION',
    duration: 5,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['1W'],
  },
  '1M': {
    id: '1M',
    label: '1 Month',
    kind: 'DURATION',
    duration: 21,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['1M'],
  },
  '3M': {
    id: '3M',
    label: '3 Months',
    kind: 'DURATION',
    duration: 63,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['3M'],
  },
  '6M': {
    id: '6M',
    label: '6 Months',
    kind: 'DURATION',
    duration: 126,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['6M'],
  },
  '12M': {
    id: '12M',
    label: '12 Months',
    kind: 'DURATION',
    duration: 252,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['12M'],
  },
  '1Y': {
    id: '1Y',
    label: '1 Year',
    kind: 'DURATION',
    duration: 252,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
    barMapping: BULL_RUN_HORIZON_BARS['12M'],
  },
  '3D': {
    id: '3D',
    label: '3 Days',
    kind: 'DURATION',
    duration: 3,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
  },
  '5D': {
    id: '5D',
    label: '5 Days',
    kind: 'DURATION',
    duration: 5,
    calendarSemantics: 'TRADING_DAYS',
    assetClass: 'EQUITY',
  },
  NEXT_CANDLE: {
    id: 'NEXT_CANDLE',
    label: 'Next Candle',
    kind: 'NEXT_CANDLE',
    calendarSemantics: 'NEXT_OBSERVATION',
    assetClass: 'EQUITY',
  },
  NEXT_SESSION: {
    id: 'NEXT_SESSION',
    label: 'Next Session',
    kind: 'NEXT_SESSION',
    calendarSemantics: 'NEXT_OBSERVATION',
    assetClass: 'EQUITY',
  },
};

/** Behavior-preserving NSE cash equity adapter. */
export class NseEquityAdapter implements AssetAdapter {
  readonly id = 'nse-equity-v1';

  resolveInstrument(symbol: string, venueHint?: VenueId): InstrumentRef {
    const sym = String(symbol ?? '')
      .trim()
      .toUpperCase()
      .replace(/\.NS$/i, '')
      .replace(/\.BO$/i, '');
    return {
      symbol: sym,
      assetClass: 'EQUITY',
      venue: venueHint === 'BSE' ? 'BSE' : 'NSE',
      quoteCurrency: 'INR',
      canonicalSymbol: sym,
    };
  }

  temporalContext(now = Date.now()): TemporalContext {
    const ist = new Date(now + (5 * 60 + 30) * 60 * 1000);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    return {
      timezone: 'Asia/Kolkata',
      sessionMode: 'REGULAR',
      sessionDate: `${y}-${m}-${d}`,
      sessionContextId: 'NSE_REGULAR',
    };
  }

  isSessionOpen(now = Date.now()): boolean {
    return isNseCashSessionOpen(now);
  }

  resolveHorizon(id: string, kind?: PredictionHorizonKind): ResolvedHorizonWindow {
    const key = String(id || '').toUpperCase();
    const def =
      NSE_HORIZON_DEFS[key] ??
      (kind === 'NEXT_CANDLE'
        ? NSE_HORIZON_DEFS.NEXT_CANDLE
        : kind === 'NEXT_SESSION'
          ? NSE_HORIZON_DEFS.NEXT_SESSION
          : NSE_HORIZON_DEFS['3M']!);
    const barCount = def.kind === 'DURATION' && def.barMapping != null ? def.barMapping : undefined;
    return { definition: def, barCount };
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      volumes: sorted.map((c) => c.volume),
      times: sorted.map((c) => c.time),
      priceReturnBasis: 'CLOSE',
      seriesProvenance: {
        seriesType: 'EQUITY_CASH',
        source: 'mds-daily-candles',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string {
    return 'NIFTY50';
  }

  featureHints(): string[] {
    return ['sector', 'rs_vs_nifty50', 'fundamentals', 'fno', 'catalyst', 'ml'];
  }

  capabilities(): DataCapability {
    return equityCapabilityBase();
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** US equity adapter — Bull-Run AVAILABLE only when caller supplies real candles+benchmark. */
export class UsEquityAdapter implements AssetAdapter {
  readonly id = 'us-equity-v1';

  resolveInstrument(symbol: string): InstrumentRef {
    const sym = String(symbol ?? '')
      .trim()
      .toUpperCase();
    return {
      symbol: sym,
      assetClass: 'EQUITY',
      venue: 'NASDAQ',
      quoteCurrency: 'USD',
      canonicalSymbol: sym,
    };
  }

  temporalContext(now = Date.now()): TemporalContext {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return {
      timezone: 'America/New_York',
      sessionMode: 'REGULAR',
      sessionDate: fmt.format(now),
      sessionContextId: 'US_RTH',
    };
  }

  isSessionOpen(now = Date.now()): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    const mins = hour * 60 + minute;
    return mins >= 9 * 60 + 30 && mins <= 16 * 60;
  }

  resolveHorizon(id: string, kind?: PredictionHorizonKind): ResolvedHorizonWindow {
    // Same trading-day bar hints as NSE equities until US-specific calendar exists.
    return new NseEquityAdapter().resolveHorizon(id, kind);
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      volumes: sorted.map((c) => c.volume),
      times: sorted.map((c) => c.time),
      priceReturnBasis: 'CLOSE',
      seriesProvenance: {
        seriesType: 'EQUITY_CASH',
        source: 'mds-us-candles',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string {
    return 'SPX';
  }

  featureHints(): string[] {
    return ['sector', 'rs_vs_spx', 'earnings', 'options', 'news'];
  }

  /**
   * Default: historicalCandles/benchmark/bullRun UNAVAILABLE until real US provider wired.
   * Callers with verified candles may upgrade via {@link withLiveCapabilities}.
   */
  capabilities(): DataCapability {
    return equityCapabilityBase({
      marketData: 'PARTIAL',
      historicalCandles: 'UNAVAILABLE',
      benchmark: 'UNAVAILABLE',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      paperTrading: 'PARTIAL',
    });
  }

  withLiveCapabilities(): DataCapability {
    return equityCapabilityBase({
      marketData: 'AVAILABLE',
      historicalCandles: 'AVAILABLE',
      benchmark: 'AVAILABLE',
      sector: 'PARTIAL',
      fno: 'UNAVAILABLE',
    });
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** FX spot — Twelve Data membership identity; quotes/OHLCV hydrate separately. */
export class ForexAdapter implements AssetAdapter {
  readonly id = 'forex-spot-v1';

  resolveInstrument(symbol: string): InstrumentRef {
    const raw = String(symbol ?? '')
      .trim()
      .toUpperCase();
    const sym = raw.includes('/')
      ? raw
      : /^[A-Z]{6}$/.test(raw)
        ? `${raw.slice(0, 3)}/${raw.slice(3)}`
        : raw;
    const quote = sym.includes('/') ? (sym.split('/')[1] ?? 'USD') : 'USD';
    return {
      symbol: sym,
      assetClass: 'FX',
      venue: 'TWELVE_DATA',
      quoteCurrency: quote,
      canonicalSymbol: sym,
      providerAssetId: sym,
    };
  }

  temporalContext(now = Date.now()): TemporalContext {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return {
      timezone: 'UTC',
      sessionMode: 'REGULAR',
      sessionDate: fmt.format(now),
      sessionContextId: 'ROLLING_24H',
    };
  }

  isSessionOpen(now = Date.now()): boolean {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(
      now,
    );
    return weekday !== 'Sat' && weekday !== 'Sun';
  }

  resolveHorizon(id: string, kind?: PredictionHorizonKind): ResolvedHorizonWindow {
    return new NseEquityAdapter().resolveHorizon(id, kind);
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      volumes: sorted.map((c) => c.volume),
      times: sorted.map((c) => c.time),
      priceReturnBasis: 'CLOSE',
      seriesProvenance: {
        seriesType: 'SPOT',
        source: 'twelve-data-fx',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string {
    return 'EUR/USD';
  }

  featureHints(): string[] {
    return ['fx_pair'];
  }

  capabilities(): DataCapability {
    return equityCapabilityBase({
      marketData: 'PARTIAL',
      historicalCandles: 'UNAVAILABLE',
      benchmark: 'UNAVAILABLE',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      paperTrading: 'PARTIAL',
    });
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** Crypto spot — 24/7 temporal; capabilities gated until real candles exist. */
export class CryptoSpotAdapter implements AssetAdapter {
  readonly id = 'crypto-spot-v1';

  resolveInstrument(symbol: string): InstrumentRef {
    const sym = String(symbol ?? '')
      .trim()
      .toUpperCase();
    return {
      symbol: sym,
      assetClass: 'CRYPTO_SPOT',
      venue: 'BINANCE',
      quoteCurrency: sym.endsWith('USDT') ? 'USDT' : 'USD',
      canonicalSymbol: sym,
    };
  }

  temporalContext(): TemporalContext {
    return {
      timezone: 'UTC',
      sessionMode: 'ROLLING_24H',
      rollingWindow: '24H',
      sessionContextId: 'ROLLING_24H',
    };
  }

  isSessionOpen(): boolean {
    return true;
  }

  resolveHorizon(id: string): ResolvedHorizonWindow {
    const key = String(id || '').toUpperCase();
    const clockHours: Record<string, number> = {
      '1D': 24,
      '3D': 24 * 3,
      '5D': 24 * 5,
      '1W': 168,
      '1M': 24 * 30,
      '3M': 24 * 90,
      '6M': 24 * 180,
      '12M': 24 * 365,
      '1Y': 24 * 365,
    };
    if (clockHours[key] != null) {
      return {
        definition: {
          id: key,
          label: key,
          kind: 'DURATION',
          duration: clockHours[key],
          calendarSemantics: 'CLOCK_HOURS',
          assetClass: 'CRYPTO_SPOT',
        },
      };
    }
    return {
      definition: {
        id: 'NEXT_CANDLE',
        label: 'Next Candle',
        kind: 'NEXT_CANDLE',
        calendarSemantics: 'NEXT_OBSERVATION',
        assetClass: 'CRYPTO_SPOT',
      },
    };
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      volumes: sorted.map((c) => c.volume),
      times: sorted.map((c) => c.time),
      priceReturnBasis: 'CLOSE',
      seriesProvenance: {
        seriesType: 'SPOT',
        source: 'binance',
        provider: 'binance',
        providerSelectionReason: 'CRYPTO_MARKET_DATA_PROVIDER',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string | null {
    return 'BTCUSDT';
  }

  featureHints(): string[] {
    return ['funding', 'open_interest', 'liquidations', 'basis', 'onchain'];
  }

  capabilities(): DataCapability {
    return {
      marketData: 'AVAILABLE',
      historicalCandles: 'AVAILABLE',
      benchmark: 'PARTIAL',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      catalyst: 'UNAVAILABLE',
      sentiment: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      relationships: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      derivatives: 'UNAVAILABLE',
      positioning: 'UNAVAILABLE',
      globalImpact: 'UNAVAILABLE',
      paperTrading: 'PARTIAL',
    };
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** Crypto futures — Binance PERPETUAL/MONTHLY/QUARTERLY. Bull-Run stays UNAVAILABLE. */
export class CryptoFuturesAdapter implements AssetAdapter {
  readonly id = 'crypto-futures-v1';

  resolveInstrument(symbol: string): InstrumentRef {
    const raw = String(symbol ?? '').trim();
    const [sym, contractType, month] = raw.split(':');
    const ticker = String(sym ?? '')
      .trim()
      .toUpperCase();
    const type = String(contractType ?? 'PERPETUAL').toUpperCase();
    return {
      symbol: ticker,
      assetClass: 'CRYPTO_FUTURE',
      venue: 'BINANCE',
      quoteCurrency: ticker.endsWith('USDT') || ticker.endsWith('USDC') ? 'USDT' : 'USD',
      canonicalSymbol: raw,
      providerAssetId: raw,
      underlying: ticker.replace(/USDT|USDC|BUSD/g, '') || ticker,
      contractType: type === 'QUARTERLY' || type === 'MONTHLY' ? type : 'PERPETUAL',
      contractMonth: month,
    };
  }

  temporalContext(): TemporalContext {
    return {
      timezone: 'UTC',
      sessionMode: 'ROLLING_24H',
      rollingWindow: '24H',
      sessionContextId: 'ROLLING_24H',
    };
  }

  isSessionOpen(): boolean {
    return true;
  }

  resolveHorizon(id: string): ResolvedHorizonWindow {
    return {
      definition: {
        id: String(id || '1D'),
        label: String(id || '1D'),
        kind: 'DURATION',
        calendarSemantics: 'CLOCK_HOURS',
        assetClass: 'CRYPTO_FUTURE',
      },
    };
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      volumes: sorted.map((c) => c.volume),
      times: sorted.map((c) => c.time),
      priceReturnBasis: 'CLOSE',
      seriesProvenance: {
        seriesType: 'INDIVIDUAL_CONTRACT',
        contractSelectionPolicy: 'BINANCE_SYMBOL',
        rollPolicy: 'NONE_FOR_PERPETUAL',
        priceAdjustmentPolicy: 'RAW',
        source: 'binance-futures',
        provider: 'binance-futures',
        providerSelectionReason: 'CRYPTO_FUTURES_ALL',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string | null {
    return 'BTCUSDT:PERPETUAL';
  }

  featureHints(): string[] {
    return ['funding', 'open_interest', 'mark_price', 'basis'];
  }

  capabilities(): DataCapability {
    return {
      marketData: 'AVAILABLE',
      historicalCandles: 'AVAILABLE',
      benchmark: 'PARTIAL',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      catalyst: 'UNAVAILABLE',
      sentiment: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      relationships: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      derivatives: 'PARTIAL',
      positioning: 'UNAVAILABLE',
      globalImpact: 'UNAVAILABLE',
      paperTrading: 'PARTIAL',
    };
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** Commodity products/underlyings (Alpha Vantage / EIA) — not futures contracts. */
export class CommodityProductAdapter implements AssetAdapter {
  readonly id = 'commodity-product-v1';

  resolveInstrument(symbol: string): InstrumentRef {
    const sym = String(symbol ?? '')
      .trim()
      .toUpperCase();
    return {
      symbol: sym,
      assetClass: 'COMMODITY',
      venue: 'ALPHA_VANTAGE',
      quoteCurrency: 'USD',
      canonicalSymbol: sym,
      providerAssetId: sym,
      contractType: 'PRODUCT',
      underlying: sym,
    };
  }

  temporalContext(): TemporalContext {
    return {
      timezone: 'UTC',
      sessionMode: 'ROLLING_24H',
      sessionContextId: 'ROLLING_24H',
    };
  }

  isSessionOpen(): boolean {
    return false;
  }

  resolveHorizon(id: string): ResolvedHorizonWindow {
    return {
      definition: {
        id: String(id || '3M'),
        label: String(id || '3M'),
        kind: 'DURATION',
        calendarSemantics: 'CALENDAR_DAYS',
        assetClass: 'COMMODITY',
      },
    };
  }

  normalizeSeries(candles: Candle[]): CanonicalSeries {
    const sorted = [...(candles ?? [])].sort((a, b) => a.time - b.time);
    return {
      closes: sorted.map((c) => c.close).filter((x) => Number.isFinite(x)),
      seriesProvenance: {
        seriesType: 'SPOT',
        source: 'alpha-vantage',
        provider: 'alpha-vantage',
        providerSelectionReason: 'COMMODITY_ALL',
        dataAsOf: sorted.length ? sorted[sorted.length - 1]!.time : null,
      },
    };
  }

  benchmarkId(): string | null {
    return 'WTI';
  }

  featureHints(): string[] {
    return ['inventory', 'usd', 'energy'];
  }

  capabilities(): DataCapability {
    return {
      marketData: 'PARTIAL',
      historicalCandles: 'PARTIAL',
      benchmark: 'UNAVAILABLE',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      catalyst: 'UNAVAILABLE',
      sentiment: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      relationships: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      derivatives: 'UNAVAILABLE',
      positioning: 'UNAVAILABLE',
      globalImpact: 'UNAVAILABLE',
      paperTrading: 'UNAVAILABLE',
    };
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

/** Commodity / index futures stub — requires SeriesProvenance; no silent contract pick. */
export class FuturesStubAdapter implements AssetAdapter {
  readonly id: string;
  private readonly assetClass: AssetClass;
  private readonly venue: VenueId;

  constructor(opts: { id: string; assetClass: AssetClass; venue: VenueId }) {
    this.id = opts.id;
    this.assetClass = opts.assetClass;
    this.venue = opts.venue;
  }

  resolveInstrument(symbol: string): InstrumentRef {
    return {
      symbol: String(symbol ?? '')
        .trim()
        .toUpperCase(),
      assetClass: this.assetClass,
      venue: this.venue,
      quoteCurrency: 'USD',
    };
  }

  temporalContext(): TemporalContext {
    return {
      timezone: 'America/Chicago',
      sessionMode: 'CONTRACT_CALENDAR',
      sessionContextId: 'CONTRACT_CALENDAR',
    };
  }

  isSessionOpen(): boolean {
    return false;
  }

  resolveHorizon(id: string): ResolvedHorizonWindow {
    return {
      definition: {
        id: String(id || '3M'),
        label: String(id || '3M'),
        kind: 'DURATION',
        calendarSemantics: 'TRADING_DAYS',
        assetClass: this.assetClass,
      },
    };
  }

  normalizeSeries(_candles: Candle[]): CanonicalSeries {
    return {
      closes: [],
      seriesProvenance: {
        seriesType: 'INDIVIDUAL_CONTRACT',
        contractSelectionPolicy: 'UNSPECIFIED',
        rollPolicy: 'UNSPECIFIED',
        priceAdjustmentPolicy: 'UNSPECIFIED',
        source: 'futures-stub',
        dataAsOf: null,
      },
    };
  }

  benchmarkId(): string | null {
    return null;
  }

  featureHints(): string[] {
    return ['curve', 'open_interest', 'inventory', 'usd', 'roll'];
  }

  capabilities(): DataCapability {
    return {
      marketData: 'UNAVAILABLE',
      historicalCandles: 'UNAVAILABLE',
      benchmark: 'UNAVAILABLE',
      sector: 'UNAVAILABLE',
      fundamentals: 'UNAVAILABLE',
      catalyst: 'UNAVAILABLE',
      sentiment: 'UNAVAILABLE',
      ml: 'UNAVAILABLE',
      historicalAnalogues: 'UNAVAILABLE',
      bullRun: 'UNAVAILABLE',
      relationships: 'UNAVAILABLE',
      fno: 'UNAVAILABLE',
      derivatives: 'UNAVAILABLE',
      positioning: 'UNAVAILABLE',
      globalImpact: 'UNAVAILABLE',
      paperTrading: 'UNAVAILABLE',
    };
  }

  productLabel(): 'BULL_RUN' {
    return 'BULL_RUN';
  }
}

export type AdapterAssetHint =
  | 'NSE_EQUITY'
  | 'BSE_EQUITY'
  | 'US_EQUITY'
  | 'FOREX'
  | 'CRYPTO_SPOT'
  | 'COMMODITY'
  | 'COMMODITY_FUTURE'
  | 'INDEX_FUTURE'
  | 'CRYPTO_FUTURE';

const NSE = new NseEquityAdapter();
const US = new UsEquityAdapter();
const FOREX = new ForexAdapter();
const CRYPTO = new CryptoSpotAdapter();
const CRYPTO_FUT = new CryptoFuturesAdapter();
const COMMODITY = new CommodityProductAdapter();
const COMMODITY_FUT = new FuturesStubAdapter({
  id: 'commodity-future-stub-v1',
  assetClass: 'COMMODITY_FUTURE',
  venue: 'CME',
});
const INDEX_FUT = new FuturesStubAdapter({
  id: 'index-future-stub-v1',
  assetClass: 'INDEX_FUTURE',
  venue: 'CME',
});

/** Resolve adapter from explicit hint (default NSE equity). Never invent support from ticker heuristics alone. */
export function resolveAssetAdapter(
  _symbol: string,
  hint?: AdapterAssetHint | AssetClass | string | null,
): AssetAdapter {
  const h = String(hint ?? '')
    .trim()
    .toUpperCase();
  if (h === 'US_EQUITY') return US;
  if (h === 'FOREX' || h === 'FX') return FOREX;
  if (h === 'CRYPTO_SPOT' || h === 'CRYPTO') return CRYPTO;
  if (h === 'COMMODITY') return COMMODITY;
  if (h === 'COMMODITY_FUTURE') return COMMODITY_FUT;
  if (h === 'INDEX_FUTURE') return INDEX_FUT;
  if (h === 'CRYPTO_FUTURE') return CRYPTO_FUT;
  if (h === 'BSE_EQUITY') return NSE;
  return NSE;
}

export function listRegisteredAdapters(): AssetAdapter[] {
  return [NSE, US, CRYPTO, CRYPTO_FUT, COMMODITY, COMMODITY_FUT, INDEX_FUT];
}

export function defaultAnalysisTimeframe(): AnalysisTimeframe {
  return '3M';
}

export function defaultSessionContextForAdapter(adapter: AssetAdapter): SessionContextId {
  return adapter.temporalContext().sessionContextId;
}

/** Map Bull-Run calendar horizon ids through adapter (DURATION bars when available). */
export function adapterHorizonBars(
  adapter: AssetAdapter,
  horizon: BullRunCalendarHorizon,
): number | undefined {
  return adapter.resolveHorizon(horizon, 'DURATION').barCount;
}
