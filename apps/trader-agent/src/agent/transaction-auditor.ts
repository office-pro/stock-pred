import { getPrismaClient, type Prisma } from '@stockpred/database';
import type { AgentAnalysis } from '@stockpred/shared-types';

export interface AgentTransactionAudit {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Fill price (entry for BUY, exit for SELL). */
  price: number;
  entryPrice?: number | null;
  exitPrice?: number | null;
  pnl?: number | null;
  status: string;
  mode: string;
  exitReason?: string | null;
  /** Short label: why this side was taken. */
  reason: string;
  /** Longer explanation (thesis / invalidation / policy). */
  explanation: string;
  decision?: string | null;
  stopLoss?: number | null;
  target?: number | null;
  recommendationId?: string | null;
  timestamp: number;
}

function asAnalysis(value: Prisma.JsonValue | null | undefined): AgentAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  return value as unknown as AgentAnalysis;
}

function formatInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function explainExitReason(code: string | null | undefined): string {
  switch (code) {
    case 'TARGET_HIT':
      return 'Target price was hit — take-profit exit.';
    case 'STOP_LOSS_HIT':
      return 'Stop-loss was hit — cut risk.';
    case 'TRAIL_STOP':
      return 'Trailing stop triggered under agent exit policy.';
    case 'PARTIAL_TARGET':
      return 'Partial profit taken at first target (agent policy).';
    case 'THESIS_INVALID':
      return 'Trade thesis no longer valid — agent exited.';
    case 'REVERSAL_SIGNAL':
      return 'Bearish / reversal signal fired — exit.';
    case 'BEARISH_ML_PREDICTION':
      return 'ML prediction turned bearish — exit.';
    case 'AGENT_POLICY':
      return 'Closed by agent exit policy.';
    case 'MANUAL':
      return 'Manual sell from paper book.';
    default:
      return code ? `Exit reason: ${code.replaceAll('_', ' ').toLowerCase()}.` : 'Position closed.';
  }
}

