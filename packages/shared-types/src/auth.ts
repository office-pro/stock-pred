/** RBAC roles (invite-only accounts). */
export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  USER = 'USER',
  VIEWER = 'VIEWER',
}

/** Account lifecycle status. */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

/** Assignable application views (FE routes + matching API families). */
export enum AppView {
  DASHBOARD = 'DASHBOARD',
  SCANNER = 'SCANNER',
  SIGNALS = 'SIGNALS',
  PREDICTIONS = 'PREDICTIONS',
  PORTFOLIO = 'PORTFOLIO',
  AGENT = 'AGENT',
  BACKTEST = 'BACKTEST',
  ML_LAB = 'ML_LAB',
  BROKER_CONFIG = 'BROKER_CONFIG',
  STOCK_DETAIL = 'STOCK_DETAIL',
  /** Management UIs — granted implicitly by role, not assigned as a normal view. */
  ADMIN_USERS = 'ADMIN_USERS',
  BRAND_SETTINGS = 'BRAND_SETTINGS',
  SUPERADMIN_BRANDS = 'SUPERADMIN_BRANDS',
}

export const ALL_ASSIGNABLE_VIEWS: AppView[] = [
  AppView.DASHBOARD,
  AppView.SCANNER,
  AppView.SIGNALS,
  AppView.PREDICTIONS,
  AppView.PORTFOLIO,
  AppView.AGENT,
  AppView.BACKTEST,
  AppView.ML_LAB,
  AppView.BROKER_CONFIG,
  AppView.STOCK_DETAIL,
];

export enum BrandStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum ExtensionRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
}

export interface BrandSummary {
  id: string;
  name: string;
  domain: string;
  paperCapital: number;
  status: BrandStatus;
  contactEmail?: string | null;
  contactPhone?: string | null;
  logoUrl?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  brandId: string | null;
  allowedViews: AppView[];
  accessExpiresAt: string | null;
  /** True when VIEWER and accessExpiresAt is in the past. */
  accessExpired?: boolean;
  brand?: BrandSummary | null;
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
  brandId: string | null;
  views: AppView[];
  status: UserStatus;
  accessExpiresAt: string | null;
  iat?: number;
  exp?: number;
}

export interface AccessExtensionRequestDto {
  id: string;
  viewerId: string;
  brandId: string;
  requestedUntil: string;
  status: ExtensionRequestStatus;
  notes?: string | null;
  reviewerId?: string | null;
  createdAt: string;
  viewerEmail?: string;
  viewerName?: string;
}

/**
 * Guard helper: SUPERADMIN satisfies any requirement; ADMIN satisfies any
 * non-SUPERADMIN requirement; otherwise the role must be listed.
 */
export function roleSatisfies(actual: UserRole, required: UserRole[]): boolean {
  if (!required.length) return true;
  if (actual === UserRole.SUPERADMIN) return true;
  if (actual === UserRole.ADMIN && !required.includes(UserRole.SUPERADMIN)) return true;
  return required.includes(actual);
}

/** Whether a role may be created by the actor. */
export function canCreateRole(actor: UserRole, target: UserRole): boolean {
  if (actor === UserRole.SUPERADMIN) {
    return target === UserRole.ADMIN || target === UserRole.USER || target === UserRole.VIEWER;
  }
  if (actor === UserRole.ADMIN) {
    return target === UserRole.USER || target === UserRole.VIEWER;
  }
  return false;
}
