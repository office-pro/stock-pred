import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@stockpred/shared-types';
import * as jwt from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt.guard';

const SECRET = 'dev-access-secret';

function contextWithAuth(header?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: header },
        user: undefined,
      }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => class {},
  } as never;
}

function token(payload: Record<string, unknown>): string {
  return jwt.sign(payload, SECRET, { expiresIn: 60 });
}

describe('JwtAuthGuard session hardening', () => {
  const guard = new JwtAuthGuard();

  it('rejects missing bearer tokens', () => {
    expect(() => guard.canActivate(contextWithAuth(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects invalid tokens', () => {
    expect(() => guard.canActivate(contextWithAuth('Bearer not-a-jwt'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects suspended sessions', () => {
    const header = `Bearer ${token({
      sub: 'u1',
      email: 'a@b.c',
      role: UserRole.USER,
      brandId: null,
      views: [],
      status: UserStatus.SUSPENDED,
      accessExpiresAt: null,
    })}`;
    expect(() => guard.canActivate(contextWithAuth(header))).toThrow(ForbiddenException);
  });

  it('accepts an active user session', () => {
    const header = `Bearer ${token({
      sub: 'u1',
      email: 'a@b.c',
      role: UserRole.USER,
      brandId: null,
      views: ['PORTFOLIO'],
      status: UserStatus.ACTIVE,
      accessExpiresAt: null,
    })}`;
    expect(guard.canActivate(contextWithAuth(header))).toBe(true);
  });
});
