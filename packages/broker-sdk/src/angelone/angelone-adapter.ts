/**
 * AngelOne Broker Adapter - Skeleton
 *
 * Real implementation will include:
 * - API key authentication
 * - REST API integration
 * - WebSocket for real-time data
 * - Margin calculation (Angelone-specific)
 */

import { v4 as uuid } from 'uuid';
import type { BrokerAdapter, BrokerAdapterEvent } from '../common/interfaces/broker-adapter';
import type { OrderRequest, OrderResponse, OrderModification, BrokerProfile, BrokerFunds, BrokerPosition, BrokerHolding, BrokerOrder, BrokerTrade } from '../common/types/index';

export class AngelOneAdapter implements BrokerAdapter {
  private listeners = new Map<string, Function[]>();
  private authenticated = false;

  constructor(private apiKey: string) {}

  async login(): Promise<void> {
    // TODO: Implement AngelOne OAuth/API key auth
    this.authenticated = true;
    this.emit('authenticated', { brokerAccountId: uuid(), accountId: 'angelone-user' });
  }

  async logout(): Promise<void> {
    this.authenticated = false;
    this.emit('unauthenticated', { reason: 'user_initiated' });
  }

  async refreshToken(): Promise<void> {
    // TODO: Implement token refresh
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  async getProfile(): Promise<BrokerProfile> {
    return {
      id: uuid(),
      name: 'AngelOne User',
      email: 'user@angelone.com',
      accountId: 'angelone-account',
      brokerName: 'ANGELONE',
      brokerType: 'ANGELONE',
      tradingSegments: ['EQUITY', 'DERIVATIVES'],
    };
  }

  async getFunds(): Promise<BrokerFunds> {
    return {
      availableCash: 500_000,
      usedMargin: 100_000,
      totalMargin: 600_000,
      marginMultiplier: 5,
      buyingPower: 2_500_000,
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

  async placeOrder(_request: OrderRequest): Promise<OrderResponse> {
    return {
      orderId: uuid(),
      status: 'OPEN',
      createdAt: Date.now(),
    };
  }

  async modifyOrder(orderId: string, _mods: OrderModification): Promise<OrderResponse> {
    return { orderId, status: 'OPEN' };
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

  on(event: BrokerAdapterEvent, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: BrokerAdapterEvent, handler: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event as BrokerAdapterEvent) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`[angelone] Error in ${event} listener:`, e);
      }
    }
  }
}
