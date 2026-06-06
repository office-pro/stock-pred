# ADR-005: Multi-Broker Adapter Pattern

**Date:** 2026-06-06  
**Status:** Accepted  
**Participants:** Architecture Review Board

## Problem

StockPred must support 5 different brokers (Zerodha, AngelOne, Upstox, Shoonya, Fyers), each with unique:

- REST vs WebSocket APIs
- Authentication (OAuth vs API key)
- Order types and validity options
- Position modes (CNC, MIS, NRML)
- Commission structures
- Rate limits and throttling

We must implement this without:

1. Duplicating order routing logic in auto-trader
2. Creating broker-specific branches in core trading logic
3. Making it hard to add new brokers
4. Coupling auto-trader to broker details

## Solution

Implement **Adapter Pattern** with a standard interface that all brokers implement.

### BrokerAdapter Interface

**Definition:** Single contract all brokers must fulfill.

```typescript
// packages/broker-sdk/src/common/interfaces/broker-adapter.ts

export interface BrokerAdapter {
  // ===== SESSION LIFECYCLE =====
  login(credentials: Credentials): Promise<LoginResponse>;
  logout(): Promise<void>;
  refreshToken(): Promise<void>;
  isAuthenticated(): boolean;

  // ===== ACCOUNT INFO (read-only) =====
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<BrokerFunds>;
  getPositions(): Promise<BrokerPosition[]>;
  getHoldings(): Promise<BrokerHolding[]>;
  getOrders(status?: OrderStatus): Promise<BrokerOrder[]>;
  getTrades(filters?: TradeFilter): Promise<BrokerTrade[]>;

  // ===== ORDER MANAGEMENT (write) =====
  placeOrder(request: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<void>;

  // ===== MARKET DATA SUBSCRIPTION (optional) =====
  subscribeMarketData?(symbols: string[]): Promise<void>;
  unsubscribeMarketData?(symbols: string[]): Promise<void>;

  // ===== EVENTS =====
  on(event: BrokerAdapterEvent, handler: Function): void;
  off(event: BrokerAdapterEvent, handler: Function): void;
}

export type BrokerAdapterEvent =
  | 'authenticated'
  | 'unauthenticated'
  | 'order_placed'
  | 'order_filled'
  | 'order_rejected'
  | 'position_updated'
  | 'error';
```

### Broker-Specific Adapters (Examples)

#### Adapter 1: Zerodha

```typescript
// packages/broker-sdk/src/zerodha/zerodha-adapter.ts

export class ZerodhaAdapter implements BrokerAdapter {
  private session: ZerodhaSessionManager;
  private websocket?: WebSocket;

  constructor(
    private credentials: OAuthCredential,
    private kafka: EventProducer,
  ) {
    this.session = new ZerodhaSessionManager(credentials);
  }

  async login(): Promise<LoginResponse> {
    await this.session.authenticate();
    // Start WebSocket for position updates
    this.websocket = await this.startWebSocket();
    return { success: true, accountId: this.credentials.accountId };
  }

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    await this.session.ensureActive();

    const zerodhaOrder = this.translateToZerodhaOrder(req);
    const response = await fetch('https://api.kite.trade/orders/regular', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.session.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(zerodhaOrder),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new BrokerError(data.message, data.error_type);
    }

    const result = {
      orderId: data.order_id,
      status: this.mapOrderStatus(data.status),
      createdAt: Date.now(),
    };

    await this.kafka.emit('broker.order.created', {
      brokerOrderId: result.orderId,
      symbol: req.symbol,
      status: result.status,
    });

    return result;
  }

  // Zerodha-specific: translate StockPred types to Zerodha API
  private translateToZerodhaOrder(req: OrderRequest) {
    return {
      symbol: `NSE:${req.symbol}`, // Zerodha expects exchange prefix
      quantity: req.quantity,
      order_type: {
        MARKET: 'MKT',
        LIMIT: 'LIMIT',
        SL: 'SL',
        'SL-M': 'SL-M',
      }[req.orderType],
      price: req.price,
      validity: {
        DAY: 'DAY',
        IOC: 'IOC',
        GTC: 'GTC', // Not all brokers support GTC
      }[req.validity],
      disclosed_quantity: 0,
      trigger_price: req.triggerPrice,
      squareoff: req.targetPrice,
      stoploss: req.stopLossPrice,
      trailing_stop: 0,
      iceberg_legs: 0,
      iceberg_quantity: 0,
      product: {
        MIS: 'MIS',
        CNC: 'CNC',
        NRML: 'NRML',
      }[req.product],
    };
  }

  // Zerodha-specific: map Zerodha status to standard enum
  private mapOrderStatus(zerodhaStatus: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      OPEN: 'OPEN',
      COMPLETE: 'EXECUTED',
      CANCELLED: 'CANCELLED',
      REJECTED: 'REJECTED',
      PENDING: 'PENDING',
    };
    return map[zerodhaStatus] || 'PENDING';
  }

  // Zerodha-specific: WebSocket for live position updates
  private async startWebSocket(): Promise<WebSocket> {
    const ws = new WebSocket('wss://ws.kite.trade');
    ws.on('message', (msg: string) => {
      const data = JSON.parse(msg);
      if (data.type === 'position') {
        this.emit('position_updated', {
          symbol: data.symbol,
          quantity: data.quantity,
          avgPrice: data.avg_price,
        });
      }
    });
    ws.on('error', (e) => this.emit('error', e));
    ws.on('close', () => console.log('Zerodha WebSocket closed'));
    return ws;
  }
}
```

