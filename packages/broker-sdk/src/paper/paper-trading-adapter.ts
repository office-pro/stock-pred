/**
 * PaperTradingAdapter
 *
 * Reference implementation of BrokerAdapter interface.
 * Uses in-memory VirtualLedger to simulate trading without connecting to real brokers.
 *
 * Key properties:
 * - Fully deterministic (same inputs = same outputs)
 * - No network latency
 * - No rate limits
 * - Unlimited virtual capital
 * - Exact position sizing and PnL math from auto-trader
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

/**
 * Virtual position (in-memory)
 */
interface VirtualPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  entryTime: number;
  currentPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;
  mode: 'CNC' | 'MIS' | 'NRML';
}

/**
 * Virtual order (pending or executed)
 */
interface VirtualOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // LIMIT price
  triggerPrice?: number; // SL trigger
  type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  product: 'MIS' | 'CNC' | 'NRML';
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
  filledQuantity?: number;
  error?: string;
}

/**
 * Virtual trade (closed position)
 */
interface VirtualTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  executedAt: number;
  closedAt: number;
  pnl: number;
  pnlPercent: number;
}

export class PaperTradingAdapter implements BrokerAdapter {
  private brokerAccountId: string = uuid();
  private authenticated: boolean = false;
  private cash: number = 1_000_000; // Default capital
  private _startOfDayEquity: number = 1_000_000;
  private _startOfWeekEquity: number = 1_000_000;
  private dailyDrawdownTripped: boolean = false;
  private weeklyDrawdownTripped: boolean = false;
  private positions = new Map<string, VirtualPosition>();
  private orders = new Map<string, VirtualOrder>();
  private trades: VirtualTrade[] = [];
  private listeners = new Map<string, Array<(data: unknown) => void>>();

  constructor() {
    this.resetDaily();
    this.resetWeekly();
  }

  // ===== SESSION LIFECYCLE =====

  async login(): Promise<void> {
    this.authenticated = true;
    this.emit('authenticated', {
      brokerAccountId: this.brokerAccountId,
      accountId: this.brokerAccountId,
    });
  }

  async logout(): Promise<void> {
    this.authenticated = false;
    this.emit('unauthenticated', { reason: 'user_initiated' });
  }

