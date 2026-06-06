import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@stockpred/shared-types';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const service = new TokenService();
  const user = { id: 'user-1', email: 'a@b.c', role: UserRole.TRADER };

  it('issues verifiable access tokens', () => {
    const issued = service.issueTokens(user);
    const payload = service.verifyAccessToken(issued.accessToken);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@b.c');
    expect(payload.role).toBe(UserRole.TRADER);
    expect(issued.expiresIn).toBeGreaterThan(0);
  });

  it('issues verifiable refresh tokens with a jti', () => {
    const issued = service.issueTokens(user);
    const payload = service.verifyRefreshToken(issued.refreshToken);
    expect(payload.sub).toBe('user-1');
    expect(payload.jti).toBeTruthy();
  });

  it('rejects tampered tokens', () => {
    const issued = service.issueTokens(user);
    expect(() => service.verifyAccessToken(`${issued.accessToken}x`)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verifyRefreshToken(issued.accessToken)).toThrow(UnauthorizedException);
  });

  it('hashes tokens deterministically', () => {
    expect(service.hashToken('abc')).toBe(service.hashToken('abc'));
    expect(service.hashToken('abc')).not.toBe(service.hashToken('abd'));
  });
});
