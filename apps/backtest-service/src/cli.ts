import { BacktestYears } from '@stockpred/shared-types';
import { runBacktest } from './engine';
import { generateCandles } from './sim';

/**
 * Offline backtest CLI:
 *   node dist/cli.js --symbol RELIANCE --years 3 [--capital 1000000] [--risk 1]
 */
function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function main(): void {
  const symbol = arg('symbol', 'RELIANCE').toUpperCase();
  const years = Number(arg('years', '3'));
  if (![1, 3, 5, 10].includes(years)) {
    console.error('years must be one of: 1, 3, 5, 10');
    process.exitCode = 1;
    return;
  }
  const initialCapital = Number(arg('capital', '1000000'));
  const riskPerTradePercent = Number(arg('risk', '1'));

  const bars = years * 252 + 210;
  console.log(`Backtesting ${symbol} over ${years}y (${bars} bars, simulated data)...`);
  const candles = generateCandles(symbol, bars, 1000);
  const result = runBacktest(candles, {
    symbol,
    years: years as BacktestYears,
    initialCapital,
    riskPerTradePercent,
  });

  console.log('\n=== Backtest result ===');
  console.table(result.metrics);
  console.log(`Trades: ${result.trades.length}`);
  for (const trade of result.trades.slice(-10)) {
    console.log(
      `  ${new Date(trade.entryTime).toISOString().slice(0, 10)} -> ${new Date(trade.exitTime)
        .toISOString()
        .slice(0, 10)} qty ${trade.quantity} pnl ${trade.pnl} (${trade.exitReason})`,
    );
  }
  console.log('\nThis is not investment advice. Past performance does not guarantee profits.');
}

main();
