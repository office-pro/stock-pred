/** Environment access helpers - secrets must only ever come from env vars. */
export declare function getEnv(name: string, fallback?: string): string;
export declare function getEnvNumber(name: string, fallback: number): number;
export declare function getEnvBool(name: string, fallback: boolean): boolean;
/**
 * CORS_ORIGIN supports a comma-separated list so the built frontend (:8080)
 * and the Vite dev server (:5173) can both talk to the services.
 */
export declare function getCorsOrigins(fallback?: string): string[];
//# sourceMappingURL=env.d.ts.map