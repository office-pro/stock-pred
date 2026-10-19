/** ARTURO feature-flag release modes. */
export enum ArturoReleaseMode {
  GENERAL_AVAILABILITY = 'GENERAL_AVAILABILITY',
  CODE_BETA = 'CODE_BETA',
  OFF = 'OFF',
}

export interface ArturoAccountRules {
  includes: string[];
  excludes: string[];
  raw: string;
}

export interface ArturoFlagRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  releaseMode: ArturoReleaseMode;
  accountRulesRaw: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
  updatedByName?: string | null;
}

export interface ArturoFlagAuditRecord {
  id: string;
  flagId: string;
  actorUserId: string | null;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
}

export interface ArturoFlagListResponse {
  items: ArturoFlagRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ArturoEvaluateRequest {
  keys: string[];
}

export interface ArturoEvaluateResult {
  key: string;
  enabled: boolean;
  releaseMode: ArturoReleaseMode;
  accountId: string;
}

export interface ArturoEvaluateResponse {
  results: ArturoEvaluateResult[];
}

export interface ArturoStatusResponse {
  enabled: boolean;
  environment: string;
}

/** Synthetic account id used when SUPERADMIN has no brand. */
export const ARTURO_SUPERADMIN_ACCOUNT = '__superadmin__';
