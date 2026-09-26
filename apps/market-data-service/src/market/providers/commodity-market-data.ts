/**
 * Commodity product market data: Alpha Vantage (on-demand) + EIA energy history.
 * 25 AV req/day — never HF-poll. Not MCX/CME contracts. Do not scrape.
 */

export interface CommodityQuotePrint {
  providerAssetId: string;
  price: number;
  listedAt: number;
  provider: 'alpha-vantage' | 'eia';
  providerSelectionReason: string;
  dataStatus: 'DELAYED' | 'HISTORICAL';
}

export interface CommodityHistoryRow {
  time: number;
  value: number;
}

export function normalizeAlphaVantageCommoditySeries(
  payload: { data?: Array<{ date?: string; value?: string }>; Note?: string; Information?: string },
  providerAssetId: string,
): { print: CommodityQuotePrint | null; history: CommodityHistoryRow[] } {
  if (payload?.Note || payload?.Information) {
    return { print: null, history: [] };
  }
  const history: CommodityHistoryRow[] = [];
  for (const row of payload?.data ?? []) {
    const time = Date.parse(String(row.date ?? ''));
    const value = Number(row.value);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue;
    history.push({ time, value });
  }
  history.sort((a, b) => a.time - b.time);
  const last = history[history.length - 1];
  return {
    history,
    print: last
      ? {
          providerAssetId,
          price: last.value,
          listedAt: last.time,
          provider: 'alpha-vantage',
          providerSelectionReason: 'COMMODITY_ALL Alpha Vantage catalog series (on-demand, not HF)',
          dataStatus: 'HISTORICAL',
        }
      : null,
  };
}

export function normalizeEiaSeries(
  payload: { response?: { data?: Array<{ period?: string; value?: number | string }> } },
  providerAssetId: string,
): { print: CommodityQuotePrint | null; history: CommodityHistoryRow[] } {
  const history: CommodityHistoryRow[] = [];
  for (const row of payload?.response?.data ?? []) {
    const time = Date.parse(String(row.period ?? ''));
    const value = Number(row.value);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue;
    history.push({ time, value });
  }
  history.sort((a, b) => a.time - b.time);
  const last = history[history.length - 1];
  return {
    history,
    print: last
      ? {
          providerAssetId,
          price: last.value,
          listedAt: last.time,
          provider: 'eia',
          providerSelectionReason: 'EIA energy historical series (not live)',
          dataStatus: 'HISTORICAL',
        }
      : null,
  };
}

export const COMMODITY_SCRAPE_FORBIDDEN = true;
