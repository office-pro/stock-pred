import { getPrismaClient, type Prisma } from '@stockpred/database';
import type { AgentAnalysis, AgentRecommendation } from '@stockpred/shared-types';

export type OpportunityStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'EXPIRED' | 'REJECTED';

const ADDED_STATUSES: OpportunityStatus[] = ['APPROVED', 'EXECUTED'];

/** Prisma Brand FK rejects ''; treat blank as null. */
function normalizeBrandId(brandId: string | null | undefined): string | null {
  return typeof brandId === 'string' && brandId.trim().length > 0 ? brandId.trim() : null;
}

export interface PersistedOpportunity {
  id: string;
  userId: string;
  brandId: string | null;
  symbol: string;
  status: OpportunityStatus;
  analysis: AgentAnalysis;
  quantity: number | null;
  expiresAt: Date | null;
  executedAt: Date | null;
}

function asAnalysis(value: Prisma.JsonValue): AgentAnalysis {
  return value as unknown as AgentAnalysis;
}

/** DB-backed per-user New (PENDING) and Added (APPROVED) agent suggestions. */
export class OpportunityRepository {
  private readonly prisma = getPrismaClient();

  async expireStale(userId: string): Promise<void> {
    await this.prisma.agentOpportunity.updateMany({
      where: {
        userId,
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  async addedSymbols(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.agentOpportunity.findMany({
      where: { userId, status: { in: ADDED_STATUSES } },
      select: { symbol: true },
    });
    return new Set(rows.map((row) => row.symbol.toUpperCase()));
  }

  async listPending(userId: string, limit: number): Promise<PersistedOpportunity[]> {
    const rows = await this.prisma.agentOpportunity.findMany({
      where: { userId, status: 'PENDING' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map(mapRow);
  }

  /** Approved / executed suggestions for the Added tab (per user). */
  async listAdded(userId: string, limit = 200): Promise<PersistedOpportunity[]> {
    const rows = await this.prisma.agentOpportunity.findMany({
      where: { userId, status: { in: ADDED_STATUSES } },
      orderBy: [{ executedAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map(mapRow);
  }

  /**
   * Sync New suggestions for this user.
   * Keeps existing PENDING row ids for the same symbol so Approve still works after refresh.
   * Never deletes APPROVED/EXECUTED rows.
   */
  async syncPending(
    userId: string,
    brandId: string | null | undefined,
    items: Array<{ id: string; analysis: AgentAnalysis; expiresAt: Date }>,
  ): Promise<Array<{ id: string; analysis: AgentAnalysis }>> {
    const existing = await this.prisma.agentOpportunity.findMany({
      where: { userId, status: 'PENDING' },
    });
    const bySymbol = new Map(existing.map((row) => [row.symbol.toUpperCase(), row]));
    const keepSymbols = new Set(items.map((item) => item.analysis.symbol.toUpperCase()));
    const resolved: Array<{ id: string; analysis: AgentAnalysis }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const symbol = item.analysis.symbol.toUpperCase();
        const prev = bySymbol.get(symbol);
        const id = prev?.id ?? item.id;
        const analysis = { ...item.analysis, recommendationId: id };
        if (prev) {
          await tx.agentOpportunity.update({
            where: { id },
            data: {
              analysis: analysis as unknown as Prisma.InputJsonValue,
              expiresAt: item.expiresAt,
              brandId: normalizeBrandId(brandId) ?? prev.brandId,
              symbol,
              status: 'PENDING',
            },
          });
        } else {
          await tx.agentOpportunity.create({
            data: {
              id,
              userId,
              brandId: normalizeBrandId(brandId),
              symbol,
              status: 'PENDING',
              analysis: analysis as unknown as Prisma.InputJsonValue,
              expiresAt: item.expiresAt,
            },
          });
        }
        resolved.push({ id, analysis });
      }

      const staleIds = existing
        .filter((row) => !keepSymbols.has(row.symbol.toUpperCase()))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await tx.agentOpportunity.deleteMany({
          where: { userId, status: 'PENDING', id: { in: staleIds } },
        });
      }
    });

    return resolved;
  }

  async upsertPending(
    userId: string,
    brandId: string | null | undefined,
    id: string,
    analysis: AgentAnalysis,
    expiresAt: Date,
  ): Promise<void> {
    const symbol = analysis.symbol.toUpperCase();
    const normalizedBrandId = normalizeBrandId(brandId);
    const existing = await this.prisma.agentOpportunity.findFirst({
      where: { userId, symbol, status: 'PENDING' },
    });
    const rowId = existing?.id ?? id;
    const withId = { ...analysis, recommendationId: rowId };
    await this.prisma.agentOpportunity.upsert({
      where: { id: rowId },
      create: {
        id: rowId,
        userId,
        brandId: normalizedBrandId,
        symbol,
        status: 'PENDING',
        analysis: withId as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      update: {
        analysis: withId as unknown as Prisma.InputJsonValue,
        expiresAt,
        status: 'PENDING',
        brandId: normalizedBrandId,
        symbol,
      },
    });
  }

  async findForUser(id: string, userId: string): Promise<PersistedOpportunity | null> {
    const row = await this.prisma.agentOpportunity.findFirst({
      where: { id, userId },
    });
    return row ? mapRow(row) : null;
  }

  /** Human REJECT — marks PENDING opportunity rejected. Never submits to Gate. */
  async markRejected(id: string, userId: string): Promise<PersistedOpportunity | null> {
    const existing = await this.prisma.agentOpportunity.findFirst({
      where: { OR: [{ id, userId }, { id }] },
    });
    if (!existing) return null;
    if (existing.userId !== userId) {
      throw new Error('Suggestion belongs to another user');
    }
    if (existing.status !== 'PENDING' && existing.status !== 'WAITING') {
      return mapRow(existing);
    }
    const row = await this.prisma.agentOpportunity.update({
      where: { id: existing.id },
      data: { status: 'REJECTED' },
    });
    return mapRow(row);
  }

  /** Persist an approved suggestion for this user (Added tab). Never deletes other users' rows. */
  async markApproved(
    id: string,
    userId: string,
    brandId: string | null | undefined,
    quantity: number,
    analysis: AgentAnalysis,
  ): Promise<PersistedOpportunity> {
    const symbol = analysis.symbol.toUpperCase();
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.agentOpportunity.findFirst({
        where: { OR: [{ id, userId }, { id }] },
      });
      if (existing && existing.userId !== userId) {
        throw new Error('Suggestion belongs to another user');
      }
      const saved = existing
        ? await tx.agentOpportunity.update({
            where: { id: existing.id },
            data: {
              status: 'APPROVED',
              quantity,
              executedAt: now,
              analysis: analysis as unknown as Prisma.InputJsonValue,
              symbol,
              userId,
              brandId: brandId ?? existing.brandId,
            },
          })
        : await tx.agentOpportunity.create({
            data: {
              id,
              userId,
              brandId: brandId ?? null,
              symbol,
              status: 'APPROVED',
              quantity,
              executedAt: now,
              analysis: analysis as unknown as Prisma.InputJsonValue,
            },
          });
      await tx.agentOpportunity.updateMany({
        where: {
          userId,
          symbol,
          status: 'PENDING',
          id: { not: saved.id },
        },
        data: { status: 'REJECTED' },
      });
      return saved;
    });
    return mapRow(row);
  }

  toRecommendation(row: PersistedOpportunity): AgentRecommendation {
    return {
      id: row.id,
      analysis: { ...row.analysis, recommendationId: row.id },
      status:
        row.status === 'APPROVED'
          ? 'APPROVED'
          : row.status === 'EXECUTED'
            ? 'EXECUTED'
            : row.status === 'REJECTED'
              ? 'REJECTED'
              : row.status === 'EXPIRED'
                ? 'EXPIRED'
                : 'PENDING',
      expiresAt: row.expiresAt?.getTime() ?? Date.now() + 30 * 60_000,
    };
  }
}

function mapRow(row: {
  id: string;
  userId: string;
  brandId: string | null;
  symbol: string;
  status: string;
  analysis: Prisma.JsonValue;
  quantity: number | null;
  expiresAt: Date | null;
  executedAt: Date | null;
}): PersistedOpportunity {
  return {
    id: row.id,
    userId: row.userId,
    brandId: row.brandId,
    symbol: row.symbol,
    status: row.status as OpportunityStatus,
    analysis: asAnalysis(row.analysis),
    quantity: row.quantity,
    expiresAt: row.expiresAt,
    executedAt: row.executedAt,
  };
}
