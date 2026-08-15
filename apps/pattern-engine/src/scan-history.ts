/**
 * Scan cached daily candles for named patterns and store analog outcomes.
 *
 *   node apps/pattern-engine/dist/scan-history.js
 *   node apps/pattern-engine/dist/scan-history.js --symbol RELIANCE
 */
import { getPrismaClient, disconnectPrisma } from '@stockpred/database';
import { Timeframe } from '@stockpred/shared-types';
import { scanHistory } from './patterns/history-scan';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const only = argValue('--symbol')?.toUpperCase();
  const stocks = await prisma.stock.findMany({
    where: only ? { symbol: only } : { listed: true },
    select: { symbol: true },
    orderBy: { symbol: 'asc' },
  });

  let stored = 0;
  let scanned = 0;
  for (const { symbol } of stocks) {
    const rows = await prisma.candleRow.findMany({
      where: { symbol, timeframe: Timeframe.ONE_DAY },
      orderBy: { time: 'asc' },
    });
    if (rows.length < 40) continue;
    const candles = rows.map((row) => ({
      symbol: row.symbol,
      timeframe: Timeframe.ONE_DAY,
      time: Number(row.time),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
    const hits = scanHistory(symbol, candles);
    scanned += 1;
    for (const hit of hits) {
      await prisma.patternOccurrence.upsert({
        where: {
          symbol_pattern_timeframe_confirmedAt: {
            symbol: hit.symbol,
            pattern: hit.pattern,
            timeframe: '1d',
            confirmedAt: BigInt(hit.confirmedAt),
          },
        },
        update: {
          confidence: hit.confidence,
          price: hit.price,
          direction: hit.direction,
          return5: hit.return5,
          return10: hit.return10,
          return20: hit.return20,
          maxFavorable: hit.maxFavorable,
          maxAdverse: hit.maxAdverse,
        },
        create: {
          symbol: hit.symbol,
          pattern: hit.pattern,
          timeframe: '1d',
          direction: hit.direction,
          confidence: hit.confidence,
          price: hit.price,
          confirmedAt: BigInt(hit.confirmedAt),
          return5: hit.return5,
          return10: hit.return10,
          return20: hit.return20,
          maxFavorable: hit.maxFavorable,
          maxAdverse: hit.maxAdverse,
        },
      });
      stored += 1;
    }
    if (scanned % 25 === 0) {
      console.log(`[scan-patterns] ${scanned}/${stocks.length} symbols, ${stored} occurrences`);
    }
  }
  console.log(`[scan-patterns] done: ${scanned} symbols, ${stored} pattern occurrences upserted`);
}

main()
  .catch((error) => {
    console.error('[scan-patterns] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
