import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from '@stockpred/shared-types';
import { getEnv } from '@stockpred/shared-utils';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/** Verifies the access token issued by the auth-service (shared HS256 secret). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret = getEnv('JWT_ACCESS_SECRET', 'dev-access-secret');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      request.user = jwt.verify(header.slice('Bearer '.length), this.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return true;
  }
}
