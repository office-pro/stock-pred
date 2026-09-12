import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppView, roleSatisfies, UserRole, UserStatus } from '@stockpred/shared-types';
import type { AuthenticatedRequest } from './jwt.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export const VIEWS_KEY = 'views';
export const Views = (...views: AppView[]): MethodDecorator & ClassDecorator =>
  SetMetadata(VIEWS_KEY, views);

/** RBAC: SUPERADMIN satisfies all; ADMIN satisfies non-SUPERADMIN requirements. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role) throw new UnauthorizedException('Missing authenticated user');
    if (request.user?.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }
    if (roleSatisfies(role, required)) return true;
    throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
  }
}

/** View ACL: SUPERADMIN/ADMIN bypass; otherwise JWT views must include one required view. */
@Injectable()
export class ViewsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppView[] | undefined>(VIEWS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Missing authenticated user');
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }
    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.ADMIN) return true;

    if (
      user.role === UserRole.VIEWER &&
      user.accessExpiresAt &&
      new Date(user.accessExpiresAt).getTime() < Date.now()
    ) {
      throw new ForbiddenException({
        code: 'VIEWER_EXPIRED',
        message: 'Viewer demo window has expired',
      });
    }

    const views = user.views ?? [];
    if (required.some((v) => views.includes(v))) return true;
    throw new ForbiddenException(`Requires view: ${required.join(' or ')}`);
  }
}

/** Build downstream identity headers from the JWT. */
export function identityHeaders(user?: AuthenticatedRequest['user']): Record<string, string> {
  if (!user) return {};
  const headers: Record<string, string> = {
    'x-user-id': user.sub,
    'x-user-role': user.role,
  };
  if (user.brandId) headers['x-brand-id'] = user.brandId;
  return headers;
}
