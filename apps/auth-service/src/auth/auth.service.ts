import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { ensureDemoUsers, getPrismaClient } from '@stockpred/database';
import {
  AccessExtensionRequestDto,
  ALL_ASSIGNABLE_VIEWS,
  AppView,
  AuthTokens,
  AuthUser,
  BrandStatus,
  BrandSummary,
  canCreateRole,
  ExtensionRequestStatus,
  UserRole,
  UserStatus,
} from '@stockpred/shared-types';
import { getEnv } from '@stockpred/shared-utils';
import { AuditService } from './audit.service';
import type {
  CreateBrandDto,
  CreateUserDto,
  ExtensionRequestDto,
  ReviewExtensionDto,
  UpdateBrandDto,
  UpdateUserDto,
} from './dto';
import { isDatabaseUnavailable } from './prisma-errors';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

type DbUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  brandId: string | null;
  allowedViews: string[];
  accessExpiresAt: Date | null;
  passwordHash?: string;
  brand?: {
    id: string;
    name: string;
    domain: string;
    paperCapital: number;
    status: string;
    contactEmail: string | null;
    contactPhone: string | null;
    logoUrl: string | null;
    notes: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  } | null;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly prisma = getPrismaClient();

  constructor(
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (getEnv('NODE_ENV', 'development') === 'production') return;
    try {
      await ensureDemoUsers(this.prisma);
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        console.error(
          '[auth-service] Postgres is unreachable. Point DATABASE_URL at Docker Postgres (see POSTGRES_PORT) and run npm run prisma:migrate.',
        );
        return;
      }
      console.error('[auth-service] could not ensure demo users:', error);
    }
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user = await this.findUserByEmail(email);
    if (!user || !(await compare(password, user.passwordHash))) {
      await this.audit.log('LOGIN_FAILED', email);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === UserStatus.SUSPENDED) {
      await this.audit.log('LOGIN_SUSPENDED', email, undefined, user.id);
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }
    const full = await this.loadUser(user.id);
    if (!full) throw new UnauthorizedException('User no longer exists');
    const tokens = await this.issueAndStoreTokens(full);
    await this.audit.log('LOGIN_SUCCEEDED', email, undefined, user.id);
    return { user: this.toAuthUser(full), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = this.tokens.verifyRefreshToken(refreshToken);
    const tokenHash = this.tokens.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt !== null || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is revoked or expired');
    }
    const user = await this.loadUser(payload.sub);
    if (!user || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issueAndStoreTokens(user);
    await this.audit.log('TOKEN_REFRESHED', user.email, undefined, user.id);
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (stored && stored.revokedAt === null) {
      await this.prisma.refreshToken.update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
      await this.audit.log('LOGOUT', stored.userId, undefined, stored.userId);
    }
  }

  async getUser(userId: string): Promise<AuthUser> {
    const user = await this.loadUser(userId);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return this.toAuthUser(user);
  }

  // ── Brands ──────────────────────────────────────────────────────────────

  async createBrand(actorId: string, dto: CreateBrandDto): Promise<BrandSummary> {
    await this.requireRole(actorId, [UserRole.SUPERADMIN]);
    const existing = await this.prisma.brand.findFirst({
      where: { OR: [{ name: dto.name }, { domain: dto.domain }] },
    });
    if (existing) throw new ConflictException('Brand name or domain already exists');

    const brand = await this.prisma.brand.create({
      data: {
        name: dto.name,
        domain: dto.domain,
        paperCapital: dto.paperCapital,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        logoUrl: dto.logoUrl,
        notes: dto.notes,
        status: BrandStatus.ACTIVE,
      },
    });

    if (dto.adminEmail && dto.adminPassword && dto.adminName) {
      await this.prisma.user.create({
        data: {
          email: dto.adminEmail,
          name: dto.adminName,
          passwordHash: await hash(dto.adminPassword, BCRYPT_ROUNDS),
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          brandId: brand.id,
          allowedViews: ALL_ASSIGNABLE_VIEWS.map(String),
        },
      });
    }

    await this.audit.log('BRAND_CREATED', actorId, { brandId: brand.id }, actorId);
    return this.toBrand(brand);
  }

  async listBrands(actorId: string): Promise<BrandSummary[]> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const brands =
      actor.role === UserRole.SUPERADMIN
        ? await this.prisma.brand.findMany({ orderBy: { name: 'asc' } })
        : actor.brandId
          ? await this.prisma.brand.findMany({ where: { id: actor.brandId } })
          : [];
    return brands.map((b) => this.toBrand(b));
  }

  async getBrand(actorId: string, brandId: string): Promise<BrandSummary> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    if (actor.role !== UserRole.SUPERADMIN && actor.brandId !== brandId) {
      throw new ForbiddenException('Cannot access another brand');
    }
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    return this.toBrand(brand);
  }

  async updateBrand(actorId: string, brandId: string, dto: UpdateBrandDto): Promise<BrandSummary> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Brand not found');

    if (actor.role !== UserRole.SUPERADMIN) {
      if (actor.brandId !== brandId) throw new ForbiddenException('Cannot edit another brand');
      if (dto.name !== undefined || dto.domain !== undefined || dto.paperCapital !== undefined) {
        throw new ForbiddenException('Only superadmin can change name, domain, or paper capital');
      }
    }

    const updated = await this.prisma.brand.update({
      where: { id: brandId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.domain !== undefined ? { domain: dto.domain } : {}),
        ...(dto.paperCapital !== undefined ? { paperCapital: dto.paperCapital } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.log('BRAND_UPDATED', actorId, { brandId, dto }, actorId);
    return this.toBrand(updated);
  }

  // ── Users ───────────────────────────────────────────────────────────────

  async createUser(actorId: string, dto: CreateUserDto): Promise<AuthUser> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    if (!canCreateRole(actor.role as UserRole, dto.role)) {
      throw new ForbiddenException(`Cannot create role ${dto.role}`);
    }

    let brandId = dto.brandId ?? actor.brandId;
    if (dto.role === UserRole.ADMIN) {
      if (actor.role !== UserRole.SUPERADMIN)
        throw new ForbiddenException('Only superadmin creates admins');
      if (!dto.brandId) throw new BadRequestException('brandId is required for admins');
      brandId = dto.brandId;
    } else if (actor.role === UserRole.ADMIN) {
      brandId = actor.brandId;
    }
    if (!brandId && dto.role !== UserRole.SUPERADMIN) {
      throw new BadRequestException('brandId is required');
    }

    const existing = await this.findUserByEmail(dto.email);
    if (existing) throw new ConflictException('An account with this email already exists');

    if (dto.role === UserRole.VIEWER && !dto.accessExpiresAt) {
      throw new BadRequestException('Viewers require accessExpiresAt');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await hash(dto.password, BCRYPT_ROUNDS),
        role: dto.role,
        status: UserStatus.ACTIVE,
        brandId,
        allowedViews: dto.allowedViews.map(String),
        accessExpiresAt: dto.accessExpiresAt ? new Date(dto.accessExpiresAt) : null,
      },
    });
    await this.audit.log('USER_CREATED', actor.email, { userId: user.id, role: dto.role }, actorId);
    const created = await this.loadUser(user.id);
    if (!created) throw new NotFoundException('User not found after create');
    return this.toAuthUser(created);
  }

  async listUsers(actorId: string, brandId?: string): Promise<AuthUser[]> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const where =
      actor.role === UserRole.SUPERADMIN
        ? brandId
          ? { brandId, status: { not: UserStatus.DELETED } }
          : { status: { not: UserStatus.DELETED } }
        : { brandId: actor.brandId!, status: { not: UserStatus.DELETED } };

    const users = await this.prisma.user.findMany({
      where,
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.toAuthUser(u));
  }

  async updateUser(actorId: string, userId: string, dto: UpdateUserDto): Promise<AuthUser> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const target = await this.loadUser(userId);
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManage(actor, target);

    if (dto.status === UserStatus.SUSPENDED && target.role === UserRole.ADMIN) {
      if (actor.role !== UserRole.SUPERADMIN) {
        throw new ForbiddenException('Only superadmin can suspend admins');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.allowedViews !== undefined ? { allowedViews: dto.allowedViews.map(String) } : {}),
        ...(dto.accessExpiresAt !== undefined
          ? { accessExpiresAt: dto.accessExpiresAt ? new Date(dto.accessExpiresAt) : null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.log('USER_UPDATED', actor.email, { userId, dto }, actorId);
    const refreshed = await this.loadUser(updated.id);
    if (!refreshed) throw new NotFoundException('User not found');
    return this.toAuthUser(refreshed);
  }

  async softDeleteUser(actorId: string, userId: string): Promise<void> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const target = await this.loadUser(userId);
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManage(actor, target);
    if (target.role === UserRole.ADMIN && actor.role !== UserRole.SUPERADMIN) {
      throw new ForbiddenException('Only superadmin can delete admins');
    }
    if (target.role === UserRole.SUPERADMIN) {
      throw new ForbiddenException('Cannot delete superadmin');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DELETED },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log('USER_DELETED', actor.email, { userId }, actorId);
  }

  // ── Extensions ──────────────────────────────────────────────────────────

  async requestExtension(
    actorId: string,
    dto: ExtensionRequestDto,
  ): Promise<AccessExtensionRequestDto> {
    const actor = await this.loadUser(actorId);
    if (!actor) throw new UnauthorizedException('User no longer exists');
    if (actor.role !== UserRole.VIEWER) {
      throw new ForbiddenException('Only viewers can request extensions');
    }
    if (!actor.brandId) throw new BadRequestException('Viewer has no brand');

    const requestedUntil = this.resolveRequestedUntil(dto);
    const row = await this.prisma.accessExtensionRequest.create({
      data: {
        viewerId: actor.id,
        brandId: actor.brandId,
        requestedUntil,
        status: ExtensionRequestStatus.PENDING,
        notes: dto.notes,
      },
    });
    await this.audit.log('EXTENSION_REQUESTED', actor.email, { id: row.id }, actorId);
    return this.toExtension(row, actor);
  }

  async listExtensions(actorId: string): Promise<AccessExtensionRequestDto[]> {
    const actor = await this.requireRole(actorId, [
      UserRole.SUPERADMIN,
      UserRole.ADMIN,
      UserRole.VIEWER,
    ]);
    const where =
      actor.role === UserRole.VIEWER
        ? { viewerId: actor.id }
        : actor.role === UserRole.ADMIN
          ? { brandId: actor.brandId! }
          : {};
    const rows = await this.prisma.accessExtensionRequest.findMany({
      where,
      include: { viewer: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) =>
      this.toExtension(r, {
        email: r.viewer.email,
        name: r.viewer.name,
      }),
    );
  }

  async reviewExtension(
    actorId: string,
    requestId: string,
    dto: ReviewExtensionDto,
  ): Promise<AccessExtensionRequestDto> {
    const actor = await this.requireRole(actorId, [UserRole.SUPERADMIN, UserRole.ADMIN]);
    const row = await this.prisma.accessExtensionRequest.findUnique({
      where: { id: requestId },
      include: { viewer: true },
    });
    if (!row) throw new NotFoundException('Extension request not found');
    if (actor.role === UserRole.ADMIN && actor.brandId !== row.brandId) {
      throw new ForbiddenException('Cannot review another brand');
    }
    if (row.status !== ExtensionRequestStatus.PENDING) {
      throw new BadRequestException('Request already reviewed');
    }

    const status =
      dto.decision === 'APPROVED' ? ExtensionRequestStatus.APPROVED : ExtensionRequestStatus.DENIED;

    if (status === ExtensionRequestStatus.APPROVED) {
      await this.prisma.user.update({
        where: { id: row.viewerId },
        data: { accessExpiresAt: row.requestedUntil, status: UserStatus.ACTIVE },
      });
    }

    const updated = await this.prisma.accessExtensionRequest.update({
      where: { id: requestId },
      data: {
        status,
        reviewerId: actor.id,
        notes: dto.notes ?? row.notes,
      },
      include: { viewer: true },
    });
    await this.audit.log('EXTENSION_REVIEWED', actor.email, { requestId, status }, actorId);
    return this.toExtension(updated, updated.viewer);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private resolveRequestedUntil(dto: ExtensionRequestDto): Date {
    if (dto.requestedUntil) return new Date(dto.requestedUntil);
    const base = new Date();
    const ms =
      (dto.days ?? 0) * 86_400_000 + (dto.hours ?? 0) * 3_600_000 + (dto.minutes ?? 0) * 60_000;
    if (ms <= 0) throw new BadRequestException('Provide requestedUntil or a positive duration');
    return new Date(base.getTime() + ms);
  }

  private assertCanManage(actor: DbUser, target: DbUser): void {
    if (actor.role === UserRole.SUPERADMIN) return;
    if (actor.role === UserRole.ADMIN) {
      if (actor.brandId !== target.brandId) throw new ForbiddenException('Cross-brand forbidden');
      if (target.role === UserRole.ADMIN || target.role === UserRole.SUPERADMIN) {
        throw new ForbiddenException('Cannot manage this user');
      }
      return;
    }
    throw new ForbiddenException('Cannot manage users');
  }

  private async requireRole(userId: string, roles: UserRole[]): Promise<DbUser> {
    const user = await this.loadUser(userId);
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }
    if (!roles.includes(user.role as UserRole) && user.role !== UserRole.SUPERADMIN) {
      if (!(user.role === UserRole.ADMIN && roles.includes(UserRole.ADMIN))) {
        // SUPERADMIN already allowed above via includes check — also allow SUPERADMIN always
      }
    }
    const role = user.role as UserRole;
    if (role !== UserRole.SUPERADMIN && !roles.includes(role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    return user;
  }

  private async loadUser(userId: string): Promise<DbUser | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id: userId },
        include: { brand: true },
      });
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new ServiceUnavailableException(
          'Database is unavailable. Start Docker Postgres and run npm run prisma:migrate.',
        );
      }
      throw error;
    }
  }

  private async findUserByEmail(email: string) {
    try {
      return await this.prisma.user.findUnique({ where: { email } });
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new ServiceUnavailableException(
          'Database is unavailable. Start Docker Postgres and run npm run prisma:migrate.',
        );
      }
      throw error;
    }
  }

  private async issueAndStoreTokens(user: DbUser): Promise<AuthTokens> {
    const issued = this.tokens.issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      brandId: user.brandId,
      allowedViews: user.allowedViews,
      status: user.status,
      accessExpiresAt: user.accessExpiresAt,
    });
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hashToken(issued.refreshToken),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
      },
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    };
  }

  private toBrand(brand: {
    id: string;
    name: string;
    domain: string;
    paperCapital: number;
    status: string;
    contactEmail: string | null;
    contactPhone: string | null;
    logoUrl: string | null;
    notes: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  }): BrandSummary {
    return {
      id: brand.id,
      name: brand.name,
      domain: brand.domain,
      paperCapital: brand.paperCapital,
      status: brand.status as BrandStatus,
      contactEmail: brand.contactEmail,
      contactPhone: brand.contactPhone,
      logoUrl: brand.logoUrl,
      notes: brand.notes,
      createdAt: brand.createdAt?.toISOString(),
      updatedAt: brand.updatedAt?.toISOString(),
    };
  }

  private toAuthUser(user: DbUser): AuthUser {
    const accessExpiresAt = user.accessExpiresAt ? user.accessExpiresAt.toISOString() : null;
    const accessExpired =
      user.role === UserRole.VIEWER &&
      Boolean(user.accessExpiresAt && user.accessExpiresAt.getTime() < Date.now());
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      brandId: user.brandId,
      allowedViews: (user.allowedViews ?? []) as AppView[],
      accessExpiresAt,
      accessExpired,
      brand: user.brand ? this.toBrand(user.brand) : null,
    };
  }

  private toExtension(
    row: {
      id: string;
      viewerId: string;
      brandId: string;
      requestedUntil: Date;
      status: string;
      notes: string | null;
      reviewerId: string | null;
      createdAt: Date;
    },
    viewer?: { email?: string; name?: string },
  ): AccessExtensionRequestDto {
    return {
      id: row.id,
      viewerId: row.viewerId,
      brandId: row.brandId,
      requestedUntil: row.requestedUntil.toISOString(),
      status: row.status as ExtensionRequestStatus,
      notes: row.notes,
      reviewerId: row.reviewerId,
      createdAt: row.createdAt.toISOString(),
      viewerEmail: viewer?.email,
      viewerName: viewer?.name,
    };
  }
}