#### Adapter 2: AngelOne

```typescript
// packages/broker-sdk/src/angelone/angelone-adapter.ts

export class AngelOneAdapter implements BrokerAdapter {
  private session: AngelOneSessionManager;
  private websocket?: WebSocket;

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    await this.session.ensureActive();

    // AngelOne uses different endpoint structure
    const response = await fetch('https://api.angelbroking.com/secure/orderplace', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.session.sessionToken}`,
        'X-ClientLocalIP': '127.0.0.1',  // AngelOne requirement
        'X-ClientPublicIP': process.env.CLIENT_IP || '0.0.0.0',
        'X-MachineID': crypto.randomUUID(),
      },
      body: this.buildAngelOneOrder(req),
    });

    const data = await response.json();
    if (data.status !== 'success') {
      throw new BrokerError(data.message, 'ANGEL_ERROR');
    }

    return {
      orderId: data.data.orderid,
      status: 'OPEN',  // AngelOne immediately returns OPEN
      createdAt: Date.now(),
    };
  }

  // AngelOne-specific: different field names and defaults
  private buildAngelOneOrder(req: OrderRequest): string {
    const order = {
      mode: 'PLACE',
      tokennum: this.getSymbolToken(req.symbol),  // AngelOne uses token IDs
      quantity: req.quantity,
      price: req.price ?? 0,
      pricetype: {
        'MARKET': 'MKT',
        'LIMIT': 'LIMIT',
        'SL': 'SL',
        'SL-M': 'SL-M',
      }[req.orderType],
      ordertype: req.side === 'BUY' ? 'BUY' : 'SELL',
      producttype: req.product,  // AngelOne accepts CNC/MIS directly
      duration: {
        'DAY': 'DAY',
        'IOC': 'IOC',
        'GTC': 'GTC',
      }[req.validity],
      stoplossflag: req.stopLossPrice ? 'Y' : 'N',
      stoplossvalue: req.stopLossPrice ?? 0,
      profittargetflag: req.targetPrice ? 'Y' : 'N',
      profittargetvalue: req.targetPrice ?? 0,
      trailingspotter: 0,
      disclosedqty: req.disclosedQuantity ?? 0,
      externalorderid: uuid(),  // AngelOne tracks via externalorderid
    };
    return new URLSearchParams(order).toString();  // AngelOne uses form-encoding
  }

  // AngelOne: symbols are mapped to numeric tokens
  private getSymbolToken(symbol: string): string {
    const tokens: Record<string, string> = {
      'RELIANCE': '2885',
      'TCS': '1594',
      'INFY': '1270',
      // ... loaded from broker symbolmap
    };
    return tokens[symbol] || throw new Error(`Unknown symbol: ${symbol}`);
  }
}
```

#### Adapter 3: Paper Trading (Default)

```typescript
// packages/broker-sdk/src/paper/paper-trading-adapter.ts

