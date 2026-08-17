import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  Candle,
  IndexQuote,
  ManipulationSnapshot,
  MarketDepth,
  MarketIndex,
  RelativeComparison,
  StockQuote,
  Timeframe,
} from '@stockpred/shared-types';
import { MarketService } from './market.service';

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}

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
