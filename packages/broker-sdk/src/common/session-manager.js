'use strict';
/**
 * SessionManager Base Class
 *
 * Handles session lifecycle for broker adapters:
 * - Token management
 * - Expiry detection and refresh
 * - Connection health monitoring
 * - Circuit breaker logic
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.SessionManager = void 0;
const errors_1 = require('./errors');
class SessionManager {
  sessionToken;
  refreshToken;
  expiresAt = 0;
  reconnectAttempts = 0;
  circuitBreakerOpen = false;
  heartbeatHandle;
  config = {
    tokenExpiryBufferMs: 60_000, // 1 minute
    heartbeatIntervalMs: 30_000, // 30 seconds
    maxReconnectAttempts: 10,
    initialBackoffMs: 1_000,
    maxBackoffMs: 30_000,
  };
  constructor(config) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }
  /**
   * Check if token is expired
   */
  isTokenExpired() {
    const buffer = this.config.tokenExpiryBufferMs;
    return Date.now() + buffer >= this.expiresAt;
  }
  /**
   * Ensure session is active (authenticate if needed, refresh if expired)
   * Called before every broker API call
   */
  async ensureActive() {
    if (this.circuitBreakerOpen) {
      throw new errors_1.CircuitBreakerOpenError('Circuit breaker is open, cannot make requests');
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
  async reconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.circuitBreakerOpen = true;
      throw new errors_1.CircuitBreakerOpenError(
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
      throw new errors_1.AuthenticationError(
        `Reconnection failed (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  /**
   * Start background heartbeat (optional)
   * Periodically ensures session is active
   */
  async startHeartbeat() {
    this.heartbeatHandle = setInterval(async () => {
      try {
        await this.ensureActive();
      } catch (e) {
        console.error(
          '[SessionManager] Heartbeat failed:',
          e instanceof Error ? e.message : String(e),
        );
      }
    }, this.config.heartbeatIntervalMs);
  }
  /**
   * Stop background heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
  }
  /**
   * Check if session is healthy
   */
  isHealthy() {
    return !this.circuitBreakerOpen && this.sessionToken !== undefined && !this.isTokenExpired();
  }
  /**
   * Reset circuit breaker (admin operation)
   */
  resetCircuitBreaker() {
    this.circuitBreakerOpen = false;
    this.reconnectAttempts = 0;
  }
  /**
   * Helper: sleep for N milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Cleanup on logout
   */
  async cleanup() {
    this.stopHeartbeat();
    this.sessionToken = undefined;
    this.refreshToken = undefined;
    this.expiresAt = 0;
    this.circuitBreakerOpen = false;
    this.reconnectAttempts = 0;
  }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=session-manager.js.map
