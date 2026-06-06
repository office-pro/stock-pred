import {
  BacktestMetrics,
  BacktestRequest,
  BacktestResult,
  BacktestTrade,
  Candle,
  EquityPoint,
  SignalType,
} from '@stockpred/shared-types';
import {
  cagr,
  evaluateSignal,
  maxDrawdown,
  periodicReturns,
  positionSize,
  profitFactor,
  round2,
  sharpeRatio,
  sortinoRatio,
  winRate,
} from '@stockpred/shared-utils';

/** Bars needed before the first evaluation (EMA200 + headroom). */
const WARMUP_BARS = 210;
/** Rolling evaluation window: bounds CPU and mirrors live-engine behaviour. */
const EVALUATION_WINDOW = 400;

interface OpenPosition {
  entryTime: number;
  entryPrice: number;
  quantity: number;
  target: number;
  stopLoss: number;
}

function closeTrade(
  symbol: string,
  position: OpenPosition,
  exitTime: number,
  exitPrice: number,
  exitReason: string,
): BacktestTrade {
  return {
    symbol,
    side: 'BUY',
    entryTime: position.entryTime,
    entryPrice: round2(position.entryPrice),
    exitTime,
    exitPrice: round2(exitPrice),
    quantity: position.quantity,
    pnl: round2((exitPrice - position.entryPrice) * position.quantity),
    exitReason,
  };
}

/**
 * Long-only daily backtest replaying history through the exact same rule
 * core the live signal-engine uses (single source of truth for rules).
 *
 * Execution model:
 * - signals computed on bar close, orders fill at the NEXT bar open
 * - stop-loss takes priority over target when both are touched intrabar
 * - fixed-percent capital risk per trade, no leverage, long-only
 */
export function runBacktest(candles: Candle[], request: Required<BacktestRequest>): BacktestResult {
  const startedAt = Date.now();
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cash = request.initialCapital;
  let position: OpenPosition | null = null;
  let pendingEntry: { target: number; stopLoss: number } | null = null;

  for (let i = WARMUP_BARS; i < candles.length; i += 1) {
    const bar = candles[i];

    // 1. Fill a pending entry at this bar's open.
    if (pendingEntry && !position) {
      const entryPrice = bar.open;
      if (entryPrice > pendingEntry.stopLoss) {
        const quantity = positionSize(
          cash,
          request.riskPerTradePercent,
          entryPrice,
          pendingEntry.stopLoss,
        );
        if (quantity > 0) {
          cash -= quantity * entryPrice;
          position = {
            entryTime: bar.time,
            entryPrice,
            quantity,
            target: pendingEntry.target,
            stopLoss: pendingEntry.stopLoss,
          };
        }
      }
      pendingEntry = null;
    }

    // 2. Manage the open position intrabar (stop first, then target).
    if (position) {
      let exitPrice: number | null = null;
      let exitReason = '';
      if (bar.low <= position.stopLoss) {
        exitPrice = position.stopLoss;
        exitReason = 'STOP_LOSS_HIT';
      } else if (bar.high >= position.target) {
        exitPrice = position.target;
        exitReason = 'TARGET_HIT';
      }
      if (exitPrice !== null) {
        cash += position.quantity * exitPrice;
        trades.push(closeTrade(bar.symbol, position, bar.time, exitPrice, exitReason));
        position = null;
      }
    }

    // 3. Evaluate the shared rule core on bar close.
    const window = candles.slice(Math.max(0, i + 1 - EVALUATION_WINDOW), i + 1);
    const evaluation = evaluateSignal(window);

    if (!position && !pendingEntry && evaluation.type === SignalType.BUY) {
      if (evaluation.target !== null && evaluation.stopLoss !== null) {
        pendingEntry = { target: evaluation.target, stopLoss: evaluation.stopLoss };
      }
    } else if (position && evaluation.type === SignalType.SELL) {
      cash += position.quantity * bar.close;
      trades.push(closeTrade(bar.symbol, position, bar.time, bar.close, 'REVERSAL_SIGNAL'));
      position = null;
    }

    // 4. Mark equity.
    const marketValue = position ? position.quantity * bar.close : 0;
    equityCurve.push({ time: bar.time, equity: round2(cash + marketValue) });
  }

  // Liquidate any open position at the final close.
  if (position && candles.length > 0) {
    const lastBar = candles[candles.length - 1];
    cash += position.quantity * lastBar.close;
    trades.push(
      closeTrade(lastBar.symbol, position, lastBar.time, lastBar.close, 'END_OF_BACKTEST'),
    );
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = { time: lastBar.time, equity: round2(cash) };
    }
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : cash;
  const pnls = trades.map((t) => t.pnl);
  const returns = periodicReturns(equityCurve.map((p) => p.equity));
  const metrics: BacktestMetrics = {
    totalTrades: trades.length,
    winRate: round2(winRate(pnls)),
    sharpeRatio: round2(sharpeRatio(returns)),
    sortinoRatio: round2(sortinoRatio(returns)),
    cagr: round2(cagr(request.initialCapital, finalEquity, request.years)),
    maxDrawdown: round2(maxDrawdown(equityCurve.map((p) => p.equity))),
    profitFactor: round2(profitFactor(pnls)),
    totalReturnPercent: round2(
      ((finalEquity - request.initialCapital) / request.initialCapital) * 100,
    ),
  };

  return { request, metrics, trades, equityCurve, startedAt, finishedAt: Date.now() };
}