function buyExplanation(
  analysis: AgentAnalysis | null,
  trade: {
    price: number;
    target: number | null;
    stopLoss: number | null;
    quantity: number;
  },
): { reason: string; explanation: string; decision: string | null } {
  if (!analysis) {
    return {
      reason: 'Paper buy (no agent thesis on file)',
      explanation: `Bought ${trade.quantity} @ ${formatInr(trade.price)}${
        trade.stopLoss != null ? ` · stop ${formatInr(trade.stopLoss)}` : ''
      }${trade.target != null ? ` · target ${formatInr(trade.target)}` : ''}.`,
      decision: null,
    };
  }
  const decision = analysis.decision?.replaceAll('_', ' ') ?? 'BUY';
  const thesis = analysis.thesis?.trim() || analysis.action?.trim() || 'Agent-approved buy.';
  const setupBits = [
    `Entry ${formatInr(analysis.setup?.entry ?? trade.price)}`,
    analysis.setup?.stopLoss != null || trade.stopLoss != null
      ? `stop ${formatInr(analysis.setup?.stopLoss ?? trade.stopLoss)}`
      : null,
    analysis.setup?.target1 != null || trade.target != null
      ? `T1 ${formatInr(analysis.setup?.target1 ?? trade.target)}`
      : null,
    analysis.scores?.overall != null ? `score ${analysis.scores.overall}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    reason: `Why BUY — ${decision}`,
    explanation: `${thesis}${setupBits ? ` (${setupBits})` : ''}`,
    decision,
  };
}

function sellExplanation(
  exitReason: string | null | undefined,
  analysis: AgentAnalysis | null,
  trade: { entryPrice: number; exitPrice: number; quantity: number; pnl: number | null },
): { reason: string; explanation: string } {
  const base = explainExitReason(exitReason);
  const invalidation = analysis?.invalidation?.trim();
  const counter = analysis?.counterThesis?.trim();
  const pnlBit =
    trade.pnl != null ? ` PnL ${trade.pnl >= 0 ? '+' : ''}${formatInr(trade.pnl)}.` : '';
  const priceBit = `Sold ${trade.quantity} @ ${formatInr(trade.exitPrice)} (entry ${formatInr(trade.entryPrice)}).`;
  const whyExtra = invalidation
    ? ` Invalidation: ${invalidation}`
    : counter
      ? ` Counter-thesis: ${counter}`
      : '';
  return {
    reason: `Why SELL — ${(exitReason ?? 'EXIT').replaceAll('_', ' ')}`,
    explanation: `${priceBit} ${base}${whyExtra}${pnlBit}`.trim(),
  };
}

/** Build per-user agent desk transaction audit from trades + approved opportunities. */
export class AgentTransactionAuditor {
  private readonly prisma = getPrismaClient();

  async listForUser(
    userId: string,
    brandId: string | null | undefined,
    limit = 50,
  ): Promise<AgentTransactionAudit[]> {
    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        ...(brandId ? { brandId } : {}),
      },
      orderBy: { executedAt: 'desc' },
      take: Math.min(Math.max(limit * 2, 40), 200),
    });

    const opportunities = await this.prisma.agentOpportunity.findMany({
      where: {
        userId,
        status: { in: ['APPROVED', 'EXECUTED'] },
        ...(brandId ? { brandId } : {}),
      },
      orderBy: { executedAt: 'desc' },
    });

    const oppBySymbol = new Map<string, (typeof opportunities)[number]>();
    for (const row of opportunities) {
      const key = row.symbol.toUpperCase();
      if (!oppBySymbol.has(key)) oppBySymbol.set(key, row);
    }

    const events: AgentTransactionAudit[] = [];

    for (const trade of trades) {
      const symbol = trade.symbol.toUpperCase();
      const opp = oppBySymbol.get(symbol);
      const analysis = asAnalysis(opp?.analysis ?? null);

      if (trade.side === 'SELL') {
        const exitPrice = trade.exitPrice ?? trade.price;
        const entryPrice = trade.price;
        const { reason, explanation } = sellExplanation(trade.exitReason, analysis, {
          entryPrice,
          exitPrice,
          quantity: trade.quantity,
          pnl: trade.pnl,
        });
        events.push({
          id: `${trade.id}-sell`,
          symbol,
          side: 'SELL',
          quantity: trade.quantity,
          price: exitPrice,
          entryPrice,
          exitPrice,
          pnl: trade.pnl,
          status: trade.status,
          mode: trade.mode,
          exitReason: trade.exitReason,
          reason,
          explanation,
          decision: analysis?.decision ?? null,
          stopLoss: null,
          target: null,
          recommendationId: opp?.id ?? null,
          timestamp: (trade.closedAt ?? trade.executedAt).getTime(),
        });
        continue;
      }

      // BUY leg (open or later closed)
      const buyMeta = buyExplanation(analysis, {
        price: trade.price,
        target: trade.target,
        stopLoss: trade.stopLoss,
        quantity: trade.quantity,
      });
      events.push({
        id: `${trade.id}-buy`,
        symbol,
        side: 'BUY',
        quantity: trade.quantity,
        price: trade.price,
        entryPrice: trade.price,
        exitPrice: trade.exitPrice,
        pnl: trade.status === 'OPEN' ? null : trade.pnl,
        status: trade.status === 'OPEN' ? 'OPEN' : 'FILLED',
        mode: trade.mode,
        exitReason: null,
        reason: buyMeta.reason,
        explanation: buyMeta.explanation,
        decision: buyMeta.decision,
        stopLoss: trade.stopLoss,
        target: trade.target,
        recommendationId: opp?.id ?? null,
        timestamp: trade.executedAt.getTime(),
      });

      // If this BUY row was fully closed in-place, emit a SELL audit event too.
      if (trade.status === 'CLOSED' && trade.exitPrice != null && trade.exitPrice > 0) {
        const { reason, explanation } = sellExplanation(trade.exitReason, analysis, {
          entryPrice: trade.price,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          pnl: trade.pnl,
        });
        events.push({
          id: `${trade.id}-close`,
          symbol,
          side: 'SELL',
          quantity: trade.quantity,
          price: trade.exitPrice,
          entryPrice: trade.price,
          exitPrice: trade.exitPrice,
          pnl: trade.pnl,
          status: 'CLOSED',
          mode: trade.mode,
          exitReason: trade.exitReason,
          reason,
          explanation,
          decision: analysis?.decision ?? null,
          stopLoss: trade.stopLoss,
          target: trade.target,
          recommendationId: opp?.id ?? null,
          timestamp: (trade.closedAt ?? trade.executedAt).getTime(),
        });
      }
    }

    events.sort((a, b) => b.timestamp - a.timestamp);
    return events.slice(0, limit);
  }
}
