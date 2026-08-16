import { createHash, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthTokens, JwtPayload, UserRole } from '@stockpred/shared-types';
import { getEnv, getEnvNumber } from '@stockpred/shared-utils';

export interface RefreshPayload {
  sub: string;
  jti: string;
}

/** Issues and verifies access/refresh JWTs. Secrets come from env only. */
@Injectable()
export class TokenService {
  private readonly accessSecret = getEnv('JWT_ACCESS_SECRET', 'dev-access-secret');
  private readonly refreshSecret = getEnv('JWT_REFRESH_SECRET', 'dev-refresh-secret');
  private readonly accessTtl = getEnvNumber('JWT_ACCESS_TTL_SECONDS', 604800);
  private readonly refreshTtl = getEnvNumber('JWT_REFRESH_TTL_SECONDS', 604800);

  issueTokens(user: { id: string; email: string; role: string }): AuthTokens & { jti: string } {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
    };
    const jti = randomUUID();
    const accessToken = jwt.sign(payload, this.accessSecret, { expiresIn: this.accessTtl });
    const refreshToken = jwt.sign({ sub: user.id, jti }, this.refreshSecret, {
      expiresIn: this.refreshTtl,
    });
    return { accessToken, refreshToken, expiresIn: this.accessTtl, jti };
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.accessSecret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  verifyRefreshToken(token: string): RefreshPayload {
    try {
      return jwt.verify(token, this.refreshSecret) as RefreshPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  get refreshTtlSeconds(): number {
    return this.refreshTtl;
  }
}
