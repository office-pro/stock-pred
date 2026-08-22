import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleSatisfies, UserRole, UserStatus } from '@stockpred/shared-types';
import type { AuthenticatedRequest } from './jwt.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

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
