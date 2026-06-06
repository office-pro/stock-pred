/**
 * BrokerFactory
 *
 * Static factory for creating BrokerAdapter instances.
 * Selects appropriate adapter based on BROKER_TYPE environment variable or parameter.
 *
 * Phase 1: PaperTradingAdapter ✅
 * Phases 3-5: Real broker adapters ✅
 */

import type { BrokerAdapter } from './interfaces/broker-adapter';
import { PaperTradingAdapter } from '../paper/paper-trading-adapter';
import { ZerodhaAdapter } from '../zerodha/zerodha-adapter';
import { AngelOneAdapter } from '../angelone/angelone-adapter';
import { UpstoxAdapter } from '../upstox/upstox-adapter';

export class BrokerFactory {
  /**
   * Create a broker adapter instance
   * @param brokerType Broker type: 'PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS'
   * @param config Broker-specific configuration (API keys, OAuth params, etc.)
   * @returns BrokerAdapter instance
   * @throws Error if broker type is not supported
   */
  static create(
    brokerType?: string,
    config?: {
      clientId?: string;
      clientSecret?: string;
      apiKey?: string;
      redirectUri?: string;
    },
  ): BrokerAdapter {
    const type = (brokerType || process.env.BROKER_TYPE || 'PAPER').toUpperCase();

    switch (type) {
      case 'PAPER':
        return new PaperTradingAdapter();

      case 'ZERODHA':
        return new ZerodhaAdapter(
          config?.clientId || process.env.ZERODHA_CLIENT_ID || 'zerodha-demo',
          config?.clientSecret || process.env.ZERODHA_CLIENT_SECRET || 'zerodha-secret',
          config?.redirectUri || process.env.ZERODHA_REDIRECT_URI || 'http://localhost:3006/auth/zerodha',
        );

      case 'ANGELONE':
        return new AngelOneAdapter(config?.apiKey || process.env.ANGELONE_API_KEY || 'angelone-demo');

      case 'UPSTOX':
        return new UpstoxAdapter(config?.apiKey || process.env.UPSTOX_API_KEY || 'upstox-demo');

      case 'SHOONYA':
        // Shoonya adapter stub (to be implemented)
        throw new Error('Shoonya adapter coming in Phase 5');

      case 'FYERS':
        // Fyers adapter stub (to be implemented)
        throw new Error('Fyers adapter coming in Phase 5');

      default:
        throw new Error(
          `Broker type '${type}' is not supported. ` +
          `Available: PAPER, ZERODHA, ANGELONE, UPSTOX. ` +
          `Coming: SHOONYA, FYERS.`,
        );
    }
  }

  /**
   * List supported broker types
   */
  static getSupportedBrokers(): string[] {
    return ['PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX'];
  }

  /**
   * List partially implemented brokers (stubs)
   */
  static getStubBrokers(): string[] {
    return ['SHOONYA', 'FYERS'];
  }

  /**
   * Check if a broker type is supported or partially implemented
   */
  static isSupported(brokerType: string): boolean {
    const broker = brokerType.toUpperCase();
    return (
      this.getSupportedBrokers().includes(broker) ||
      this.getStubBrokers().includes(broker)
    );
  }
}
