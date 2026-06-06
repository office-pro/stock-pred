import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { getPrismaClient } from '@stockpred/database';
import { AuthTokens, AuthUser, UserRole } from '@stockpred/shared-types';
import { AuditService } from './audit.service';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly prisma = getPrismaClient();

  constructor(
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(
    email: string,
    password: string,
    name: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    // Bootstrap convenience: the very first registered user becomes ADMIN.
    const userCount = await this.prisma.user.count();
    const role = userCount === 0 ? UserRole.ADMIN : UserRole.VIEWER;
    const user = await this.prisma.user.create({
      data: { email, name, passwordHash: await hash(password, BCRYPT_ROUNDS), role },
    });
    const tokens = await this.issueAndStoreTokens(user);
    await this.audit.log('USER_REGISTERED', email, { role }, user.id);
    return { user: this.toAuthUser(user), tokens };
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Constant-shape error: do not reveal whether the email exists.
    if (!user || !(await compare(password, user.passwordHash))) {
      await this.audit.log('LOGIN_FAILED', email);
      throw new UnauthorizedException('Invalid credentials');
    }
    const tokens = await this.issueAndStoreTokens(user);
    await this.audit.log('LOGIN_SUCCEEDED', email, undefined, user.id);
    return { user: this.toAuthUser(user), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = this.tokens.verifyRefreshToken(refreshToken);
    const tokenHash = this.tokens.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt !== null || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is revoked or expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    // Rotation: revoke the presented token, then issue a fresh pair.
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.toAuthUser(user);
  }

  private async issueAndStoreTokens(user: {
    id: string;
    email: string;
    role: string;
  }): Promise<AuthTokens> {
    const issued = this.tokens.issueTokens(user);
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

  private toAuthUser(user: { id: string; email: string; name: string; role: string }): AuthUser {
    return { id: user.id, email: user.email, name: user.name, role: user.role as UserRole };
  }
}
