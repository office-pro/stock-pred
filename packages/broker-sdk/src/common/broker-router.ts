/**
 * BrokerRouter
 *
 * Routes all broker operations to the selected adapter (Paper, Zerodha, AngelOne, etc.)
 * Provides a single, unified interface for auto-trader to use.
 * Also emits Kafka events for audit and downstream consumers.
 */

import { uuid } from './id';
import type { BrokerAdapter } from './interfaces/broker-adapter';
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
} from './types/index';
import { BrokerFactory } from './broker-factory';

type EventHandler = (data: unknown) => void;

interface KafkaLikeProducer {
  emit(topic: string, event: unknown): Promise<unknown> | unknown;
}

export interface BrokerRouterConfig {
  brokerType?: string; // 'PAPER', 'ZERODHA', 'ANGELONE', etc.
  kafkaProducer?: KafkaLikeProducer;
}

export class BrokerRouter {
  private adapter: BrokerAdapter;
  private kafkaProducer?: KafkaLikeProducer;
  private listeners = new Map<string, EventHandler[]>();

  constructor(config: BrokerRouterConfig = {}) {
    const brokerType = config.brokerType || process.env.BROKER_TYPE || 'PAPER';
    this.adapter = BrokerFactory.create(brokerType);
    this.kafkaProducer = config.kafkaProducer;

    // Forward adapter events to our listeners
    this.adapter.on('order_placed', (data) => this.emit('order_placed', data));
    this.adapter.on('order_filled', (data) => this.emit('order_filled', data));
    this.adapter.on('order_rejected', (data) => this.emit('order_rejected', data));
    this.adapter.on('order_cancelled', (data) => this.emit('order_cancelled', data));
    this.adapter.on('position_updated', (data) => this.emit('position_updated', data));
    this.adapter.on('funds_updated', (data) => this.emit('funds_updated', data));
    this.adapter.on('authenticated', (data) => this.emit('authenticated', data));
    this.adapter.on('unauthenticated', (data) => this.emit('unauthenticated', data));
    this.adapter.on('error', (data) => this.emit('error', data));
  }

  // ===== SESSION MANAGEMENT =====

  async login(): Promise<void> {
    await this.adapter.login();
  }

  async logout(): Promise<void> {
    await this.adapter.logout();
  }

  async refreshToken(): Promise<void> {
    await this.adapter.refreshToken();
  }

  isAuthenticated(): boolean {
    return this.adapter.isAuthenticated();
  }

  // ===== ACCOUNT INFORMATION =====

  async getProfile(): Promise<BrokerProfile> {
    return this.adapter.getProfile();
  }

  async getFunds(): Promise<BrokerFunds> {
    return this.adapter.getFunds();
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return this.adapter.getPositions();
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    return this.adapter.getHoldings();
  }

  async getOrders(status?: string): Promise<BrokerOrder[]> {
    return this.adapter.getOrders(status);
  }

  async getTrades(filters?: {
    symbol?: string;
    from?: number;
    to?: number;
  }): Promise<BrokerTrade[]> {
    return this.adapter.getTrades(filters);
  }

  // ===== ORDER MANAGEMENT =====

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    // Validate order request
    this.validateOrderRequest(request);

    // Call adapter
    const response = await this.adapter.placeOrder(request);

    // Emit Kafka event if we have Kafka producer
    if (this.kafkaProducer && (response.status === 'OPEN' || response.status === 'EXECUTED')) {
      try {
        await this.publishOrderEvent('broker.order.created', request, response);
      } catch (e) {
        console.error('Failed to publish order event to Kafka:', e);
        // Don't fail the order placement if Kafka publish fails
        // (This is fire-and-forget async publishing)
      }
    }

    return response;
  }

  async modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse> {
    return this.adapter.modifyOrder(orderId, mods);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.adapter.cancelOrder(orderId);

    // Publish cancellation event
    if (this.kafkaProducer) {
      try {
        await this.publishCancellationEvent(orderId);
      } catch (e) {
        console.error('Failed to publish cancellation event to Kafka:', e);
      }
    }
  }

  // ===== MARKET DATA =====

  async subscribeMarketData(symbols: string[]): Promise<void> {
    if (this.adapter.subscribeMarketData) {
      await this.adapter.subscribeMarketData(symbols);
    }
  }

  async unsubscribeMarketData(symbols: string[]): Promise<void> {
    if (this.adapter.unsubscribeMarketData) {
      await this.adapter.unsubscribeMarketData(symbols);
    }
  }

  // ===== EVENT MANAGEMENT =====

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    }
  }

  // ===== KAFKA EVENT PUBLISHING =====

  private async publishOrderEvent(
    topic: string,
    request: OrderRequest,
    response: OrderResponse,
  ): Promise<void> {
    if (!this.kafkaProducer) return;

    const event = {
      eventId: uuid(),
      timestamp: Date.now(),
      source: 'broker-router',
      type: topic,
      version: 'v1',
      data: {
        brokerOrderId: response.brokerOrderId || response.orderId,
        tradeId: request.externalOrderId,
        symbol: request.symbol,
        side: request.side,
        quantity: request.quantity,
        price: request.price,
        orderType: request.orderType,
        status: response.status,
        createdAt: response.createdAt || Date.now(),
      },
    };

    await this.kafkaProducer.emit(topic, event);
  }

  private async publishCancellationEvent(orderId: string): Promise<void> {
    if (!this.kafkaProducer) return;

    const event = {
      eventId: uuid(),
      timestamp: Date.now(),
      source: 'broker-router',
      type: 'broker.order.cancelled',
      version: 'v1',
      data: {
        orderId,
      },
    };

    await this.kafkaProducer.emit('broker.order.cancelled', event);
  }

  // ===== VALIDATION =====

  private validateOrderRequest(request: OrderRequest): void {
    if (!request.symbol || request.symbol.trim().length === 0) {
      throw new Error('Order symbol is required');
    }
    if (!['BUY', 'SELL'].includes(request.side)) {
      throw new Error('Order side must be BUY or SELL');
    }
    if (request.quantity <= 0) {
      throw new Error('Order quantity must be positive');
    }
    if (request.orderType === 'LIMIT' && !request.price) {
      throw new Error('LIMIT orders require a price');
    }
    if (request.orderType === 'SL' && !request.triggerPrice) {
      throw new Error('SL orders require a trigger price');
    }
    if (!['MARKET', 'LIMIT', 'SL', 'SL-M'].includes(request.orderType)) {
      throw new Error('Invalid order type');
    }
    if (!['DAY', 'IOC', 'GTC'].includes(request.validity)) {
      throw new Error('Invalid order validity');
    }
    if (!['MIS', 'CNC', 'NRML'].includes(request.product)) {
      throw new Error('Invalid product type');
    }
  }
}
