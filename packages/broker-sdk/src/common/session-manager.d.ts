/**
 * SessionManager Base Class
 *
 * Handles session lifecycle for broker adapters:
 * - Token management
 * - Expiry detection and refresh
 * - Connection health monitoring
 * - Circuit breaker logic
 */
export interface SessionConfig {
    tokenExpiryBufferMs?: number;
    heartbeatIntervalMs?: number;
    maxReconnectAttempts?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
}
export declare abstract class SessionManager {
    protected sessionToken?: string;
    protected refreshToken?: string;
    protected expiresAt: number;
    protected reconnectAttempts: number;
    protected circuitBreakerOpen: boolean;
    protected heartbeatHandle?: ReturnType<typeof setInterval>;
    protected config: Required<SessionConfig>;
    constructor(config?: SessionConfig);
    /**
     * Authenticate with broker (broker-specific implementation)
     * Must set sessionToken and expiresAt
     */
    protected abstract authenticate(): Promise<void>;
    /**
     * Refresh access token (broker-specific implementation)
     * Must update sessionToken and expiresAt
     */
    protected abstract refreshAccessToken(): Promise<void>;
    /**
     * Check if token is expired
     */
    protected isTokenExpired(): boolean;
    /**
     * Ensure session is active (authenticate if needed, refresh if expired)
     * Called before every broker API call
     */
    ensureActive(): Promise<void>;
    /**
     * Reconnect with exponential backoff
     */
    reconnect(): Promise<void>;
    /**
     * Start background heartbeat (optional)
     * Periodically ensures session is active
     */
    startHeartbeat(): Promise<void>;
    /**
     * Stop background heartbeat
     */
    stopHeartbeat(): void;
    /**
     * Check if session is healthy
     */
    isHealthy(): boolean;
    /**
     * Reset circuit breaker (admin operation)
     */
    resetCircuitBreaker(): void;
    /**
     * Helper: sleep for N milliseconds
     */
    protected sleep(ms: number): Promise<void>;
    /**
     * Cleanup on logout
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=session-manager.d.ts.map