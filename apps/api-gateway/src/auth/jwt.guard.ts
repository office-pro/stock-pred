import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from '@stockpred/shared-types';
import { getEnv, sessionDenialReason } from '@stockpred/shared-utils';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

function readBearer(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function attachVerifiedUser(request: AuthenticatedRequest, verified: JwtPayload): void {
  request.user = {
    ...verified,
    brandId: verified.brandId ?? null,
    views: verified.views ?? [],
    status: verified.status ?? ('ACTIVE' as JwtPayload['status']),
    accessExpiresAt: verified.accessExpiresAt ?? null,
  };
}

function enforceSession(user: JwtPayload): void {
  const denial = sessionDenialReason(user);
  if (!denial) return;
  if (denial === 'UNAUTHORIZED_IDENTITY') {
    throw new UnauthorizedException('Invalid session identity');
  }
  if (denial === 'SESSION_EXPIRED') {
    throw new ForbiddenException({
      code: 'VIEWER_EXPIRED',
      message: 'Viewer demo window has expired',
    });
  }
  throw new ForbiddenException({ code: denial, message: 'Session is not allowed to continue' });
}

/** Verifies the access token issued by the auth-service (shared HS256 secret). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret = getEnv('JWT_ACCESS_SECRET', 'dev-access-secret');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const verified = jwt.verify(token, this.secret) as JwtPayload;
      attachVerifiedUser(request, verified);
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException)
        throw error;
      throw new UnauthorizedException('Invalid or expired access token');
    }
    enforceSession(request.user!);
    return true;
  }
}

/**
 * Attaches a user when the access token is valid. Expired or missing tokens
 * do not fail the request — paper trading stays usable for the full access-token lifetime.
 * Execution routes must use JwtAuthGuard, not this guard.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  private readonly secret = getEnv('JWT_ACCESS_SECRET', 'dev-access-secret');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearer(request.headers.authorization);
    if (!token) {
      return true;
    }
    try {
      const verified = jwt.verify(token, this.secret) as JwtPayload;
      attachVerifiedUser(request, verified);
      if (sessionDenialReason(request.user)) {
        request.user = undefined;
      }
    } catch {
      /* ignore expired/invalid token for paper routes */
    }
    return true;
  }
}
