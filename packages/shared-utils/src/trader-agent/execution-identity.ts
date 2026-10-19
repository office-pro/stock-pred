/**
 * F2 execution identity — session / s2s / RBAC / audit.
 * Sits in front of Decision → Risk → Portfolio → Policy → Gate → Execution.
 * Ranking, Intelligence, ML, UI, and batch cannot authorize.
 */
import { timingSafeEqual } from 'crypto';
import { AppView, UserRole, UserStatus, type JwtPayload } from '@stockpred/shared-types';
import { getEnv } from '../env';
import {
  runBaselineAuthorizationChain,
  type AuthorizationChainInput,
  type AuthorizationChainResult,
} from './authorization-test-harness';

export const EXECUTION_SERVICE_HEADER = 'x-stockpred-service';
export const EXECUTION_SERVICE_TOKEN_HEADER = 'x-stockpred-service-token';

export const ALLOWED_EXECUTION_SERVICES = ['api-gateway', 'trader-agent'] as const;
export type AllowedExecutionService = (typeof ALLOWED_EXECUTION_SERVICES)[number];

export type ExecutionCaller =
  | AllowedExecutionService
  | 'ranking'
  | 'intelligence'
  | 'ml'
  | 'ui'
  | 'batch'
  | 'unknown';

export type ExecutionAuthOutcome = 'AUTHORIZED' | 'REJECTED';

export interface ExecutionIdentityInput {
  caller?: ExecutionCaller | string | null;
  serviceToken?: string | null;
  expectedServiceToken?: string;
  userId?: string | null;
  role?: string | null;
  status?: string | null;
  views?: readonly string[] | null;
  accessExpiresAt?: string | null;
  now?: number;
}

export interface ExecutionAuthAudit {
  event: 'EXECUTION_IDENTITY';
  outcome: ExecutionAuthOutcome;
  caller: string;
  userId?: string;
  reasonCodes: string[];
  at: number;
}

export interface ExecutionIdentityVerdict {
  outcome: ExecutionAuthOutcome;
  reasonCodes: string[];
  audit: ExecutionAuthAudit;
}

const FORBIDDEN_CALLERS: ReadonlySet<string> = new Set([
  'ranking',
  'intelligence',
  'ml',
  'ui',
  'batch',
  'unknown',
]);

const EXECUTION_ROLES: ReadonlySet<string> = new Set([
  UserRole.USER,
  UserRole.ADMIN,
  UserRole.SUPERADMIN,
]);

const EXECUTION_VIEWS: ReadonlySet<string> = new Set([AppView.PORTFOLIO, AppView.AGENT]);

const executionAuditLog: ExecutionAuthAudit[] = [];

export function defaultInternalServiceToken(): string {
  return getEnv('INTERNAL_SERVICE_TOKEN', 'dev-internal-service-token');
}

export function tokensMatch(actual: string | null | undefined, expected: string): boolean {
  if (actual == null || actual === '') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function outboundServiceIdentityHeaders(
  service: AllowedExecutionService,
  token = defaultInternalServiceToken(),
): Record<string, string> {
  return {
    [EXECUTION_SERVICE_HEADER]: service,
    [EXECUTION_SERVICE_TOKEN_HEADER]: token,
  };
}

export function mergeExecutionIdentityHeaders(
  service: AllowedExecutionService,
  user?: Partial<
    Pick<JwtPayload, 'sub' | 'role' | 'brandId' | 'views' | 'status' | 'accessExpiresAt'>
  > | null,
  token = defaultInternalServiceToken(),
): Record<string, string> {
  return {
    ...outboundServiceIdentityHeaders(service, token),
    ...userIdentityHeaders(user),
  };
}

export function userIdentityHeaders(
  user?: Partial<
    Pick<JwtPayload, 'sub' | 'role' | 'brandId' | 'views' | 'status' | 'accessExpiresAt'>
  > | null,
): Record<string, string> {
  if (!user?.sub || !user.role) return {};
  const headers: Record<string, string> = {
    'x-user-id': user.sub,
    'x-user-role': user.role,
  };
  if (user.brandId) headers['x-brand-id'] = user.brandId;
  if (user.status) headers['x-user-status'] = user.status;
  if (user.views?.length) headers['x-user-views'] = user.views.join(',');
  if (user.accessExpiresAt) headers['x-user-access-expires-at'] = user.accessExpiresAt;
  return headers;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return value == null ? undefined : String(value);
}

export function evaluateInboundExecuteHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
  expectedServiceToken = defaultInternalServiceToken(),
): ExecutionIdentityVerdict {
  return evaluateExecutionIdentity({
    caller: parseInboundCaller(headerValue(headers, EXECUTION_SERVICE_HEADER)),
    serviceToken: headerValue(headers, EXECUTION_SERVICE_TOKEN_HEADER),
    expectedServiceToken,
    userId: headerValue(headers, 'x-user-id'),
    role: headerValue(headers, 'x-user-role'),
    views: headerValue(headers, 'x-user-views')?.split(',').filter(Boolean) ?? null,
    status: headerValue(headers, 'x-user-status'),
    accessExpiresAt: headerValue(headers, 'x-user-access-expires-at'),
  });
}

export function parseInboundCaller(raw: string | string[] | undefined | null): ExecutionCaller {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const caller = String(value ?? '')
    .trim()
    .toLowerCase();
  if ((ALLOWED_EXECUTION_SERVICES as readonly string[]).includes(caller)) {
    return caller as AllowedExecutionService;
  }
  if (FORBIDDEN_CALLERS.has(caller)) return caller as ExecutionCaller;
  return 'unknown';
}

