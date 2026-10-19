/**
 * Single-flight + failure cooldown for ML engine refresh paths.
 * Cooldown is independent of any periodic timer (e.g. 60s).
 */

export const ML_ENGINE_REQUEST_TIMEOUT_MS = 30_000;
export const ML_ENGINE_FAILURE_COOLDOWN_MS = 120_000;

export type RefreshSkipReason = 'IN_FLIGHT' | 'COOLDOWN';

export type RefreshGateResult =
  | { ok: true }
  | { ok: false; reason: RefreshSkipReason; remainingMs: number };

export class EngineRefreshGuard {
  private inFlight = false;
  private cooldownUntilMs = 0;

  constructor(private readonly cooldownMs: number = ML_ENGINE_FAILURE_COOLDOWN_MS) {}

  tryBegin(nowMs: number = Date.now()): RefreshGateResult {
    if (this.inFlight) {
      return { ok: false, reason: 'IN_FLIGHT', remainingMs: 0 };
    }
    const remainingMs = Math.max(0, this.cooldownUntilMs - nowMs);
    if (remainingMs > 0) {
      return { ok: false, reason: 'COOLDOWN', remainingMs };
    }
    this.inFlight = true;
    return { ok: true };
  }

  /** Record engine failure cooldown; keeps in-flight until {@link end}. */
  markFailure(nowMs: number = Date.now()): { cooldownUntilMs: number } {
    this.cooldownUntilMs = nowMs + this.cooldownMs;
    return { cooldownUntilMs: this.cooldownUntilMs };
  }

  /** Always clear in-flight after the full refresh attempt (engine + fallback). */
  end(): void {
    this.inFlight = false;
  }

  isInFlight(): boolean {
    return this.inFlight;
  }

  cooldownRemainingMs(nowMs: number = Date.now()): number {
    return Math.max(0, this.cooldownUntilMs - nowMs);
  }
}

export function classifyEngineFailureType(error: unknown): 'TIMEOUT' | 'ERROR' {
  const msg = String((error as Error)?.message ?? error ?? '');
  return /timeout|aborted|ETIMEDOUT|ECONNABORTED/i.test(msg) ? 'TIMEOUT' : 'ERROR';
}
