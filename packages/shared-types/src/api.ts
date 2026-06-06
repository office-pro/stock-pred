/**
 * Compliance: every analytics payload carries this disclaimer.
 * Predictions are probabilistic. No guarantee of profits.
 */
export const DISCLAIMER = 'This is not investment advice.';

export interface ApiMeta {
  disclaimer: string;
  timestamp: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export function withDisclaimer<T>(data: T): ApiResponse<T> {
  return {
    data,
    meta: { disclaimer: DISCLAIMER, timestamp: Date.now() },
  };
}
