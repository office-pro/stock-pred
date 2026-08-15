import type { Candle, PatternAnalog, PatternOccurrenceView } from '@stockpred/shared-types';
import { detectPatterns } from './detectors';

const SCAN_COOLDOWN_BARS = 15;
const MIN_ANALOG_SAMPLES = 8;

export interface ScannedOccurrence {
  symbol: string;
  pattern: string;
  direction: 'bullish' | 'bearish';
  confidence: number;
  price: number;
  confirmedAt: number;
  barIndex: number;
  return5: number | null;
  return10: number | null;
  return20: number | null;
  maxFavorable: number | null;
  maxAdverse: number | null;
}

function pctReturn(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sliding-window named-pattern scan over a daily series. */
export function scanHistory(symbol: string, candles: Candle[]): ScannedOccurrence[] {
  if (candles.length < 40) return [];
  const lastByPattern = new Map<string, number>();
  const hits: ScannedOccurrence[] = [];

  const step = candles.length > 900 ? 3 : 1;
  for (let end = 40; end <= candles.length; end += step) {
    const window = candles.slice(0, end);
    const detected = detectPatterns(window);
    for (const result of detected) {
      const last = lastByPattern.get(result.pattern) ?? -999;
      if (end - last < SCAN_COOLDOWN_BARS) continue;
      lastByPattern.set(result.pattern, end);
      const confirm = window[window.length - 1];
      const idx = end - 1;
      const future = candles.slice(idx);
      const close0 = confirm.close;
      const at = (bars: number): number | null =>
        future.length > bars ? pctReturn(close0, future[bars].close) : null;
      let maxFav = 0;
      let maxAdv = 0;
      const look = Math.min(20, future.length - 1);
      for (let i = 1; i <= look; i += 1) {
        const move = pctReturn(close0, future[i].close);
        if (result.direction === 'bullish') {
          maxFav = Math.max(maxFav, move);
          maxAdv = Math.min(maxAdv, move);
        } else {
          maxFav = Math.max(maxFav, -move);
          maxAdv = Math.min(maxAdv, -move);
        }
      }
      hits.push({
        symbol,
        pattern: result.pattern,
        direction: result.direction,
        confidence: result.confidence,
        price: confirm.close,
        confirmedAt: confirm.time,
        barIndex: idx,
        return5: at(5),
        return10: at(10),
        return20: at(20),
        maxFavorable: look > 0 ? maxFav : null,
        maxAdverse: look > 0 ? maxAdv : null,
      });
    }
  }
  return hits;
}

export function toOccurrenceView(row: ScannedOccurrence): PatternOccurrenceView {
  return {
    symbol: row.symbol,
    pattern: row.pattern,
    timeframe: '1d',
    direction: row.direction,
    confidence: row.confidence,
    price: row.price,
    confirmedAt: row.confirmedAt,
    return5: row.return5,
    return10: row.return10,
    return20: row.return20,
    maxFavorable: row.maxFavorable,
    maxAdverse: row.maxAdverse,
  };
}

export function buildAnalog(
  symbol: string,
  pattern: string,
  occurrences: PatternOccurrenceView[],
): PatternAnalog {
  const sample = occurrences.filter((row) => row.pattern === pattern);
  const r5 = sample.map((r) => r.return5).filter((v): v is number => v !== null);
  const r10 = sample.map((r) => r.return10).filter((v): v is number => v !== null);
  const r20 = sample.map((r) => r.return20).filter((v): v is number => v !== null);
  const wins = r10.filter((v) => v > 0).length;
  const analog: PatternAnalog = {
    pattern,
    symbol,
    sampleSize: sample.length,
    medianReturn5: median(r5),
    medianReturn10: median(r10),
    medianReturn20: median(r20),
    winRate10: r10.length > 0 ? (wins / r10.length) * 100 : null,
    suggestion: '',
    occurrences: sample.slice(0, 25),
  };
  analog.suggestion = suggestionText(analog);
  return analog;
}

function suggestionText(analog: PatternAnalog): string {
  if (analog.sampleSize < MIN_ANALOG_SAMPLES) {
    return `Not enough historical repeats of ${analog.pattern.replaceAll('_', ' ')} on ${analog.symbol} (${analog.sampleSize} found, need ${MIN_ANALOG_SAMPLES}) to suggest a path.`;
  }
  const med = analog.medianReturn10;
  const win = analog.winRate10;
  const pretty = analog.pattern.replaceAll('_', ' ');
  if (med === null || win === null) {
    return `${pretty}: ${analog.sampleSize} historical hits, but forward returns are not yet filled. Re-run scan:patterns after more bhavcopy days.`;
  }
  const bias =
    med >= 0 ? 'continued in the pattern direction' : 'failed more often than it followed through';
  return (
    `${pretty} confirmed. On ${analog.symbol}, ${analog.sampleSize} similar setups: ` +
    `median 10-session move ${med >= 0 ? '+' : ''}${med.toFixed(1)}%, ` +
    `${win.toFixed(0)}% closed green after 10 sessions (${bias}). ` +
    `Playbook: wait for a confirming close with volume above the 20-session average; ` +
    `invalidation is a close back through the breakout level. This is not investment advice.`
  );
}
