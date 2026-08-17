import axios from 'axios';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  BacktestRequest,
  BacktestResult,
  Candle,
  ScannerBacktestSummary,
  Timeframe,
} from '@stockpred/shared-types';
import { getEnv, getEnvNumber, runScannerBacktest } from '@stockpred/shared-utils';
import { runBacktest } from './engine';

const TRADING_DAYS_PER_YEAR = 252;
const WARMUP_BARS = 210;

@Injectable()
export class BacktestService {
  private readonly prisma = getPrismaClient();
  private readonly marketDataUrl = getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002');

  async run(request: BacktestRequest): Promise<BacktestResult> {
    const fullRequest: Required<BacktestRequest> = {
      symbol: request.symbol.toUpperCase(),
      years: request.years,
      initialCapital: request.initialCapital ?? getEnvNumber('PAPER_TRADING_CAPITAL', 1_000_000),
      riskPerTradePercent: request.riskPerTradePercent ?? getEnvNumber('RISK_PER_TRADE_PCT', 1),
    };
    const bars = fullRequest.years * TRADING_DAYS_PER_YEAR + WARMUP_BARS;
    const candles = await this.loadCandles(fullRequest.symbol, bars);
    const result = runBacktest(candles, fullRequest);
    await this.persist(result);
    return result;
  }

  async getHistory(limit: number): Promise<unknown[]> {
    try {
      return await this.prisma.backtestRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          symbol: true,
          years: true,
          initialCapital: true,
          riskPerTradePercent: true,
          metrics: true,
          createdAt: true,
        },
      });
    } catch (error) {
      console.warn(`[backtest] history read failed: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Real candles only. The market-data-service serves live provider data or
   * its database cache of real candles (offline mode). If neither is
   * reachable the backtest FAILS rather than silently running on synthetic
   * data - the CLI (`npm run backtest`) is the explicit simulated-data path.
   */
  private async loadCandles(symbol: string, bars: number): Promise<Candle[]> {
    let data: Candle[];
    try {
      const response = await axios.get<Candle[]>(`${this.marketDataUrl}/stocks/${symbol}/candles`, {
        params: { timeframe: Timeframe.ONE_DAY, limit: bars },
        timeout: 15_000,
      });
      data = response.data;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Historical data unavailable for ${symbol}: market-data-service is unreachable (${(error as Error).message})`,
      );
    }
    if (data.length < WARMUP_BARS + 50) {
      throw new ServiceUnavailableException(
        `Insufficient real history for ${symbol}: ${data.length} candles (need ${WARMUP_BARS + 50}+)`,
      );
    }
    return data;
  }

  async runScanner(symbol: string, minBullScore: number): Promise<ScannerBacktestSummary> {
    const candles = await this.loadCandles(
      symbol.toUpperCase(),
      10 * TRADING_DAYS_PER_YEAR + WARMUP_BARS,
    );
    const nifty = await this.loadCandles(
      'NIFTY_50',
      10 * TRADING_DAYS_PER_YEAR + WARMUP_BARS,
    ).catch(() => candles);
    const result = runScannerBacktest(candles, nifty, minBullScore);
    return {
      symbol: symbol.toUpperCase(),
      minBullScore,
      signals: result.signals,
      winRate: result.winRate,
      averageReturn: result.averageReturn,
      medianReturn: result.medianReturn,
      maxReturn: result.maxReturn,
      maxLoss: result.maxLoss,
      profitFactor: result.profitFactor,
      calibrationError: result.calibrationError,
      byRegime: result.byRegime,
    };
  }

  private async persist(result: BacktestResult): Promise<void> {
    try {
      await this.prisma.backtestRun.create({
        data: {
          symbol: result.request.symbol,
          years: result.request.years,
          initialCapital: result.request.initialCapital,
          riskPerTradePercent: result.request.riskPerTradePercent,
          metrics: JSON.parse(JSON.stringify(result.metrics)),
          trades: JSON.parse(JSON.stringify(result.trades)),
          equityCurve: JSON.parse(JSON.stringify(result.equityCurve.filter((_, i) => i % 5 === 0))),
        },
      });
    } catch (error) {
      console.warn(`[backtest] persist failed: ${(error as Error).message}`);
    }
  }
}
