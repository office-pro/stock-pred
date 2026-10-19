/**
 * Corporate events panel — file + additive MI persist.
 */

import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  nseCorporateClient,
  shareholdingFromFundamentals,
  type NseCorporatePanelRow,
} from './providers/nse-corporate';
import { persistMiCorporateRows } from './mi-persist';

const PANEL_PATH = path.join(process.cwd(), 'data', 'corporate-panel.json');

async function readPanelFile(): Promise<NseCorporatePanelRow[]> {
  try {
    const raw = await fs.readFile(PANEL_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as NseCorporatePanelRow[]) : [];
  } catch {
    return [];
  }
}

async function writePanelFile(rows: NseCorporatePanelRow[]): Promise<void> {
  await fs.mkdir(path.dirname(PANEL_PATH), { recursive: true });
  await fs.writeFile(PANEL_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

@Injectable()
export class CorporateStore {
  private readonly prisma = getPrismaClient();

  async panel(): Promise<NseCorporatePanelRow[]> {
    try {
      const events = await this.prisma.marketIntelligenceEvent.findMany({
        where: { NOT: { category: 'NEWS' } },
        orderBy: { availableAt: 'desc' },
        take: 50_000,
      });
      if (events.length > 0) {
        return events.map((row) => ({
          symbol: row.symbol,
          kind: (row.category === 'SHAREHOLDING'
            ? 'SHAREHOLDING'
            : row.category === 'CORPORATE_ACTION'
              ? 'CORPORATE_ACTION'
              : 'ANNOUNCEMENT') as NseCorporatePanelRow['kind'],
          event_type: row.eventType,
          headline: row.headline ?? row.eventType,
          category: row.category ?? undefined,
          published_at: row.publishedAt.toISOString(),
          available_at: row.availableAt.toISOString(),
          source: 'nse',
        }));
      }
    } catch {
      /* fall through to file */
    }
    return readPanelFile();
  }

  async ingestSymbol(symbol: string): Promise<{ written: number; miWritten?: number }> {
    const sym = symbol.trim().toUpperCase();
    let rows: NseCorporatePanelRow[] = [];
    try {
      rows = await nseCorporateClient.fetchCorporatePanel(sym);
    } catch {
      rows = [];
    }
    try {
      const fund = await this.prisma.fundamentalSnapshot.findFirst({
        where: { symbol: sym },
        orderBy: { availableAt: 'desc' },
      });
      if (fund) {
        rows = [
          ...rows,
          ...shareholdingFromFundamentals({
            symbol: sym,
            promoter_holding: fund.promoterHolding,
            institution_holding: fund.institutionHolding,
            as_of_date: fund.asOfDate?.toISOString?.() ?? null,
            available_at: fund.availableAt?.toISOString?.() ?? null,
          }),
        ];
      }
    } catch {
      /* optional */
    }

    const existing = await readPanelFile();
    const kept = existing.filter((r) => r.symbol.toUpperCase() !== sym);
    await writePanelFile([...kept, ...rows]);

    let miWritten = 0;
    try {
      const mi = await persistMiCorporateRows(rows);
      miWritten = mi.written;
    } catch (err) {
      console.warn('[mi-persist] corporate write skipped', err);
    }
    return { written: rows.length, miWritten };
  }
}
