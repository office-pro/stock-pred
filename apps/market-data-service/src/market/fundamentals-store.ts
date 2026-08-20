import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import type { FundamentalView } from '@stockpred/shared-types';
import { ingestSymbol, refreshSectorMedians } from './fundamentals-write';

export interface FundamentalPanelRow {
  symbol: string;
  as_of_date: string;
  available_at: string;
  sector: string | null;
  rev_yoy: number | null;
  pat_yoy: number | null;
  eps_yoy: number | null;
  op_margin: number | null;
  net_margin: number | null;
  gross_margin: number | null;
  ebitda_margin: number | null;
  roe: number | null;
  roa: number | null;
  roce: number | null;
  debt_equity: number | null;
  current_ratio: number | null;
  cash_ratio: number | null;
  ocf_pat: number | null;
  fcf_growth: number | null;
  fcf_margin: number | null;
  trailing_eps: number | null;
  book_value: number | null;
  sector_median_pe: number | null;
  promoter_holding: number | null;
  institution_holding: number | null;
  log_ttm_revenue: number | null;
}

@Injectable()
export class FundamentalsStore {
  private readonly prisma = getPrismaClient();

  async latestView(symbol: string): Promise<FundamentalView> {
    const row = await this.prisma.fundamentalSnapshot.findFirst({
      where: { symbol, availableAt: { lte: new Date() } },
      orderBy: { availableAt: 'desc' },
    });
    if (!row) {
      return {
        symbol,
        asOfDate: 0,
        availableAt: 0,
        sector: null,
        pe: null,
        pb: null,
        roe: null,
        debtEquity: null,
        revYoy: null,
        patYoy: null,
        netMargin: null,
        currentRatio: null,
        displayScore: null,
        missing: true,
      };
    }
    return {
      symbol: row.symbol,
      asOfDate: row.asOfDate.getTime(),
      availableAt: row.availableAt.getTime(),
      sector: row.sector,
      pe: row.trailingPe,
      pb: row.priceToBook,
      roe: row.roe,
      debtEquity: row.debtEquity,
      revYoy: row.revYoy,
      patYoy: row.patYoy,
      netMargin: row.netMargin,
      currentRatio: row.currentRatio,
      displayScore: row.displayScore,
      missing: false,
    };
  }

  async panel(): Promise<FundamentalPanelRow[]> {
    const rows = await this.prisma.fundamentalSnapshot.findMany({
      orderBy: [{ symbol: 'asc' }, { availableAt: 'asc' }],
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      as_of_date: row.asOfDate.toISOString(),
      available_at: row.availableAt.toISOString(),
      sector: row.sector,
      rev_yoy: row.revYoy,
      pat_yoy: row.patYoy,
      eps_yoy: row.epsYoy,
      op_margin: row.opMargin,
      net_margin: row.netMargin,
      gross_margin: row.grossMargin,
      ebitda_margin: row.ebitdaMargin,
      roe: row.roe,
      roa: row.roa,
      roce: row.roce,
      debt_equity: row.debtEquity,
      current_ratio: row.currentRatio,
      cash_ratio: row.cashRatio,
      ocf_pat: row.ocfPat,
      fcf_growth: row.fcfGrowth,
      fcf_margin: row.fcfMargin,
      trailing_eps: row.trailingEps,
      book_value: row.bookValue,
      sector_median_pe: row.sectorMedianPe,
      promoter_holding: row.promoterHolding,
      institution_holding: row.institutionHolding,
      log_ttm_revenue: row.revenue != null && row.revenue > 0 ? Math.log(row.revenue) : null,
    }));
  }

  async ingestOne(
    symbol: string,
    options?: { full?: boolean },
  ): Promise<{
    symbol: string;
    snapshots: number;
    skipped?: boolean;
    reason?: string;
    cached?: boolean;
  }> {
    const row = await this.prisma.stock.findUnique({ where: { symbol } });
    try {
      return await ingestSymbol(
        symbol,
        {
          exchange: row?.exchange,
          bseCode: row?.bseCode,
          yahooSymbol: row?.yahooSymbol,
        },
        options,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { symbol, snapshots: 0, skipped: true, reason };
    }
  }

  async refreshSectorMedians(): Promise<{ updated: number }> {
    const updated = await refreshSectorMedians();
    return { updated };
  }
}
