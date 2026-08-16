/**
 * Upstox Broker Adapter - Skeleton
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
} from '../common/types/index';

export class UpstoxAdapter implements BrokerAdapter {
  private listeners = new Map<string, Array<(data: unknown) => void>>();
  private authenticated = false;

  constructor(private apiKey: string) {}

  async login(): Promise<void> {
    this.authenticated = true;
    this.emit('authenticated', { brokerAccountId: uuid(), accountId: 'upstox-user' });
  }

  async logout(): Promise<void> {
    this.authenticated = false;
    this.emit('unauthenticated', { reason: 'user_initiated' });
  }

  async refreshToken(): Promise<void> {}
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  async getProfile(): Promise<BrokerProfile> {
    return {
      id: uuid(),
      name: 'Upstox User',
      email: 'user@upstox.com',
      accountId: 'upstox',
      brokerName: 'UPSTOX',
      brokerType: 'UPSTOX',
      tradingSegments: ['EQUITY', 'DERIVATIVES'],
    };
  }

  async getFunds(): Promise<BrokerFunds> {
    return {
      availableCash: 500_000,
      usedMargin: 100_000,
      totalMargin: 600_000,
      marginMultiplier: 3,
      buyingPower: 1_500_000,
      updatedAt: Date.now(),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    return [];
  }

  async getOrders(): Promise<BrokerOrder[]> {
    return [];
  }

  async getTrades(): Promise<BrokerTrade[]> {
    return [];
  }

  async placeOrder(_req: OrderRequest): Promise<OrderResponse> {
    return { orderId: uuid(), status: 'OPEN', createdAt: Date.now() };
  }

  async modifyOrder(id: string, _mods: OrderModification): Promise<OrderResponse> {
    return { orderId: id, status: 'OPEN' };
  }

  async cancelOrder(id: string): Promise<void> {
    this.emit('order_cancelled', { orderId: id });
  }

  async subscribeMarketData(_symbols: string[]): Promise<void> {}
  async unsubscribeMarketData(_symbols: string[]): Promise<void> {}

  on(event: BrokerAdapterEvent, handler: (data: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  off(event: BrokerAdapterEvent, handler: (data: unknown) => void): void {
    const h = this.listeners.get(event);
    if (h) {
      const idx = h.indexOf(handler);
      if (idx >= 0) h.splice(idx, 1);
    }
  }

  private emit(e: string, d: unknown): void {
    const h = this.listeners.get(e as BrokerAdapterEvent) || [];
    h.forEach((f) => {
      try {
        f(d);
      } catch (ex) {
        console.error(`[upstox] error:`, ex);
      }
    });
  }
}
