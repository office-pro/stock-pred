import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';

/** Compliance: all auth decisions are recorded in audit_logs. */
@Injectable()
export class AuditService {
  private readonly prisma = getPrismaClient();

  async log(
    action: string,
    actor: string,
    details?: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actor,
          entity: 'user',
          entityId: userId,
          userId,
          details: details ? JSON.parse(JSON.stringify(details)) : undefined,
        },
      });
    } catch (error) {
      // Auditing must never break the main flow, but failures are surfaced in logs.
      console.error('[auth-service] audit write failed:', error);
    }
  }
}
