# ADR-001: Broker Integration Architecture

**Date:** 2026-06-06  
**Status:** Accepted  
**Participants:** Architecture Review Board

## Problem

StockPred currently supports only paper trading. To enable live trading, we need to support multiple brokers (Zerodha, AngelOne, Upstox, Shoonya, Fyers) without:

1. Duplicating order routing logic for each broker
2. Hard-coding broker-specific logic in auto-trader
3. Breaking existing paper trading functionality
4. Creating tight coupling between services

## Solution

Implement an **Adapter Pattern** with a broker-agnostic trading engine:

```
Auto-Trader
    ↓
BrokerRouter (factory pattern)
    ├─→ BrokerAdapter (interface contract)
    │   ├─ PaperTradingAdapter (default, in-memory)
    │   ├─ ZerodhaAdapter (OAuth, REST API)
    │   ├─ AngelOneAdapter (API key, WebSocket)
    │   ├─ UpstoxAdapter (OAuth, WebSocket)
    │   ├─ ShoonyaAdapter (API key, WebSocket)
    │   └─ FyersAdapter (API key, REST)
    └─→ SessionManager (lifecycle management)
```

### Core Principles

1. **Single Responsibility:** Each adapter handles only its broker's protocol
2. **Auto-Trader Agnostic:** Auto-trader only knows BrokerAdapter interface
3. **Paper Trading Default:** Platform ships with PaperTradingAdapter (no broker setup required)
4. **Configuration-Driven:** Broker selection via `BROKER_TYPE` env var
5. **Event-Driven:** All broker operations emit Kafka events (broker.login, broker.order.created, etc.)

## BrokerAdapter Interface

```typescript
export interface BrokerAdapter {
  // Session Lifecycle
  login(): Promise<void>;
  logout(): Promise<void>;
  refreshToken(): Promise<void>;
  isAuthenticated(): boolean;

  // Account Information
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<BrokerFunds>;
  getPositions(): Promise<BrokerPosition[]>;
  getHoldings(): Promise<BrokerHolding[]>;

  // Order Management
  placeOrder(request: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<void>;

  // Market Data Subscription (optional)
  subscribeMarketData(symbols: string[]): Promise<void>;
  unsubscribeMarketData(symbols: string[]): Promise<void>;

  // Events
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}
```

## BrokerRouter (Factory)

```typescript
export class BrokerRouter {
  constructor(brokerType: string = 'PAPER') {
    this.adapter = BrokerFactory.create(brokerType);
  }

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    // Validation, encryption, Kafka emission
    const response = await this.adapter.placeOrder(req);
    await this.kafka.emit('broker.order.created', response);
    return response;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.adapter.cancelOrder(orderId);
    await this.kafka.emit('broker.order.cancelled', { orderId });
  }
}
```

## Benefits

| Benefit               | Details                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| **Modularity**        | Adding broker = create 1 adapter file, 0 changes to auto-trader                  |
| **Testability**       | Paper adapter always deterministic; real adapters mockable                       |
| **Gradual Migration** | Run paper trading → switch to 1 broker → add more brokers                        |
| **Fallback**          | If real broker down, can revert to paper adapter via env var                     |
| **Compliance**        | Broker-specific credential encryption, session management, audit logs per broker |

## Sequence Diagram: Order Flow

```
Auto-Trader          BrokerRouter         BrokerAdapter          Kafka
    │                    │                     │                   │
    ├─ placeOrder() ────→ │                     │                   │
    │                    │                     │                   │
    │                    ├─ validate ────────→ │                   │
    │                    │                     │                   │
    │                    │ ← OrderResponse ────┤                   │
    │                    │                     │                   │
    │                    ├─────────────────────────────────────────→ broker.order.created
    │                    │                     │                   │
    │  ← OrderResponse ──┤                     │                   │
    │                    │                     │                   │
    │ [Wait for fill]    │                     │ [WebSocket/poll]   │
    │                    │                     │                   │
    │                    │ ← OrderFilledEvent  │ ← broker pushes   │
    │                    │                     │                   │
    │                    ├─────────────────────────────────────────→ broker.order.filled
    │                    │                     │                   │
    ├─ getPositions() ──→ │                     │                   │
    │                    ├─────────────────────→ fetch positions    │
    │                    │                     │                   │
    │  ← Positions[] ────┤                     │                   │
    │                    │                     │                   │
```

## Assumptions

1. All brokers have order/position/funds APIs (REST or WebSocket)
2. Session tokens expire; broker SDK must refresh automatically
3. Margin calculations differ per broker; adapter implements broker-specific rules
4. Paper adapter uses same position sizing as auto-trader (no new math)

## Drawbacks

1. **N+1 Broker APIs:** Each broker has different API style → each adapter is ~500 LOC
2. **Session Management:** Must handle token expiry, reconnection, circuit breakers per broker
3. **Testing:** Real broker adapters require API keys (mock or sandbox accounts)
4. **Data Modeling:** Order/position structures must normalize across 5 brokers

## Alternatives Considered

### Alternative 1: Single Broker Service (Microservice)

- Create `broker-integration-service` app wrapping all adapters
- Pros: Separate deployment, centralized credential management
- Cons: Added latency (HTTP call from auto-trader to service), SPOF if service down
- **Rejected:** Phase 1 focuses on architecture; service can be extracted in Phase 2

### Alternative 2: Strategy Pattern (Not Adapter)

- Same as adapter, just different terminology
- **Not Preferred:** Adapter better describes broker plug-in semantics

### Alternative 3: No Abstraction (Direct Broker Client)

- Auto-trader directly calls Zerodha API, then AngelOne API, etc.
- Pros: Slightly less overhead
- Cons: Auto-trader becomes broker-aware (violates separation of concerns), code duplication
- **Rejected:** Creates technical debt

## Migration Path

1. **Phase 1:** Paper adapter only (this ADR)
2. **Phase 2:** SessionManager base class + encryption
3. **Phases 3-5:** Real broker adapters (Zerodha, AngelOne, Upstox, Shoonya, Fyers)
4. **Phase 6:** Broker Integration Service (microservice extraction)
5. **Phase 7+:** Advanced features (multi-broker routing, hedge strategies)

## Implementation Checklist

- [ ] BrokerAdapter interface defined
- [ ] BrokerRouter factory implemented
- [ ] PaperTradingAdapter implemented
- [ ] Auto-trader imports BrokerRouter, uses for placeOrder/cancelOrder
- [ ] Unit tests: PaperTradingAdapter behavior matches current auto-trader
- [ ] Integration tests: Auto-trader + BrokerRouter flow end-to-end
- [ ] E2E tests: Signal → Trade flow still works
- [ ] No breaking changes to existing endpoints

---

**Document Status:** Ready for team review and approval
