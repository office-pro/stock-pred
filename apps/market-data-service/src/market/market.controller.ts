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
  RelativeComparison,
  StockQuote,
  Timeframe,
} from '@stockpred/shared-types';
import { MarketService } from './market.service';
import { FundamentalsStore } from './fundamentals-store';
import { AltDataStore } from './alt-data-store';
import { parseFullFlag } from './alt-data/ingest-freshness';

@Controller()
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly fundamentals: FundamentalsStore,
    private readonly altData: AltDataStore,
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
  ingestMacro(@Query('full') full?: string) {
    return this.altData.ingestMacro({ full: parseFullFlag(full) });
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

  @Get('market/context')
  getMarketContext(): ReturnType<MarketService['getMarketContext']> {
    return this.market.getMarketContext();
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
}
