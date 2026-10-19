import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  ARTURO_FLAGS,
  ARTURO_SUPERADMIN_ACCOUNT,
  ArturoReleaseMode,
  UserRole,
} from '@stockpred/shared-types';
import { evaluateFlag, getEnvBool, parseAccountRules } from '@stockpred/shared-utils';

export type ArturoEvalContext = {
  userId?: string | null;
  brandId?: string | null;
};

/**
 * Server-side ARTURO evaluation for trader-agent (authoritative; never trusts FE).
 */
@Injectable()
export class ArturoFlagService {
  private readonly prisma = getPrismaClient();

  private arturoApisEnabled(): boolean {
    return getEnvBool('ARTURO_ENABLED', true);
  }

  /**
   * Resolve effective boolean for a flag key for the authenticated brand/account.
   * Missing flag or ARTURO disabled → false.
   */
  async isEnabled(flagKey: string, ctx: ArturoEvalContext = {}): Promise<boolean> {
    if (!this.arturoApisEnabled()) return false;
    const key = flagKey.trim().toLowerCase();
    if (!key) return false;

    const row = await this.prisma.arturoFlag.findUnique({ where: { key } });
    if (!row) return false;

    const accountId = await this.resolveAccountId(ctx);
    if (!accountId) return false;

    const mode = this.asMode(row.releaseMode);
    const rules = parseAccountRules(row.accountRulesRaw);
    return evaluateFlag({ mode, rules, accountId }) === true;
  }

  /** Convenience for the Nifty fundamentals requirement flag. */
  async niftyFundamentalsRequired(ctx: ArturoEvalContext = {}): Promise<boolean> {
    return this.isEnabled(ARTURO_FLAGS.NIFTY_ALL_STOCK_REQUIREMENT_FUNDAMENTALS, ctx);
  }

  private async resolveAccountId(ctx: ArturoEvalContext): Promise<string | null> {
    if (ctx.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: ctx.brandId },
        select: { domain: true },
      });
      if (brand?.domain) return brand.domain.trim().toLowerCase();
    }
    if (ctx.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
        include: { brand: true },
      });
      if (user?.brand?.domain) return user.brand.domain.trim().toLowerCase();
      if (user?.role === UserRole.SUPERADMIN) return ARTURO_SUPERADMIN_ACCOUNT;
    }
    return null;
  }

  private asMode(raw: string): ArturoReleaseMode {
    if (
      raw === ArturoReleaseMode.GENERAL_AVAILABILITY ||
      raw === ArturoReleaseMode.CODE_BETA ||
      raw === ArturoReleaseMode.OFF
    ) {
      return raw;
    }
    return ArturoReleaseMode.OFF;
  }
}
