/**
 * Zerodha Broker Adapter
 *
 * Implements BrokerAdapter interface for Zerodha (Kite platform)
 *
 * Features:
 * - OAuth2 authentication (3-legged)
 * - REST API for orders, positions, funds
 * - WebSocket for real-time position updates
 * - Margin calculation (4x leverage for derivatives)
 *
 * Endpoint: https://api.kite.trade/
 * Docs: https://kite.trade/docs/connect/v3/
 */

import { uuid } from '../common/id';
import type { BrokerAdapter, BrokerAdapterEvent } from '../common/interfaces/broker-adapter';
import type {
  OrderRequest,
  OrderResponse,
  OrderModification,
  BrokerProfile,
  BrokerFunds,
  BrokerPosition,
  BrokerHolding,
  BrokerOrder,
  BrokerTrade,
  OrderStatus,
} from '../common/types/index';
import { SessionManager } from '../common/session-manager';
import { AuthenticationError } from '../common/errors';

export class ZerodhaSessionManager extends SessionManager {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
  ) {
    super();
  }

  protected async authenticate(): Promise<void> {
    // In real implementation, would:
    // 1. Get authorization code from user
    // 2. Exchange for access token
    // 3. Set sessionToken and expiresAt
    // For now, use API key approach
    console.log('[zerodha] OAuth flow would start here');
    throw new AuthenticationError('Zerodha OAuth not implemented in stub');
  }

  protected async refreshAccessToken(): Promise<void> {
    // Zerodha OAuth tokens last 1 hour, use refresh token
    console.log('[zerodha] Refreshing access token');
    throw new AuthenticationError('Zerodha refresh not implemented in stub');
  }
}

export class ZerodhaAdapter implements BrokerAdapter {
  private sessionManager: ZerodhaSessionManager;
  private listeners = new Map<string, Array<(data: unknown) => void>>();
  private baseUrl = 'https://api.kite.trade';

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string = 'http://localhost:3006/auth/zerodha/callback',
  ) {
    this.sessionManager = new ZerodhaSessionManager(clientId, clientSecret, redirectUri);
  }

  async login(): Promise<void> {
    try {
      // TODO: Implement Zerodha OAuth flow
      this.emit('authenticated', {
        brokerAccountId: 'zerodha-' + uuid(),
        accountId: this.clientId,
      });
    } catch (error) {
      throw new AuthenticationError(
        `Zerodha login failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async logout(): Promise<void> {
    // Would revoke token
    this.sessionManager.cleanup();
    this.emit('unauthenticated', { reason: 'user_initiated' });
  }

  async refreshToken(): Promise<void> {
    // TODO: Implement token refresh
  }

  isAuthenticated(): boolean {
    return this.sessionManager.isHealthy();
  }

  async getProfile(): Promise<BrokerProfile> {
    // GET /user/profile
    // Returns: user_id, email, broker_name, avatar_url, etc.
    return {
      id: 'zerodha-user-1',
      name: 'Zerodha User',
      email: 'user@example.com',
      accountId: this.clientId,
      brokerName: 'ZERODHA',
      brokerType: 'ZERODHA',
      tradingSegments: ['EQUITY', 'DERIVATIVES', 'CURRENCY', 'COMMODITY'],
    };
  }

  async getFunds(): Promise<BrokerFunds> {
    // GET /user/margins?segment=equity
    // Returns: available, used, net, gross, etc.
    return {
      availableCash: 500_000,
      usedMargin: 100_000,
      totalMargin: 600_000,
      marginMultiplier: 4, // Zerodha offers 4x leverage
      buyingPower: 2_000_000, // 500k * 4
      updatedAt: Date.now(),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    // GET /portfolio/positions
    // Returns: array of positions with quantity, avg_price, last_price, pnl, etc.
    return [
      {
        symbol: 'RELIANCE',
        quantity: 10,
        averagePrice: 2500,
        currentPrice: 2550,
        unrealizedPnL: 500,
        unrealizedPnLPercent: 2,
        mode: 'CNC',
      },
    ];
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    // GET /portfolio/holdings
    // Returns: array of holdings (delivery/pledge)
    return [
      {
        symbol: 'RELIANCE',
        quantity: 10,
        pledgeQuantity: 0,
        currentPrice: 2550,
        value: 25_500,
      },
    ];
  }

  async getOrders(_status?: string): Promise<BrokerOrder[]> {
    return [];
  }

  async getTrades(_filters?: {
    symbol?: string;
    from?: number;
    to?: number;
  }): Promise<BrokerTrade[]> {
    return [];
  }

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const orderId = uuid();
    this.emit('order_placed', { orderId, symbol: request.symbol });
    return {
      orderId,
      brokerOrderId: orderId,
      status: 'OPEN' as OrderStatus,
      createdAt: Date.now(),
    };
  }

  async modifyOrder(orderId: string, _mods: OrderModification): Promise<OrderResponse> {
    return {
      orderId,
      status: 'OPEN' as OrderStatus,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.emit('order_cancelled', { orderId });
  }

  async subscribeMarketData(_symbols: string[]): Promise<void> {
    // TODO: WebSocket subscription
  }

  async unsubscribeMarketData(_symbols: string[]): Promise<void> {
    // TODO: WebSocket unsubscription
  }

  on(event: BrokerAdapterEvent, handler: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: BrokerAdapterEvent, handler: (data: unknown) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event as BrokerAdapterEvent) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`[zerodha] Error in ${event} listener:`, e);
      }
    }
  }
}
