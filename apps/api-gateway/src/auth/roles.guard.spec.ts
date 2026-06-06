import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@stockpred/shared-types';
import { RolesGuard } from './roles.guard';

function reflectorRequiring(roles: UserRole[] | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as unknown as Reflector;
}

function contextWithUser(role?: UserRole): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { sub: 'u1', email: 'a@b.c', role } : undefined }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard (RBAC)', () => {
  it('allows requests when no roles are required', () => {
    const guard = new RolesGuard(reflectorRequiring(undefined));
    expect(guard.canActivate(contextWithUser())).toBe(true);
  });

  it('allows a user holding the required role', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.TRADER]));
    expect(guard.canActivate(contextWithUser(UserRole.TRADER))).toBe(true);
  });

  it('lets ADMIN satisfy any requirement', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.TRADER]));
    expect(guard.canActivate(contextWithUser(UserRole.ADMIN))).toBe(true);
  });

  it('rejects a user without the required role', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.TRADER]));
    expect(() => guard.canActivate(contextWithUser(UserRole.VIEWER))).toThrow(ForbiddenException);
  });

  it('rejects unauthenticated requests', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.TRADER]));
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(ForbiddenException);
  });
});
