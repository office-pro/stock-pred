import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  ARTURO_FLAGS,
  ARTURO_FLAG_LEGACY,
  ARTURO_SUPERADMIN_ACCOUNT,
  ArturoEvaluateResponse,
  ArturoFlagAuditRecord,
  ArturoFlagListResponse,
  ArturoFlagRecord,
  ArturoReleaseMode,
  ArturoStatusResponse,
  UserRole,
} from '@stockpred/shared-types';
import {
  ArturoAccountRulesError,
  evaluateFlag,
  getAppEnv,
  getEnvBool,
  parseAccountRules,
} from '@stockpred/shared-utils';
import { CreateArturoFlagDto, UpdateArturoFlagDto } from './arturo.dto';
import { AuditService } from './audit.service';

/**
 * Server ARTURO APIs are on by default.
 * Management UI visibility is gated in the frontend by `?sha=develop`.
 * Set ARTURO_ENABLED=false to hard-disable CRUD/evaluate APIs.
 */
function isArturoEnabled(): boolean {
  return getEnvBool('ARTURO_ENABLED', true);
}

function assertArturoEnabled(): void {
  if (!isArturoEnabled()) {
    throw new NotFoundException('ARTURO is not available in this environment');
  }
}

@Injectable()
export class ArturoService {
  private readonly prisma = getPrismaClient();

  constructor(private readonly audit: AuditService) {}

  status(): ArturoStatusResponse {
    return {
      enabled: isArturoEnabled(),
      environment: getAppEnv(),
    };
  }

  async ensureDefaultFlags(): Promise<void> {
    if (!isArturoEnabled()) return;
    const key = ARTURO_FLAGS.DESK_EXPERIMENTAL_CHIP;
    const existing = await this.prisma.arturoFlag.findUnique({ where: { key } });
    if (existing) return;

    const legacy = await this.prisma.arturoFlag.findUnique({
      where: { key: ARTURO_FLAG_LEGACY.DESK_EXPERIMENTAL },
    });
    if (legacy) {
      // Soft-migrate pre-convention seed → feat_<area>_<feature>
      await this.prisma.arturoFlag.update({
        where: { key: ARTURO_FLAG_LEGACY.DESK_EXPERIMENTAL },
        data: {
          key,
          name: 'Agent Desk Experimental Chip',
          version: { increment: 1 },
        },
      });
      return;
    }

    await this.prisma.arturoFlag.create({
      data: {
        key,
        name: 'Agent Desk Experimental Chip',
        description:
          'Shows Experimental chip on Agent Desk when enabled. Key convention: feat_<area>_<feature>.',
        releaseMode: ArturoReleaseMode.OFF,
        accountRulesRaw: '',
        version: 1,
      },
    });
  }

