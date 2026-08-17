import type { PaperHolding } from '@stockpred/shared-types';

export function livePrice(quotePrice: number | undefined, tickPrice: number | undefined): number {
  if (tickPrice != null && tickPrice > 0) return tickPrice;
  if (quotePrice != null && quotePrice > 0) return quotePrice;
  return 0;
}

/** Prefer the fresher of REST quote vs websocket tick (stale ticks must not win). */
export function pickLiveQuote(options: {
  quotePrice?: number;
  quoteTime?: number | null;
  tickPrice?: number;
  tickTime?: number | null;
}): { price: number; listedAt: number | null } {
  const quoteTime = options.quoteTime ?? 0;
  const tickTime = options.tickTime ?? 0;
  const quotePrice = options.quotePrice ?? 0;
  const tickPrice = options.tickPrice ?? 0;
  if (tickTime > quoteTime && tickPrice > 0) {
    return { price: tickPrice, listedAt: tickTime };
  }
  if (quotePrice > 0) {
    return { price: quotePrice, listedAt: quoteTime > 0 ? quoteTime : null };
  }
  if (tickPrice > 0) {
    return { price: tickPrice, listedAt: tickTime > 0 ? tickTime : null };
  }
  return { price: 0, listedAt: null };
}

export function paperPnl(options: { live: number; boughtAt: number; quantity: number }): {
  amount: number;
  percent: number;
} {
  const { live, boughtAt, quantity } = options;
  const amount = boughtAt > 0 && live > 0 ? (live - boughtAt) * quantity : 0;
  const percent = boughtAt > 0 && live > 0 ? ((live - boughtAt) / boughtAt) * 100 : 0;
  return { amount, percent };
}

export function holdingForSymbol(
  holdings: PaperHolding[] | undefined,
  symbol: string,
): PaperHolding | undefined {
  const upper = symbol.toUpperCase();
  return holdings?.find((lot) => lot.symbol.toUpperCase() === upper);
}

/** Day change vs previous close for the live last. */
export function dayChangePercent(live: number, previousClose?: number | null): number | null {
  if (previousClose == null || previousClose <= 0 || live <= 0) return null;
  return ((live - previousClose) / previousClose) * 100;
}

/** Exchange listing clock (IST), never the viewer's machine "now". */
export function formatListedTime(epochMs: number | null | undefined): string | null {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  return `${new Date(epochMs).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })} IST`;
}

/** How far the listed print lags the viewer's clock — for delay checks. */
export function formatQuoteDelay(
  listedAt: number | null | undefined,
  now = Date.now(),
): string | null {
  if (listedAt == null || !Number.isFinite(listedAt) || listedAt <= 0) return null;
  const ms = Math.max(0, now - listedAt);
  if (ms < 1000) return '0s delay';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s delay`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m delay`;
  return `${Math.round(ms / 3_600_000)}h delay`;
}
