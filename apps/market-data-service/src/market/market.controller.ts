import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Candle,
  FundamentalView,
  AltDataView,
  IndexQuote,
  ManipulationSnapshot,
  MarketDepth,
  MarketIndex,
  MultiTimeframeCandles,
  PeerValuationView,
  RelativeComparison,
  StockQuote,
  Timeframe,
} from '@stockpred/shared-types';
import { MarketService } from './market.service';
import { FundamentalsStore } from './fundamentals-store';
import { AltDataStore } from './alt-data-store';
import { parseFullFlag } from './alt-data/ingest-freshness';
import { B9B17IntelligenceService } from './b9-b17-intelligence.service';
import type { RelationshipPairKind } from '@stockpred/shared-types';

@Controller()
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly fundamentals: FundamentalsStore,
    private readonly altData: AltDataStore,
    private readonly b9b17: B9B17IntelligenceService,
  ) {}

  @Get('stocks')
  getStocks(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('exchange') exchange?: string,
    @Query('suggestion') suggestion?: string,
    @Query('horizon') horizon?: string,
    @Query('sort') sort?: string,
  ): {
    data: StockQuote[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    counts: { NSE: number; BSE: number; all: number };
    suggestions: { BUY: number; SELL: number; HOLD: number };
    maxProfitPct: number;
    maxProfitSymbol: string | null;
    bullRunCount: number;
  } {
    return this.market.getQuotesPaginated(page, limit, search, exchange, suggestion, horizon, sort);
  }

  @Get('stocks/:symbol')
  getStock(@Param('symbol') symbol: string): Promise<StockQuote> {
    return this.market.getQuote(symbol.toUpperCase());
  }

  @Post('stocks/:symbol/technical/refresh')
  refreshTechnical(@Param('symbol') symbol: string): Promise<{
    symbol: string;
    candles: number;
    indicators: boolean;
    dataSource: string;
  }> {
    return this.market.refreshTechnical(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/anomaly')
  getAnomaly(@Param('symbol') symbol: string): ManipulationSnapshot | null {
    return this.market.getManipulation(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/candles')
  getCandles(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = Timeframe.ONE_DAY,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ): Promise<Candle[]> {
    if (!Object.values(Timeframe).includes(timeframe)) {
      throw new BadRequestException(`Unsupported timeframe: ${String(timeframe)}`);
    }
    return this.market.getCandles(symbol.toUpperCase(), timeframe, Math.min(limit, 5000));
  }

  @Get('stocks/:symbol/candles/mtf')
  getMultiTimeframeCandles(
    @Param('symbol') symbol: string,
    @Query('limit', new DefaultValuePipe(120), ParseIntPipe) limit = 120,
  ): Promise<MultiTimeframeCandles> {
    return this.market.getMultiTimeframeCandles(symbol.toUpperCase(), Math.min(limit, 5000));
  }

  @Get('stocks/:symbol/depth')
  getDepth(@Param('symbol') symbol: string): MarketDepth {
    return this.market.getDepth(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/compare')
  compare(
    @Param('symbol') symbol: string,
    @Query('benchmark') benchmark = MarketIndex.NIFTY_50,
    @Query('window', new DefaultValuePipe(60), ParseIntPipe) window = 60,
  ): RelativeComparison {
    if (!Object.values(MarketIndex).includes(benchmark)) {
      throw new BadRequestException(`Unsupported benchmark: ${String(benchmark)}`);
    }
    return this.market.compare(symbol.toUpperCase(), benchmark, window);
  }

  @Get('stocks/:symbol/fundamentals')
  getFundamentals(@Param('symbol') symbol: string): Promise<FundamentalView> {
    return this.fundamentals.latestView(symbol.toUpperCase());
  }

  @Get('stocks/:symbol/peer-valuation')
  getPeerValuation(@Param('symbol') symbol: string): Promise<PeerValuationView> {
    return this.fundamentals.peerValuation(symbol.toUpperCase());
  }

  @Post('stocks/:symbol/fundamentals/ingest')
  ingestOne(
    @Param('symbol') symbol: string,
    @Query('full') full?: string,
  ): Promise<{
    symbol: string;
    snapshots: number;
    skipped?: boolean;
    reason?: string;
    cached?: boolean;
  }> {
    return this.fundamentals.ingestOne(symbol.toUpperCase(), { full: parseFullFlag(full) });
  }

  @Post('fundamentals/refresh-sector-medians')
  refreshSectorMedians(): Promise<{ updated: number }> {
    return this.fundamentals.refreshSectorMedians();
  }

  @Get('fundamentals/panel')
  getFundamentalsPanel(): ReturnType<FundamentalsStore['panel']> {
    return this.fundamentals.panel();
  }

  @Get('fundamentals/sector-medians')
  getSectorMedians(): ReturnType<FundamentalsStore['sectorMedians']> {
    return this.fundamentals.sectorMedians();
  }

  @Get('stocks/:symbol/alt-data')
  getAltData(@Param('symbol') symbol: string): Promise<AltDataView> {
    return this.altData.latestView(symbol.toUpperCase());
  }

  @Post('stocks/:symbol/alt-data/news/ingest')
  ingestNews(@Param('symbol') symbol: string, @Query('full') full?: string) {
    return this.altData.ingestNews(symbol.toUpperCase(), { full: parseFullFlag(full) });
  }

  @Post('stocks/:symbol/alt-data/social/ingest')
  ingestSocial(@Param('symbol') symbol: string, @Query('full') full?: string) {
    return this.altData.ingestSocial(symbol.toUpperCase(), { full: parseFullFlag(full) });
  }

  @Post('alt-data/ingest/news')
  ingestNewsUniverse(@Query('universe') universe?: string, @Query('full') full?: string) {
    return this.altData.ingestNewsUniverse(universe, { full: parseFullFlag(full) });
  }

  @Post('alt-data/ingest/social')
  ingestSocialUniverse(@Query('universe') universe?: string, @Query('full') full?: string) {
    return this.altData.ingestSocialUniverse(universe, { full: parseFullFlag(full) });
  }

  @Post('alt-data/ingest/macro')
  ingestMacro(@Query('full') full?: string, @Query('includeIndia') includeIndia?: string) {
    return this.altData.ingestMacro({
      full: parseFullFlag(full),
      includeIndia: parseFullFlag(includeIndia),
    });
  }

  @Post('alt-data/news/upsert')
  upsertNews(
    @Query('symbol') symbol: string,
    @Body()
    body: { headlines?: Parameters<AltDataStore['upsertNews']>[1] },
  ) {
    if (!symbol) throw new BadRequestException('symbol is required');
    return this.altData.upsertNews(symbol.toUpperCase(), body.headlines ?? []);
  }

  @Post('alt-data/social/upsert')
  upsertSocial(
    @Query('symbol') symbol: string,
    @Body() body: { rows?: Parameters<AltDataStore['upsertSocial']>[1] },
  ) {
    if (!symbol) throw new BadRequestException('symbol is required');
    return this.altData.upsertSocial(symbol.toUpperCase(), body.rows ?? []);
  }

  @Get('alt-data/panel/news')
  newsPanel() {
    return this.altData.newsPanel();
  }

  @Get('alt-data/panel/social')
  socialPanel() {
    return this.altData.socialPanel();
  }

  @Get('alt-data/panel/macro')
  macroPanel() {
    return this.altData.macroPanel();
  }

  @Get('indices')
  getIndices(): IndexQuote[] {
    return this.market.getIndices();
  }

  @Get('market/data-contract')
  getDataContract(): {
    ingestMode: string;
    nseCashSessionOpen: boolean;
    quoteStatus: string;
    liveUsable: boolean;
    sampleSymbol: string | null;
    sampleUpdatedAt: number | null;
    note: string;
  } {
    return this.market.getDataContract();
  }

  /** Backend-owned MarketSessionState — FE must not clock-derive OPEN/CLOSED. */
  @Get('market/session-state')
  getMarketSessionState(): ReturnType<MarketService['getMarketSessionStates']> {
    return this.market.getMarketSessionStates();
  }

  /**
   * P5 Focus handoff — prioritize live quote refresh (Tier order from caller).
   * Optimization only; not trade authorization.
   */
  @Post('market/focus-refresh')
  prioritizeFocusRefresh(
    @Body() body: { symbols?: string[] },
  ): Promise<{ requested: number; refreshed: number; missing: string[] }> {
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    return this.market.prioritizeFocusRefresh(symbols);
  }

  /** ML Lab Phase 4 — observational ML → TI usability bridge (not trade auth). */
  @Get('market/ml-ti-bridge')
  getMlTiBridge(): ReturnType<MarketService['getMlTiBridge']> {
    return this.market.getMlTiBridge();
  }

  /**
   * Refresh prediction cache from ML engine / file (observe-only).
   * Batch finalize should call this so usable predictions are present when available.
   */
  @Post('market/predictions/refresh')
  refreshMlPredictions(): ReturnType<MarketService['refreshMlPredictions']> {
    return this.market.refreshMlPredictions();
  }

  @Get('market/context')
  getMarketContext(): ReturnType<MarketService['getMarketContext']> {
    return this.market.getMarketContext();
  }

  /**
   * Usable ML prediction for TI (fresh + drift-compatible). Observe-only.
   * Query: optional horizon=NEXT_DAY|NEXT_WEEK (default: day then week fallback).
   */
  @Get('market/predictions/:symbol')
  getUsableMlPrediction(
    @Param('symbol') symbol: string,
    @Query('horizon') horizon?: string,
  ): ReturnType<MarketService['getUsableMlPrediction']> {
    return this.market.getUsableMlPrediction(symbol, horizon?.trim() || undefined);
  }

  @Get('scanner')
  getScanner(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(40), ParseIntPipe) limit = 40,
    @Query('minScore', new DefaultValuePipe(55), ParseIntPipe) minScore = 55,
    @Query('sort') sort = 'score',
    @Query('minInvestigate', new DefaultValuePipe(0), ParseIntPipe) minInvestigate = 0,
  ): ReturnType<MarketService['getScanner']> {
    return this.market.getScanner(page, Math.min(limit, 100), minScore, sort, minInvestigate);
  }

  @Get('indices/:index/candles')
  getIndexCandles(
    @Param('index') index: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ): Promise<Candle[]> {
    return this.market.getCandles(index.toUpperCase(), Timeframe.ONE_DAY, Math.min(limit, 5000));
  }

  // ---------------------------------------------------------- B9–B17 advisory

  @Get('intelligence/sectors')
  listIntelligenceSectors() {
    return this.b9b17.listSectors();
  }

  @Get('intelligence/sectors/all')
  allSectorsIntelligence(@Query('limit', new DefaultValuePipe(40), ParseIntPipe) limit = 40) {
    return this.b9b17.allSectorsIntelligence(limit);
  }

  @Get('intelligence/sectors/:sector')
  sectorIntelligence(@Param('sector') sector: string) {
    return this.b9b17.sectorIntelligence(decodeURIComponent(sector));
  }

  @Get('intelligence/sectors/:sector/members')
  sectorMembers(@Param('sector') sector: string) {
    return this.b9b17.sectorMembers(decodeURIComponent(sector));
  }

  @Get('intelligence/bull-run/:symbol')
  bullRunIntelligence(@Param('symbol') symbol: string) {
    return this.b9b17.bullRun(symbol);
  }

  @Get('intelligence/relationships')
  relationshipIntelligence(
    @Query('left') left?: string,
    @Query('right') right?: string,
    @Query('kind') kind?: string,
    @Query('windowDays', new DefaultValuePipe(60), ParseIntPipe) windowDays = 60,
  ) {
    if (!left?.trim() || !right?.trim()) {
      throw new BadRequestException('left and right query params are required');
    }
    const pairKind = (kind?.trim() || 'STOCK_STOCK') as RelationshipPairKind;
    return this.b9b17.relationship(left, right, pairKind, windowDays);
  }

  @Get('intelligence/inverse/:symbol')
  inverseIntelligence(
    @Param('symbol') symbol: string,
    @Query('peers') peers?: string,
    @Query('downsideThreshold') downsideThreshold?: string,
  ) {
    const peerList = peers
      ? peers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const thr =
      downsideThreshold != null && downsideThreshold !== '' ? Number(downsideThreshold) : -0.05;
    return this.b9b17.inverseBeneficiaries(symbol, peerList, Number.isFinite(thr) ? thr : -0.05);
  }

  @Get('intelligence/historical/:symbol')
  historicalIntelligence(
    @Param('symbol') symbol: string,
    @Query('dayReturnThreshold') dayReturnThreshold?: string,
  ) {
    const thr =
      dayReturnThreshold != null && dayReturnThreshold !== '' ? Number(dayReturnThreshold) : -0.05;
    return this.b9b17.historicalEvents(symbol, Number.isFinite(thr) ? thr : -0.05);
  }

  /** Historical analogues / forward distribution (A-wave) — not B13 shock events. */
  @Get('intelligence/historical-analogues/:symbol')
  historicalAnalogues(@Param('symbol') symbol: string) {
    return this.b9b17.historicalAnalogues(symbol);
  }

  @Get('intelligence/cross-asset/:symbol')
  crossAssetIntelligence(@Param('symbol') symbol: string, @Query('asset') asset?: string) {
    return this.b9b17.crossAssetWithIndex(symbol, asset ?? 'NIFTY');
  }

  @Get('intelligence/fno/:symbol')
  fnoIntelligence(@Param('symbol') symbol: string) {
    return this.b9b17.fno(symbol);
  }

  @Post('intelligence/global-events')
  globalEventIntelligence(
    @Body()
    body: {
      eventType?: string;
      headline?: string;
      country?: string;
      eventTime?: string;
      source?: string;
      importance?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
      actual?: string | number | null;
      consensus?: string | number | null;
      previous?: string | number | null;
      surpriseDirection?: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
      eventId?: string;
    },
  ) {
    return this.b9b17.globalEvent(body ?? {});
  }
}