export class PaperTradingAdapter implements BrokerAdapter {
  private ledger: VirtualLedger;
  private listeners = new Map<string, Function[]>();

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    // Validation (e.g., sufficient cash)
    if (this.ledger.cash < req.quantity * (req.price || this.getMarketPrice(req.symbol))) {
      return {
        orderId: uuid(),
        status: 'REJECTED',
        error: 'Insufficient cash',
      };
    }

    // Create order
    const orderId = uuid();
    const order: Order = {
      id: orderId,
      symbol: req.symbol,
      side: req.side,
      quantity: req.quantity,
      price: req.price,
      type: req.orderType,
      status: req.orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
      createdAt: Date.now(),
    };

    // MARKET orders fill immediately
    if (req.orderType === 'MARKET') {
      const fillPrice = this.getMarketPrice(req.symbol);
      const cost = req.quantity * fillPrice;
      this.ledger.cash -= cost;
      this.ledger.positions.set(req.symbol, {
        symbol: req.symbol,
        quantity: req.quantity,
        entryPrice: fillPrice,
        entryTime: Date.now(),
        targetPrice: req.targetPrice,
        stopLossPrice: req.stopLossPrice,
      });
      this.emit('order_filled', { orderId, fillPrice, quantity: req.quantity });
    } else {
      // LIMIT/SL orders pending
      this.ledger.pendingOrders.set(orderId, order);
      this.emit('order_placed', order);
    }

    return { orderId, status: order.status };
  }

  // Paper trading: simulate fills on market ticks
  onMarketTick(tick: MarketTick): void {
    for (const [orderId, order] of this.ledger.pendingOrders) {
      if (order.symbol !== tick.symbol) continue;

      let shouldFill = false;
      if (order.type === 'LIMIT') {
        shouldFill =
          (order.side === 'BUY' && tick.price <= order.price) ||
          (order.side === 'SELL' && tick.price >= order.price);
      } else if (order.type === 'SL') {
        shouldFill = tick.price <= order.triggerPrice;
      }

      if (shouldFill) {
        this.ledger.pendingOrders.delete(orderId);
        const cost = order.quantity * tick.price;
        this.ledger.cash -= cost;
        this.ledger.positions.set(order.symbol, {
          symbol: order.symbol,
          quantity: order.quantity,
          entryPrice: tick.price,
          entryTime: tick.time,
          targetPrice: order.targetPrice,
          stopLossPrice: order.stopLossPrice,
        });
        this.emit('order_filled', { orderId, fillPrice: tick.price });
      }
    }
  }

  // Paper trading: get latest tick price from market data service
  private getMarketPrice(symbol: string): number {
    // Query latest market tick (in-memory or from cache)
    return this.marketDataService.getLatestTick(symbol).price;
  }

  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    }
  }
}
```

### BrokerRouter Factory

```typescript
// packages/broker-sdk/src/common/broker-router.ts

export class BrokerRouter {
  private adapter: BrokerAdapter;

  constructor(brokerType: string = 'PAPER') {
    this.adapter = BrokerFactory.create(brokerType);
  }

  async login(credentials?: Credentials): Promise<void> {
    await this.adapter.login(credentials);
  }

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    const response = await this.adapter.placeOrder(req);
    // Publish to Kafka (common logic, all adapters)
    if (response.status === 'OPEN' || response.status === 'EXECUTED') {
      await this.publishOrderEvent(req, response);
    }
    return response;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.adapter.cancelOrder(orderId);
    // Publish cancellation event
  }

  private async publishOrderEvent(req: OrderRequest, res: OrderResponse): Promise<void> {
    // Common Kafka publish logic (not broker-specific)
    const event = {
      eventId: uuid(),
      timestamp: Date.now(),
      type: 'broker.order.created',
      data: {
        brokerOrderId: res.orderId,
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        status: res.status,
      },
    };
    await this.kafka.emit('broker.order.created', event);
  }
}

