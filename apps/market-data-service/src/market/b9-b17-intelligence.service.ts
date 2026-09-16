/**
 * B9–B17 advisory intelligence over in-memory MDS history.
 * Never authorization / never fabricate when history insufficient.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Timeframe } from '@stockpred/shared-types';
import type {
  BullRunIntelligenceSnapshot,
  CrossAssetRelationship,
  FnoIntelligenceSnapshot,
  GlobalEventIntelligence,
  HistoricalEventIntelligence,
  InverseBeneficiarySnapshot,
  LeadLagRelationship,
  RelationshipMetrics,
  RelationshipPairKind,
  SectorIntelligenceSnapshot,
} from '@stockpred/shared-types';
import {
  assessBullRunIntelligence,
  assessCrossAssetFromCandles,
  assessFnoIntelligence,
  assessGlobalEventImpact,
  assessHistoricalEventsFromCandles,
  assessInverseBeneficiariesFromCandles,
  assessRelationshipFromCandles,
  assessHistoricalIntelligence,
  bestLeadLag,
  buildBullRunV2FromEvidence,
  buildSectorIntelligenceSnapshot,
  closesFromCandles,
  targetedUniverseFromGlobalEvent,
  type GlobalEventInput,
  type SectorMemberInput,
} from '@stockpred/shared-utils';
import type { BullRunV2Assessment } from '@stockpred/shared-types';
import { MarketService } from './market.service';

@Injectable()
export class B9B17IntelligenceService {
  constructor(private readonly market: MarketService) {}

  listSectors(): { sectors: Array<{ sector: string; memberCount: number }> } {
    const counts = new Map<string, number>();
    for (const row of this.market.listSectorMembership()) {
      const key = row.sector || 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sectors = [...counts.entries()]
      .map(([sector, memberCount]) => ({ sector, memberCount }))
      .sort((a, b) => a.sector.localeCompare(b.sector));
    return { sectors };
  }

  sectorIntelligence(sector: string): SectorIntelligenceSnapshot {
    const name = sector?.trim();
    if (!name) throw new BadRequestException('sector is required');
    const members = this.membersForSector(name);
    return buildSectorIntelligenceSnapshot(name, members);
  }

  sectorMembers(sector: string): { sector: string; symbols: string[] } {
    const name = sector?.trim();
    if (!name) throw new BadRequestException('sector is required');
    const want = name.toUpperCase();
    const symbols = this.market
      .listSectorMembership()
      .filter((m) => (m.sector || '').toUpperCase() === want)
      .map((m) => m.symbol)
      .sort();
    return { sector: name, symbols };
  }

  allSectorsIntelligence(limit = 40): {
    sectors: SectorIntelligenceSnapshot[];
    coverage: number;
    asOf: string;
    sessionDate?: string | null;
    dataStatus?: string | null;
    sessionCoverage?: {
      live: number;
      delayed: number;
      priorSession: number;
      closedMarket: number;
      stale: number;
      unavailable: number;
      newestDataAt?: number | null;
      oldestDataAt?: number | null;
    };
  } {
    const listed = this.listSectors().sectors.slice(0, Math.min(limit, 80));
    const sectors = listed.map((s) => {
      const snap = buildSectorIntelligenceSnapshot(s.sector, this.membersForSector(s.sector));
      return { ...snap, memberCount: snap.memberCount ?? s.memberCount };
    });
    const available = sectors.filter((s) => s.status === 'AVAILABLE');
    const tipTimes = available
      .map((s) => s.sessionCoverage?.newestDataAt)
      .filter((t): t is number => t != null && Number.isFinite(t));
    const oldestTips = available
      .map((s) => s.sessionCoverage?.oldestDataAt)
      .filter((t): t is number => t != null && Number.isFinite(t));
    const sessionCoverage = {
      live: available.reduce((n, s) => n + (s.sessionCoverage?.live ?? 0), 0),
      delayed: available.reduce((n, s) => n + (s.sessionCoverage?.delayed ?? 0), 0),
      priorSession: available.reduce((n, s) => n + (s.sessionCoverage?.priorSession ?? 0), 0),
      closedMarket: available.reduce((n, s) => n + (s.sessionCoverage?.closedMarket ?? 0), 0),
      stale: available.reduce((n, s) => n + (s.sessionCoverage?.stale ?? 0), 0),
      unavailable: available.reduce((n, s) => n + (s.sessionCoverage?.unavailable ?? 0), 0),
      newestDataAt: tipTimes.length ? Math.max(...tipTimes) : null,
      oldestDataAt: oldestTips.length ? Math.min(...oldestTips) : null,
    };
    const dateCounts = new Map<string, number>();
    for (const s of available) {
      if (s.sessionDate) dateCounts.set(s.sessionDate, (dateCounts.get(s.sessionDate) ?? 0) + 1);
    }
    let sessionDate: string | null = null;
    let best = 0;
    for (const [d, n] of dateCounts) {
      if (n > best) {
        best = n;
        sessionDate = d;
      }
    }
    let dataStatus: string | null = 'UNAVAILABLE';
    if (sessionCoverage.live > 0) dataStatus = 'LIVE';
    else if (sessionCoverage.delayed > 0) dataStatus = 'DELAYED';
    else if (sessionCoverage.closedMarket > 0) dataStatus = 'CLOSED_MARKET';
    else if (sessionCoverage.stale > 0) dataStatus = 'STALE';
    else if (sessionCoverage.priorSession > 0) dataStatus = 'PRIOR_SESSION';

    const asOfMs = sessionCoverage.newestDataAt;
    return {
      sectors,
      coverage: listed.length,
      asOf:
        asOfMs != null ? new Date(asOfMs).toISOString() : (sessionDate ?? new Date().toISOString()),
      sessionDate,
      dataStatus,
      sessionCoverage,
    };
  }

  /**
   * B10 + Bull-Run v2 (distribution → Target×Horizon) from the same candles.
   * Attaches historical-analogue max-forward samples when sample-sufficient.
   * Does not re-run Sector/ML/News engines — uses quote/ML already in MDS memory.
   * Detail/path only — never N×MDS historical recompute on batch finalize.
   */
  bullRun(symbol: string): BullRunIntelligenceSnapshot & {
    v2: BullRunV2Assessment;
    historicalIntelligence?: ReturnType<typeof assessHistoricalIntelligence>;
  } {
    const sym = symbol.toUpperCase();
    const candles = this.market.peekDailyCandles(sym, 900);
    const quote = this.market.peekQuote(sym);
    const ml = this.market.getUsableMlPrediction(sym);
    const sectorName =
      (quote as { sector?: string | null } | null)?.sector ??
      (quote as { info?: { sector?: string } } | null)?.info?.sector ??
      null;
    let sectorState: string | null = null;
    if (sectorName) {
      try {
        const snap = buildSectorIntelligenceSnapshot(
          String(sectorName),
          this.membersForSector(String(sectorName)),
        );
        if (snap.status === 'AVAILABLE' && snap.state !== 'UNKNOWN') {
          sectorState = snap.state;
        }
      } catch {
        /* omit sector — do not invent */
      }
    }
    const b10 = assessBullRunIntelligence({
      symbol: sym,
      candles,
      relativeStrength: quote?.scanner?.relativeStrengthNifty50 ?? null,
      scannerBullScore: quote?.scanner?.bullScore ?? null,
      mlUpProbability: ml?.probabilities?.UP ?? null,
      mlConfidence: ml?.confidence ?? null,
      regime: null,
      sectorState,
    });
    const closes = closesFromCandles(candles);
    const dataStatus =
      quote?.updatedAt && Date.now() - Number(quote.updatedAt) < 60_000
        ? 'LIVE'
        : quote?.updatedAt
          ? 'DELAYED'
          : 'OFFLINE';

    let historicalIntelligence: ReturnType<typeof assessHistoricalIntelligence> | undefined;
    let analogueMaxForwardReturnsByHorizon:
      | Partial<
          Record<'1M' | '3M' | '6M' | '12M', { sampleSize: number; maxForwardReturns: number[] }>
        >
      | undefined;
    if (closes.length >= 40) {
      try {
        historicalIntelligence = assessHistoricalIntelligence({ symbol: sym, closes });
        const dist = historicalIntelligence.forwardDistribution3M;
        if (dist.status === 'AVAILABLE' && dist.maxForwardReturns?.length) {
          analogueMaxForwardReturnsByHorizon = {
            '3M': {
              sampleSize: dist.sampleSize,
              maxForwardReturns: dist.maxForwardReturns,
            },
          };
        }
      } catch {
        historicalIntelligence = undefined;
        analogueMaxForwardReturnsByHorizon = undefined;
      }
    }

    const historicalEvents = this.historicalEvents(sym);
    const v2 = buildBullRunV2FromEvidence({
      symbol: sym,
      closes,
      bullRunSnapshot: b10,
      historical: historicalEvents,
      analogueMaxForwardReturnsByHorizon,
      dataStatus,
      dataAsOf: quote?.updatedAt ?? undefined,
    });
    return { ...b10, v2, historicalIntelligence };
  }

  /**
   * Historical State / Analogues / Forward Distribution from in-memory daily candles.
   * Distinct from B13 historicalEvents (shock windows). Never fabricates below min-sample.
   */
  historicalAnalogues(symbol: string): ReturnType<typeof assessHistoricalIntelligence> {
    const sym = symbol.toUpperCase();
    const candles = this.market.peekDailyCandles(sym, 900);
    const closes = closesFromCandles(candles);
    return assessHistoricalIntelligence({ symbol: sym, closes });
  }

  relationship(
    left: string,
    right: string,
    kind: RelationshipPairKind = 'STOCK_STOCK',
    windowDays = 60,
  ): { relationship: RelationshipMetrics; leadLag: LeadLagRelationship | null } {
    const l = left.toUpperCase();
    const r = right.toUpperCase();
    const leftC = this.market.peekDailyCandles(l, 400);
    const rightC = this.market.peekDailyCandles(r, 400);
    const relationship = assessRelationshipFromCandles(l, r, leftC, rightC, kind, windowDays);
    const leftCloses = leftC.map((c) => c.close).filter((n): n is number => Number.isFinite(n));
    const rightCloses = rightC.map((c) => c.close).filter((n): n is number => Number.isFinite(n));
    const leadLag =
      leftCloses.length >= 20 && rightCloses.length >= 20
        ? bestLeadLag(l, r, leftCloses, rightCloses)
        : null;
    return { relationship, leadLag };
  }

  inverseBeneficiaries(
    anchor: string,
    peers?: string[],
    downsideThreshold = -0.05,
  ): InverseBeneficiarySnapshot {
    const a = anchor.toUpperCase();
    const peerList =
      peers && peers.length > 0 ? peers.map((p) => p.toUpperCase()) : this.defaultPeers(a, 25);
    const series = peerList.map((symbol) => ({
      symbol,
      candles: this.market.peekDailyCandles(symbol, 400),
    }));
    return assessInverseBeneficiariesFromCandles(
      a,
      this.market.peekDailyCandles(a, 400),
      series,
      downsideThreshold,
    );
  }

  historicalEvents(symbol: string, dayReturnThreshold = -0.05): HistoricalEventIntelligence {
    const sym = symbol.toUpperCase();
    return assessHistoricalEventsFromCandles(sym, this.market.peekDailyCandles(sym, 900), {
      dayReturnThreshold,
    });
  }

  async crossAssetWithIndex(symbol: string, asset = 'NIFTY'): Promise<CrossAssetRelationship> {
    const sym = symbol.toUpperCase();
    const assetId = asset.toUpperCase();
    const left = this.market.peekDailyCandles(sym, 400);
    let right = this.market.peekDailyCandles(assetId, 400);
    if (right.length < 30) {
      try {
        right = await this.market.getCandles(assetId, Timeframe.ONE_DAY, 400);
      } catch {
        /* keep empty → UNAVAILABLE */
      }
    }
    return assessCrossAssetFromCandles(sym, assetId, left, right);
  }

  fno(symbol: string): FnoIntelligenceSnapshot {
    const configured = String(process.env.FNO_PROVIDER_CONFIGURED ?? '').toLowerCase() === 'true';
    return assessFnoIntelligence(symbol.toUpperCase(), configured);
  }

  globalEvent(body: {
    eventType?: string;
    headline?: string;
    country?: string;
    eventTime?: string;
    source?: string;
    importance?: GlobalEventInput['importance'];
    actual?: string | number | null;
    consensus?: string | number | null;
    previous?: string | number | null;
    surpriseDirection?: GlobalEventInput['surpriseDirection'];
    eventId?: string;
  }): {
    event: GlobalEventIntelligence;
    targetedUniverse: ReturnType<typeof targetedUniverseFromGlobalEvent>;
  } {
    const input: GlobalEventInput = {
      eventId: body.eventId,
      eventType: body.eventType ?? body.headline ?? '',
      headline: body.headline,
      country: body.country,
      eventTime: body.eventTime,
      source: body.source ?? 'api',
      importance: body.importance,
      actual: body.actual,
      consensus: body.consensus,
      previous: body.previous,
      surpriseDirection: body.surpriseDirection,
    };
    const membership = this.market.listSectorMembership();
    const event = assessGlobalEventImpact(input, membership);
    return { event, targetedUniverse: targetedUniverseFromGlobalEvent(event) };
  }

  private membersForSector(sector: string): SectorMemberInput[] {
    const want = sector.toUpperCase();
    const out: SectorMemberInput[] = [];
    for (const row of this.market.listSectorMembership()) {
      if ((row.sector || '').toUpperCase() !== want) continue;
      const candles = this.market.peekDailyCandles(row.symbol, 280);
      if (candles.length < 6) continue;
      const quote = this.market.peekQuote(row.symbol);
      out.push({
        symbol: row.symbol,
        sector: row.sector,
        candles,
        relativeStrength: quote?.scanner?.relativeStrengthNifty50 ?? null,
        lastPrice: quote?.price ?? null,
        previousClose: quote?.previousClose ?? null,
        quoteUpdatedAt: quote?.updatedAt ?? null,
      });
    }
    return out;
  }

  private defaultPeers(anchor: string, limit: number): string[] {
    const membership = this.market.listSectorMembership();
    const mine = membership.find((m) => m.symbol === anchor);
    const sector = mine?.sector;
    const peers = membership
      .filter((m) => m.symbol !== anchor && (!sector || m.sector === sector))
      .map((m) => m.symbol)
      .slice(0, limit);
    if (peers.length > 0) return peers;
    return membership
      .filter((m) => m.symbol !== anchor)
      .map((m) => m.symbol)
      .slice(0, limit);
  }
}
