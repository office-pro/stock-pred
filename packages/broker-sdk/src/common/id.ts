import { randomUUID } from 'crypto';

/** CJS-safe id helper. The `uuid` package is ESM-only on this Node version. */
export const uuid = (): string => randomUUID();
