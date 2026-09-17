import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@stockpred/shared-types';
import { identityHeaders, RolesGuard } from './roles.guard';

function reflectorRequiring(roles: UserRole[] | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as unknown as Reflector;
}

function contextWithUser(role?: UserRole): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: role
          ? {
              sub: 'u1',
              email: 'a@b.c',
              role,
              brandId: null,
              views: [],
              status: UserStatus.ACTIVE,
              accessExpiresAt: null,
            }
          : undefined,
      }),
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
    const guard = new RolesGuard(reflectorRequiring([UserRole.USER]));
    expect(guard.canActivate(contextWithUser(UserRole.USER))).toBe(true);
  });

  it('lets ADMIN satisfy non-superadmin requirements', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.USER]));
    expect(guard.canActivate(contextWithUser(UserRole.ADMIN))).toBe(true);
  });

  it('lets SUPERADMIN satisfy any requirement', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.SUPERADMIN]));
    expect(guard.canActivate(contextWithUser(UserRole.SUPERADMIN))).toBe(true);
  });

  it('rejects a user without the required role', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.USER]));
    expect(() => guard.canActivate(contextWithUser(UserRole.VIEWER))).toThrow(ForbiddenException);
  });

  it('rejects unauthenticated requests', () => {
    const guard = new RolesGuard(reflectorRequiring([UserRole.USER]));
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(UnauthorizedException);
  });

  it('stamps s2s identity headers for execution fan-out', () => {
    const headers = identityHeaders({
      sub: 'u1',
      email: 'a@b.c',
      role: UserRole.USER,
      brandId: 'b1',
      views: [],
      status: UserStatus.ACTIVE,
      accessExpiresAt: null,
    });
    expect(headers['x-user-id']).toBe('u1');
    expect(headers['x-stockpred-service']).toBe('api-gateway');
    expect(headers['x-stockpred-service-token']).toBeTruthy();
  });
});