  async list(q?: string, page = 1, pageSize = 50): Promise<ArturoFlagListResponse> {
    assertArturoEnabled();
    await this.ensureDefaultFlags();
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = q?.trim()
      ? {
          OR: [
            { name: { contains: q.trim(), mode: 'insensitive' as const } },
            { key: { contains: q.trim(), mode: 'insensitive' as const } },
            { description: { contains: q.trim(), mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.arturoFlag.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.arturoFlag.count({ where }),
    ]);

    const actorIds = [...new Set(rows.map((r) => r.updatedByUserId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(actors.map((a) => [a.id, a.name]));

    return {
      items: rows.map((r) => this.toRecord(r, nameById.get(r.updatedByUserId ?? '') ?? null)),
      total,
      page: Math.max(page, 1),
      pageSize: take,
    };
  }

  async getByKey(key: string): Promise<ArturoFlagRecord> {
    assertArturoEnabled();
    const row = await this.prisma.arturoFlag.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`Flag not found: ${key}`);
    const actor = row.updatedByUserId
      ? await this.prisma.user.findUnique({
          where: { id: row.updatedByUserId },
          select: { name: true },
        })
      : null;
    return this.toRecord(row, actor?.name ?? null);
  }

  async create(actorId: string, dto: CreateArturoFlagDto): Promise<ArturoFlagRecord> {
    assertArturoEnabled();
    this.parseRulesOrThrow(dto.accountRulesRaw ?? '');
    const releaseMode = dto.releaseMode ?? ArturoReleaseMode.OFF;
    try {
      const row = await this.prisma.arturoFlag.create({
        data: {
          key: dto.key.trim().toLowerCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          releaseMode,
          accountRulesRaw: (dto.accountRulesRaw ?? '').trim(),
          version: 1,
          updatedByUserId: actorId,
        },
      });
      await this.writeFlagAudit(row.id, actorId, 'CREATE', null, row);
      await this.audit.log('ARTURO_FLAG_CREATED', actorId, { key: row.key }, actorId);
      return this.toRecord(row, null);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(`Flag key already exists: ${dto.key}`);
      }
      throw error;
    }
  }

  async update(actorId: string, key: string, dto: UpdateArturoFlagDto): Promise<ArturoFlagRecord> {
    assertArturoEnabled();
    const existing = await this.prisma.arturoFlag.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Flag not found: ${key}`);
    if (existing.version !== dto.expectedVersion) {
      throw new ConflictException(
        `Version conflict: expected ${dto.expectedVersion}, current ${existing.version}`,
      );
    }
    if (dto.accountRulesRaw !== undefined) {
      this.parseRulesOrThrow(dto.accountRulesRaw);
    }

    const updated = await this.prisma.arturoFlag.update({
      where: { key },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        description:
          dto.description === undefined
            ? undefined
            : dto.description === null
              ? null
              : dto.description.trim() || null,
        releaseMode: dto.releaseMode,
        accountRulesRaw: dto.accountRulesRaw !== undefined ? dto.accountRulesRaw.trim() : undefined,
        version: { increment: 1 },
        updatedByUserId: actorId,
      },
    });
    await this.writeFlagAudit(updated.id, actorId, 'UPDATE', existing, updated);
    await this.audit.log('ARTURO_FLAG_UPDATED', actorId, { key }, actorId);
    return this.toRecord(updated, null);
  }

  async history(key: string): Promise<ArturoFlagAuditRecord[]> {
    assertArturoEnabled();
    const flag = await this.prisma.arturoFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException(`Flag not found: ${key}`);
    const rows = await this.prisma.arturoFlagAudit.findMany({
      where: { flagId: flag.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      flagId: r.flagId,
      actorUserId: r.actorUserId,
      action: r.action,
      beforeJson: r.beforeJson,
      afterJson: r.afterJson,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async evaluate(actorId: string, keys: string[]): Promise<ArturoEvaluateResponse> {
    assertArturoEnabled();
    const accountId = await this.resolveAccountId(actorId);
    const uniqueKeys = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
    const rows = await this.prisma.arturoFlag.findMany({
      where: { key: { in: uniqueKeys } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const results = uniqueKeys.map((key) => {
      const row = byKey.get(key);
      if (!row) {
        return {
          key,
          enabled: false,
          releaseMode: ArturoReleaseMode.OFF,
          accountId,
        };
      }
      const rules = parseAccountRules(row.accountRulesRaw);
      const mode = this.asMode(row.releaseMode);
      return {
        key,
        enabled: evaluateFlag({ mode, rules, accountId }),
        releaseMode: mode,
        accountId,
      };
    });
    return { results };
  }

  private async resolveAccountId(actorId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      include: { brand: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.brand?.domain) return user.brand.domain.trim().toLowerCase();
    if (user.role === UserRole.SUPERADMIN) return ARTURO_SUPERADMIN_ACCOUNT;
    throw new ServiceUnavailableException('User has no brand domain for ARTURO evaluation');
  }

  private parseRulesOrThrow(raw: string): void {
    try {
      parseAccountRules(raw);
    } catch (error) {
      if (error instanceof ArturoAccountRulesError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
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

  private toRecord(
    row: {
      id: string;
      key: string;
      name: string;
      description: string | null;
      releaseMode: string;
      accountRulesRaw: string;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      updatedByUserId: string | null;
    },
    updatedByName: string | null,
  ): ArturoFlagRecord {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      releaseMode: this.asMode(row.releaseMode),
      accountRulesRaw: row.accountRulesRaw,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      updatedByUserId: row.updatedByUserId,
      updatedByName,
    };
  }

  private async writeFlagAudit(
    flagId: string,
    actorUserId: string,
    action: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    try {
      await this.prisma.arturoFlagAudit.create({
        data: {
          flagId,
          actorUserId,
          action,
          beforeJson: before ? JSON.parse(JSON.stringify(before)) : undefined,
          afterJson: after ? JSON.parse(JSON.stringify(after)) : undefined,
        },
      });
    } catch (error) {
      console.error('[auth-service] arturo audit write failed:', error);
    }
  }
}
