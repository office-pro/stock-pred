/** RBAC roles. */
export enum UserRole {
  ADMIN = 'ADMIN',
  TRADER = 'TRADER',
  VIEWER = 'VIEWER',
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token TTL in seconds. */
  expiresIn: number;
}

/** JWT payload shape shared by all services that verify tokens. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
