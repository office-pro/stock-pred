/**
 * SessionManager Base Class
 *
 * Handles session lifecycle for broker adapters:
 * - Token management
 * - Expiry detection and refresh
 * - Connection health monitoring
 * - Circuit breaker logic
 */

import { AuthenticationError, CircuitBreakerOpenError } from './errors';

export interface SessionConfig {
  tokenExpiryBufferMs?: number; // Refresh token N ms before expiry (default: 60s)
  heartbeatIntervalMs?: number; // Check token health every N ms (default: 30s)
  maxReconnectAttempts?: number; // Max reconnection attempts (default: 10)
  initialBackoffMs?: number; // Initial backoff delay (default: 1s)
  maxBackoffMs?: number; // Max backoff delay (default: 30s)
}

export abstract class SessionManager {
  protected sessionToken?: string;
  protected refreshToken?: string;
  protected expiresAt: number = 0;
  protected reconnectAttempts: number = 0;
  protected circuitBreakerOpen: boolean = false;
  protected heartbeatHandle?: ReturnType<typeof setInterval>;

  protected config: Required<SessionConfig> = {
    tokenExpiryBufferMs: 60_000, // 1 minute
    heartbeatIntervalMs: 30_000, // 30 seconds
    maxReconnectAttempts: 10,
    initialBackoffMs: 1_000,
    maxBackoffMs: 30_000,
  };

  constructor(config?: SessionConfig) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

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
  protected isTokenExpired(): boolean {
    const buffer = this.config.tokenExpiryBufferMs;
    return Date.now() + buffer >= this.expiresAt;
  }

  /**
   * Ensure session is active (authenticate if needed, refresh if expired)
   * Called before every broker API call
   */
  async ensureActive(): Promise<void> {
    if (this.circuitBreakerOpen) {
      throw new CircuitBreakerOpenError('Circuit breaker is open, cannot make requests');
    }

    if (!this.sessionToken) {
      // Not authenticated yet
      await this.authenticate();
      this.reconnectAttempts = 0;
      return;
    }

    if (this.isTokenExpired()) {
      // Token expired, refresh it
      try {
        await this.refreshAccessToken();
        this.reconnectAttempts = 0;
      } catch (e) {
        // Refresh failed, try full reauthentication
        await this.reconnect();
      }
    }
  }

  /**
   * Reconnect with exponential backoff
   */
  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.circuitBreakerOpen = true;
      throw new CircuitBreakerOpenError(
        `Max reconnection attempts (${this.config.maxReconnectAttempts}) exceeded`,
      );
    }

    const backoffMs = Math.min(
      this.config.initialBackoffMs * Math.pow(2, this.reconnectAttempts),
      this.config.maxBackoffMs,
    );

    this.reconnectAttempts++;

    try {
      await this.sleep(backoffMs);
      await this.authenticate();
      this.circuitBreakerOpen = false;
      this.reconnectAttempts = 0;
    } catch (e) {
      throw new AuthenticationError(
        `Reconnection failed (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Start background heartbeat (optional)
   * Periodically ensures session is active
   */
  async startHeartbeat(): Promise<void> {
    this.heartbeatHandle = setInterval(async () => {
      try {
        await this.ensureActive();
      } catch (e) {
        console.error('[SessionManager] Heartbeat failed:', e instanceof Error ? e.message : String(e));
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Stop background heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
  }

  /**
   * Check if session is healthy
   */
  isHealthy(): boolean {
    return !this.circuitBreakerOpen && this.sessionToken !== undefined && !this.isTokenExpired();
  }

  /**
   * Reset circuit breaker (admin operation)
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerOpen = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Helper: sleep for N milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup on logout
   */
  async cleanup(): Promise<void> {
    this.stopHeartbeat();
    this.sessionToken = undefined;
    this.refreshToken = undefined;
    this.expiresAt = 0;
    this.circuitBreakerOpen = false;
    this.reconnectAttempts = 0;
  }
}