export function sessionDenialReason(
  user: Partial<JwtPayload> | undefined | null,
  now = Date.now(),
): string | null {
  if (!user?.sub || !user.role) return 'UNAUTHORIZED_IDENTITY';
  if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
    return 'SESSION_INVALID';
  }
  if (
    user.role === UserRole.VIEWER &&
    user.accessExpiresAt &&
    Number.isFinite(Date.parse(user.accessExpiresAt)) &&
    Date.parse(user.accessExpiresAt) < now
  ) {
    return 'SESSION_EXPIRED';
  }
  return null;
}

function pushUnique(codes: string[], code: string): void {
  if (!codes.includes(code)) codes.push(code);
}

export function evaluateExecutionIdentity(input: ExecutionIdentityInput): ExecutionIdentityVerdict {
  const now = input.now ?? Date.now();
  const caller = parseInboundCaller(input.caller);
  const reasonCodes: string[] = [];
  const expected = input.expectedServiceToken ?? defaultInternalServiceToken();

  if (
    FORBIDDEN_CALLERS.has(caller) ||
    !(ALLOWED_EXECUTION_SERVICES as readonly string[]).includes(caller)
  ) {
    pushUnique(
      reasonCodes,
      caller === 'unknown' ? 'INVALID_SERVICE_IDENTITY' : 'EXECUTION_SOURCE_FORBIDDEN',
    );
  }
  if (!tokensMatch(input.serviceToken, expected)) {
    pushUnique(reasonCodes, 'INVALID_SERVICE_IDENTITY');
  }

  const userId = String(input.userId ?? '').trim();
  const role = String(input.role ?? '').trim();
  if (!userId || !role) pushUnique(reasonCodes, 'UNAUTHORIZED_IDENTITY');

  const session = sessionDenialReason(
    {
      sub: userId || undefined,
      role: role as UserRole,
      status: (input.status as UserStatus | undefined) ?? UserStatus.ACTIVE,
      accessExpiresAt: input.accessExpiresAt ?? null,
    },
    now,
  );
  if (session) pushUnique(reasonCodes, session);

  if (role && !EXECUTION_ROLES.has(role)) {
    pushUnique(reasonCodes, role === UserRole.VIEWER ? 'UI_ONLY_PERMISSION' : 'INSUFFICIENT_ROLE');
  }

  const views = input.views ?? [];
  if (role === UserRole.USER && !views.some((view) => EXECUTION_VIEWS.has(view))) {
    pushUnique(reasonCodes, 'INSUFFICIENT_VIEW');
  }

  const outcome: ExecutionAuthOutcome = reasonCodes.length ? 'REJECTED' : 'AUTHORIZED';
  const audit: ExecutionAuthAudit = {
    event: 'EXECUTION_IDENTITY',
    outcome,
    caller,
    userId: userId || undefined,
    reasonCodes: [...reasonCodes],
    at: now,
  };
  return { outcome, reasonCodes, audit };
}

export function recordExecutionAuthAudit(audit: ExecutionAuthAudit): ExecutionAuthAudit {
  executionAuditLog.push(audit);
  return audit;
}

export function readExecutionAuthAudit(): readonly ExecutionAuthAudit[] {
  return executionAuditLog;
}

export function clearExecutionAuthAudit(): void {
  executionAuditLog.length = 0;
}

export function executionHttpStatus(reasonCodes: readonly string[]): 401 | 403 {
  const unauthorized = new Set([
    'UNAUTHORIZED_IDENTITY',
    'INVALID_SERVICE_IDENTITY',
    'MISSING_SERVICE_IDENTITY',
  ]);
  if (reasonCodes.some((code) => unauthorized.has(code))) return 401;
  return 403;
}

export interface AttemptAuthorizedExecutionInput extends ExecutionIdentityInput {
  analysis?: AuthorizationChainInput['analysis'];
  includeGate?: boolean;
  livePrice?: number | null;
  operatingMode?: AuthorizationChainInput['operatingMode'];
  decisionMode?: AuthorizationChainInput['decisionMode'];
}

export interface AttemptAuthorizedExecutionResult {
  outcome: ExecutionAuthOutcome;
  reasonCodes: string[];
  audit: ExecutionAuthAudit;
  chain?: AuthorizationChainResult;
}

/**
 * End-to-end execution attempt: identity first, then the unchanged trading chain.
 * Unauthorized identity never reaches Decision / Risk / Gate / Execution.
 */
export function attemptAuthorizedExecution(
  input: AttemptAuthorizedExecutionInput,
): AttemptAuthorizedExecutionResult {
  const identity = evaluateExecutionIdentity(input);
  const audit = recordExecutionAuthAudit(identity.audit);
  if (identity.outcome === 'REJECTED' || !input.analysis) {
    return {
      outcome: identity.outcome,
      reasonCodes: identity.reasonCodes,
      audit,
    };
  }
  const chain = runBaselineAuthorizationChain({
    analysis: input.analysis,
    includeGate: input.includeGate,
    livePrice: input.livePrice,
    operatingMode: input.operatingMode,
    decisionMode: input.decisionMode,
  });
  return {
    outcome: 'AUTHORIZED',
    reasonCodes: [],
    audit,
    chain,
  };
}