// Factory
export class BrokerFactory {
  static create(brokerType: string): BrokerAdapter {
    const type = (brokerType || process.env.BROKER_TYPE || 'PAPER').toUpperCase();

    switch (type) {
      case 'PAPER':
        return new PaperTradingAdapter();
      case 'ZERODHA':
        return new ZerodhaAdapter(this.loadCredentials('ZERODHA'), kafka);
      case 'ANGELONE':
        return new AngelOneAdapter(this.loadCredentials('ANGELONE'), kafka);
      case 'UPSTOX':
        return new UpstoxAdapter(this.loadCredentials('UPSTOX'), kafka);
      case 'SHOONYA':
        return new ShoonyaAdapter(this.loadCredentials('SHOONYA'), kafka);
      case 'FYERS':
        return new FyersAdapter(this.loadCredentials('FYERS'), kafka);
      default:
        throw new Error(`Unknown broker: ${type}`);
    }
  }

  private static loadCredentials(brokerName: string): Credentials {
    // Load from DB, decrypt, return
    const account = db.brokerAccount.findFirst({
      where: { brokerName, authorized: true },
    });
    if (!account) throw new Error(`No authorized ${brokerName} account`);
    return credentialEncryptor.decrypt(account.credentialsEncrypted);
  }
}
```

### Auto-Trader Integration

**Before:**

```typescript
// apps/auto-trader/src/trader/trader.service.ts
private openPosition(symbol: string, price: number, qty: number): void {
  this.positions.set(symbol, { qty, price, ... });
  this.cash -= qty * price;  // Direct state update
}
```

**After:**

```typescript
@Injectable()
export class TraderService {
  constructor(
    private brokerRouter: BrokerRouter, // Injected
    private prisma: PrismaService,
  ) {}

  private async openPosition(symbol: string, price: number, qty: number): Promise<void> {
    // Delegate to broker (paper or live)
    const response = await this.brokerRouter.placeOrder({
      symbol,
      side: 'BUY',
      quantity: qty,
      price,
      orderType: 'MARKET',
      // ... rest of order request
    });

    if (response.status === 'REJECTED') {
      throw new ForbiddenException(response.error);
    }

    // Persist trade to DB (adapter doesn't have DB access)
    await this.prisma.trade.create({
      data: {
        symbol,
        side: 'BUY',
        quantity: qty,
        price,
        brokerOrderId: response.orderId, // Link to broker
        status: 'OPEN',
      },
    });
  }
}
```

## Adapter Development Checklist

For each new broker, implement:

- [ ] Authentication (OAuth flow or API key)
- [ ] SessionManager (token refresh, expiry)
- [ ] placeOrder() (order creation, status mapping)
- [ ] cancelOrder() (order cancellation)
- [ ] getPositions() (account state)
- [ ] getFunds() (cash, margin)
- [ ] Event handlers (fill, rejection)
- [ ] Error handling (broker-specific error codes)
- [ ] Rate limiting (broker API limits)
- [ ] Symbol mapping (broker-specific symbols vs NSE tickers)
- [ ] Unit tests (mock adapter)
- [ ] Integration tests (sandbox account)

## Benefits

| Benefit                 | Detail                                            |
| ----------------------- | ------------------------------------------------- |
| **Zero coupling**       | Auto-trader only knows BrokerAdapter interface    |
| **Easy to add brokers** | New broker = 1 file + implementation of interface |
| **Easy to mock**        | Unit tests use MockBrokerAdapter                  |
| **Easy to fallback**    | If real broker fails, switch to Paper via env var |
| **Easy to test**        | Paper adapter is deterministic, no rate limits    |
| **Gradual adoption**    | Ship with Paper, add real brokers incrementally   |

## Risk Mitigation

| Risk              | Mitigation                                                    |
| ----------------- | ------------------------------------------------------------- |
| Broker API change | Adapter is updated, auto-trader unchanged                     |
| Broker outage     | Fall back to paper trading via env var                        |
| Wrong credentials | SessionManager validates on auth, fails fast                  |
| Order rejection   | Adapter returns OrderResponse with error, auto-trader handles |
| Rate limit hit    | Adapter queues requests, broker's rate limiting respected     |

---

**Document Status:** Ready for implementation
