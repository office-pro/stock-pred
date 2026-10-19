/**
 * MI-2 data-only coverage report (no PASS/BLOCK).
 */

import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import type {
  MarketIntelligenceUniverseType,
  MiCoverageReport,
  MiIdentityResolutionStatus,
} from '@stockpred/shared-types';
import {
  buildMiCoverageReport,
  resolveMarketIntelligenceUniverse,
  resolveMiInstrumentIdentity,
  type MiCoverageInventoryRow,
} from '@stockpred/shared-utils';

@Injectable()
export class MiCoverageService {
  async report(input: {
    universeType: MarketIntelligenceUniverseType;
    customSymbols?: string[];
    nseEquityAllSymbols?: string[];
    asOf?: string;
  }): Promise<MiCoverageReport> {
    const asOf = input.asOf ?? new Date().toISOString();
    const { instruments, universeVersion } = resolveMarketIntelligenceUniverse({
      universeType: input.universeType,
      customSymbols: input.customSymbols,
      nseEquityAllSymbols: input.nseEquityAllSymbols,
    });

    const rows: MiCoverageInventoryRow[] = [];
    for (const inst of instruments) {
      const id = resolveMiInstrumentIdentity({
        symbol: inst.symbol,
        venue: inst.venue,
        assetClass: inst.assetClass,
      });
      rows.push({
        instrument: id.instrument ?? inst,
        identityStatus: id.status as MiIdentityResolutionStatus,
        fundamentals: 'unavailable',
        hasCorporate: false,
        hasNews: false,
        sentiment: 'na',
      });
    }

    const resolvedSymbols = rows
      .filter((r) => r.identityStatus === 'RESOLVED')
      .map((r) => r.instrument.symbol.toUpperCase());

    let macroAvailable = false;
    try {
      const prisma = getPrismaClient();
      const fundFacts = await prisma.marketIntelligenceFact.findMany({
        where: {
          symbol: { in: resolvedSymbols },
          metric: { in: ['revenue', 'pat', 'roe'] },
        },
        select: { symbol: true, metric: true },
      });
      const bySym = new Map<string, Set<string>>();
      for (const f of fundFacts) {
        const set = bySym.get(f.symbol) ?? new Set();
        set.add(f.metric);
        bySym.set(f.symbol, set);
      }
      const corp = await prisma.marketIntelligenceEvent.findMany({
        where: { symbol: { in: resolvedSymbols }, NOT: { category: 'NEWS' } },
        select: { symbol: true },
        distinct: ['symbol'],
      });
      const news = await prisma.marketIntelligenceEvent.findMany({
        where: { symbol: { in: resolvedSymbols }, category: 'NEWS' },
        select: { symbol: true, sentimentScore: true },
      });
      const corpSet = new Set(corp.map((c) => c.symbol));
      const newsBy = new Map<string, { scored: boolean }>();
      for (const n of news) {
        const prev = newsBy.get(n.symbol) ?? { scored: false };
        if (n.sentimentScore != null) prev.scored = true;
        newsBy.set(n.symbol, prev);
      }
      const macro = await prisma.marketIntelligenceDocument.findFirst({
        where: { symbol: '__BATCH_MACRO__' },
        orderBy: { availableAt: 'desc' },
      });
      macroAvailable = Boolean(macro);

      for (const row of rows) {
        if (row.identityStatus !== 'RESOLVED') continue;
        const sym = row.instrument.symbol.toUpperCase();
        const metrics = bySym.get(sym);
        if (metrics && metrics.size >= 2) row.fundamentals = 'available';
        else if (metrics && metrics.size === 1) row.fundamentals = 'partial';
        row.hasCorporate = corpSet.has(sym);
        const n = newsBy.get(sym);
        row.hasNews = Boolean(n);
        if (n) row.sentiment = n.scored ? 'scored' : 'unavailable';
      }
    } catch {
      /* empty MI tables → all unavailable */
    }

    return buildMiCoverageReport({
      universeType: input.universeType,
      universeVersion,
      asOf,
      requested: instruments.length,
      rows,
      macroAvailable,
    });
  }
}