  async refreshToken(): Promise<void> {
    if (!this.authenticated) {
      throw new Error('Not authenticated');
    }
    // No-op for paper trading (no real token)
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // ===== ACCOUNT INFORMATION =====

  async getProfile(): Promise<BrokerProfile> {
    if (!this.authenticated) throw new Error('Not authenticated');

    return {
      id: this.brokerAccountId,
      name: 'Paper Trading Account',
      email: 'paper@stockpred.local',
      accountId: this.brokerAccountId,
      brokerName: 'PAPER',
      brokerType: 'PAPER',
      tradingSegments: ['EQUITY'],
    };
  }

  async getFunds(): Promise<BrokerFunds> {
    if (!this.authenticated) throw new Error('Not authenticated');

    const usedMargin = this.calculateUsedMargin();
    return {
      availableCash: Math.max(0, this.cash),
      usedMargin,
      totalMargin: this.cash + usedMargin,
      marginMultiplier: 1, // Paper trading: no leverage
      buyingPower: this.cash,
      updatedAt: Date.now(),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    if (!this.authenticated) throw new Error('Not authenticated');

    return Array.from(this.positions.values()).map((pos) => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      averagePrice: pos.entryPrice,
      currentPrice: pos.currentPrice,
      unrealizedPnL: (pos.currentPrice - pos.entryPrice) * pos.quantity,
      unrealizedPnLPercent: ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100,
      mode: pos.mode,
    }));
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    // For paper trading, holdings = positions (long-term)
    const positions = await this.getPositions();
    return positions.map((pos) => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      pledgeQuantity: 0,
      currentPrice: pos.currentPrice,
      value: pos.quantity * pos.currentPrice,
    }));
  }

  async getOrders(status?: string): Promise<BrokerOrder[]> {
    if (!this.authenticated) throw new Error('Not authenticated');

    return Array.from(this.orders.values())
      .filter((order) => !status || order.status === status)
      .map((order) => ({
        orderId: order.id,
        brokerOrderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity || 0,
        price: order.price || 0,
        filledPrice: order.fillPrice,
        orderType: order.type,
        validity: order.validity,
        status: order.status,
        mode: order.product,
        createdAt: order.createdAt,
        updatedAt: order.filledAt || order.createdAt,
        error: order.error,
      }));
  }

  async getTrades(filters?: {
    symbol?: string;
    from?: number;
    to?: number;
  }): Promise<BrokerTrade[]> {
    if (!this.authenticated) throw new Error('Not authenticated');

    return this.trades
      .filter((trade) => {
        if (filters?.symbol && trade.symbol !== filters.symbol) return false;
        if (filters?.from && trade.closedAt < filters.from) return false;
        if (filters?.to && trade.closedAt > filters.to) return false;
        return true;
      })
      .map((trade) => ({
        tradeId: trade.id,
        orderId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        fillPrice: trade.exitPrice,
        commission: 0, // Paper trading: no commission
        tax: 0,
        executedAt: trade.closedAt,
      }));
  }

  // ===== ORDER MANAGEMENT =====

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    if (!this.authenticated) throw new Error('Not authenticated');

    // Check risk limits
    if (this.dailyDrawdownTripped || this.weeklyDrawdownTripped) {
      return {
        orderId: uuid(),
        status: 'REJECTED',
        error: 'Risk limit exceeded (drawdown)',
      };
    }

    // Validate order
    if (!request.symbol || request.quantity <= 0) {
      return {
        orderId: uuid(),
        status: 'REJECTED',
        error: 'Invalid order parameters',
      };
    }

    // Get current market price
    const marketPrice = request.price || 100; // Fallback to 100 if no price provided
    const orderId = uuid();

    // Check funds for BUY orders
    if (request.side === 'BUY') {
      const cost = request.quantity * marketPrice;
      if (cost > this.cash) {
        return {
          orderId,
          status: 'REJECTED',
          error: `Insufficient cash: required ${cost}, available ${this.cash}`,
        };
      }
    }

    // Create order
    const order: VirtualOrder = {
      id: orderId,
      symbol: request.symbol,
      side: request.side,
      quantity: request.quantity,
      price: request.price,
      triggerPrice: request.triggerPrice,
      type: request.orderType,
      validity: request.validity,
      product: request.product,
      status: 'PENDING',
      createdAt: Date.now(),
    };

    // MARKET orders fill immediately
    if (request.orderType === 'MARKET') {
      return this.fillOrder(order, marketPrice);
    }

    // LIMIT/SL orders remain pending
    this.orders.set(orderId, order);
    this.emit('order_placed', { orderId, symbol: request.symbol });

    return {
      orderId,
      status: 'OPEN',
      createdAt: Date.now(),
    };
  }

  async modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse> {
    if (!this.authenticated) throw new Error('Not authenticated');

    const order = this.orders.get(orderId);
    if (!order) {
      return {
        orderId,
        status: 'REJECTED',
        error: 'Order not found',
      };
    }

    if (mods.price !== undefined) order.price = mods.price;
    if (mods.quantity !== undefined) order.quantity = mods.quantity;
    if (mods.triggerPrice !== undefined) order.triggerPrice = mods.triggerPrice;

    return {
      orderId,
      status: order.status,
      createdAt: order.createdAt,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (!this.authenticated) throw new Error('Not authenticated');

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status === 'EXECUTED') {
      throw new Error('Cannot cancel executed order');
    }

    order.status = 'CANCELLED';
    this.emit('order_cancelled', { orderId });
  }

  // ===== MARKET DATA SUBSCRIPTION =====

  async subscribeMarketData(_symbols: string[]): Promise<void> {
    // Paper trading doesn't subscribe to real data
    // This is a no-op
  }

  async unsubscribeMarketData(_symbols: string[]): Promise<void> {
    // Paper trading doesn't subscribe to real data
    // This is a no-op
  }

  // ===== EVENT MANAGEMENT =====

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

  // ===== MARKET TICK HANDLING (Called by auto-trader on each tick) =====

  onMarketTick(symbol: string, price: number, _time: number): void {
    // Check for order fills
    for (const [_orderId, order] of this.orders) {
      if (order.symbol !== symbol || order.status !== 'PENDING') continue;

      let shouldFill = false;

      // LIMIT order: fill if price crosses limit
      if (order.type === 'LIMIT' && order.price) {
        shouldFill =
          (order.side === 'BUY' && price <= order.price) ||
          (order.side === 'SELL' && price >= order.price);
      }

      // SL order: fill if price breaches trigger
      if (order.type === 'SL' && order.triggerPrice) {
        shouldFill = price <= order.triggerPrice;
      }

      if (shouldFill) {
        this.fillOrder(order, price);
      }
    }

    // Update position prices
    const position = this.positions.get(symbol);
    if (position) {
      position.currentPrice = price;

      // Check for target/SL hits (would trigger exit in real auto-trader)
      // Paper adapter doesn't auto-exit; auto-trader handles that
    }
  }

  // ===== INTERNAL HELPERS =====

  private fillOrder(order: VirtualOrder, fillPrice: number): OrderResponse {
    order.status = 'EXECUTED';
    order.fillPrice = fillPrice;
    order.filledQuantity = order.quantity;
    order.filledAt = Date.now();

    const orderId = order.id;

    if (order.side === 'BUY') {
      const cost = order.quantity * fillPrice;
      this.cash -= cost;

      // Create or update position
      const existing = this.positions.get(order.symbol);
      if (existing && existing.side === 'BUY') {
        // Average up
        const totalCost = existing.quantity * existing.entryPrice + cost;
        existing.quantity += order.quantity;
        existing.entryPrice = totalCost / existing.quantity;
      } else {
        // New position
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          side: 'BUY',
          quantity: order.quantity,
          entryPrice: fillPrice,
          entryTime: order.filledAt!,
          currentPrice: fillPrice,
          mode: order.product,
          targetPrice: order.triggerPrice,
          stopLossPrice: order.price,
        });
      }
    } else {
      // SELL
      const proceeds = order.quantity * fillPrice;
      this.cash += proceeds;

      // Close position
      const position = this.positions.get(order.symbol);
      if (position) {
        const pnl = (fillPrice - position.entryPrice) * order.quantity;
        const pnlPercent = (pnl / (position.entryPrice * order.quantity)) * 100;

        this.trades.push({
          id: uuid(),
          symbol: order.symbol,
          side: 'BUY',
          quantity: order.quantity,
          entryPrice: position.entryPrice,
          exitPrice: fillPrice,
          executedAt: position.entryTime,
          closedAt: order.filledAt!,
          pnl,
          pnlPercent,
        });

        this.positions.delete(order.symbol);
      }
    }

    this.emit('order_filled', {
      orderId,
      fillPrice,
      filledQuantity: order.quantity,
    });

    return {
      orderId,
      status: 'EXECUTED',
      createdAt: order.createdAt,
    };
  }

  private calculateUsedMargin(): number {
    let margin = 0;
    for (const pos of this.positions.values()) {
      margin += pos.quantity * pos.entryPrice * 0.05; // 5% margin requirement
    }
    return margin;
  }

  private resetDaily(): void {
    this._startOfDayEquity = this.getEquity();
    this.dailyDrawdownTripped = false;
  }

  private resetWeekly(): void {
    this._startOfWeekEquity = this.getEquity();
    this.weeklyDrawdownTripped = false;
  }

  private getEquity(): number {
    let equity = this.cash;
    for (const pos of this.positions.values()) {
      equity += pos.quantity * pos.currentPrice;
    }
    return equity;
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event as BrokerAdapterEvent) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    }
  }
}
