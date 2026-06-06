# StockPred Broker Integration & Paper Trading - Implementation Plan

**Status:** Draft  
**Last Updated:** 2026-06-06  
**Target Completion:** Phase-based (See timeline below)

---

## Overview

This plan extends the existing StockPred platform with broker integration and paper trading capabilities without disrupting the current architecture.

**Key Principles:**

- Preserve all existing services
- Maintain Kafka event flow
- Keep Auto Trader broker-agnostic
- All trading is event-driven
- Paper trading as default, live trading gated by config

---

## Phase 1: Architecture & Documentation (Week 1)

### 1.1 Create ADR Documents

**Deliverable:** `docs/adr/` directory with 5 ADRs

**Files to create:**

```
docs/adr/
├── ADR-001-Broker-Architecture.md
├── ADR-002-Paper-Trading.md
├── ADR-003-Market-Data-Providers.md
├── ADR-004-Broker-Security.md
└── ADR-005-Kafka-Event-Contracts.md
```

**Contents per ADR:**

- **ADR-001:** Broker abstraction layer, adapter pattern, multi-broker support strategy
- **ADR-002:** Paper trading virtual engine, capital/margin simulation
- **ADR-003:** Market data provider abstraction (Yahoo, Simulated, Broker APIs)
- **ADR-004:** Credential encryption (AES-256-GCM), session management, key rotation
- **ADR-005:** Broker event topics, payload schemas, versioning

### 1.2 Define Core Interfaces

**Location:** `packages/broker-sdk/common/`

**Files:**

- `interfaces/broker-adapter.ts` — Core BrokerAdapter interface
- `interfaces/market-data-provider.ts` — MarketDataProvider interface
- `types/index.ts` — Shared types (Order, Position, Holding, Fund, Session)
- `enums/index.ts` — OrderStatus, OrderType, PositionMode, etc.

**Key Interface:**

```typescript
export interface BrokerAdapter {
  // Session Management
  login(): Promise<void>;
  logout(): Promise<void>;
  refreshToken(): Promise<void>;

  // Account Info
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<BrokerFunds>;
  getPositions(): Promise<BrokerPosition[]>;
  getHoldings(): Promise<BrokerHolding[]>;

  // Order Management
  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, modifications: OrderModification): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<void>;

  // Market Data
  subscribeMarketData(symbols: string[]): Promise<void>;
  unsubscribeMarketData(symbols: string[]): Promise<void>;
}
```

### 1.3 Plan Package Structure

**Location:** `packages/broker-sdk/`

```
packages/broker-sdk/
├── common/
│   ├── interfaces/
│   ├── types/
│   ├── enums/
│   ├── validators/
│   ├── encryption/
│   └── session-manager.ts
├── paper/
│   ├── adapter.ts
│   ├── virtual-ledger.ts
│   └── market-simulator.ts
├── angelone/
│   ├── adapter.ts
│   ├── session-manager.ts
│   └── types.ts
├── shoonya/
│   ├── adapter.ts
│   ├── session-manager.ts
│   └── types.ts
├── upstox/
│   ├── adapter.ts
│   ├── session-manager.ts
│   └── types.ts
├── zerodha/
│   ├── adapter.ts
│   ├── session-manager.ts
│   └── types.ts
└── fyers/
    ├── adapter.ts
    ├── session-manager.ts
    └── types.ts
```

---

## Phase 2: Core Infrastructure (Week 2)

### 2.1 Create Broker SDK - Common Package

**Location:** `packages/broker-sdk/common/`

**Tasks:**

- [ ] Create `interfaces/broker-adapter.ts` with BrokerAdapter interface
- [ ] Create `interfaces/market-data-provider.ts` with MarketDataProvider interface
- [ ] Create `types/index.ts` with all domain types
- [ ] Create `enums/index.ts` with all enums
- [ ] Create `validators/order-validator.ts` for order validation
- [ ] Create `encryption/credential-encryptor.ts` (AES-256-GCM)
- [ ] Create `session-manager.ts` with auto-reconnect, heartbeat, rate limiting
- [ ] Create `dto/` directory with request/response types
- [ ] Create `errors/` directory with custom error classes
- [ ] Add unit tests (90%+ coverage)

**Key Responsibility:** SessionManager

- Auto-reconnect with exponential backoff
- Token refresh before expiry
- Heartbeat mechanism
- Circuit breaker pattern
- Retry logic
- Session recovery

### 2.2 Create Broker Integration Service

**Location:** `apps/broker-integration-service/`

**Structure:**

```
apps/broker-integration-service/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   ├── controllers/
│   │   ├── broker.controller.ts
│   │   ├── order.controller.ts
│   │   ├── position.controller.ts
│   │   └── holding.controller.ts
│   ├── services/
│   │   ├── broker-router.ts
│   │   ├── broker-orchestrator.ts
│   │   ├── order-processor.ts
│   │   └── sync-service.ts
│   ├── kafka/
│   │   ├── producers/
│   │   └── consumers/
│   └── middleware/
│       └── broker-auth.ts
├── test/
└── Dockerfile
```

**Responsibilities:**

- Route orders to appropriate broker adapter
- Manage broker sessions (login/logout)
- Sync positions, holdings, funds from brokers
- Emit Kafka events for all broker actions
- Expose REST API for order management

---

## Phase 3: Paper Trading Implementation (Week 2-3)

### 3.1 Create Paper Trading Adapter

**Location:** `packages/broker-sdk/paper/`

**Files:**

- [ ] `adapter.ts` — Implements BrokerAdapter interface
- [ ] `virtual-ledger.ts` — Manages virtual funds, positions, orders
- [ ] `market-simulator.ts` — Simulates order fills based on market prices
- [ ] `pnl-calculator.ts` — Calculates realized/unrealized PnL
- [ ] `margin-calculator.ts` — Virtual margin simulation
- [ ] Tests with 90%+ coverage

**Virtual Ledger Responsibilities:**

- Virtual capital (default 1M INR)
- Virtual positions tracking
- Virtual orders (pending, executed, rejected)
- Virtual holdings
- Margin calculation
- PnL tracking

**Market Simulator Responsibilities:**

- Fetch current market prices from market-data-service
- Simulate order fills at market price + slippage
- Queue orders for processing
- Generate filled order events

### 3.2 Create Paper Trading Endpoints in Broker Integration Service

**Endpoints:**

```
GET  /brokers/paper/profile       — Get virtual profile
GET  /brokers/paper/funds         — Get virtual funds
GET  /brokers/paper/positions     — Get virtual positions
GET  /brokers/paper/holdings      — Get virtual holdings
POST /brokers/paper/orders        — Place virtual order
PUT  /brokers/paper/orders/:id    — Modify virtual order
DEL  /brokers/paper/orders/:id    — Cancel virtual order
```

---

## Phase 4: Database Schema Extension (Week 3)

### 4.1 Create Migrations

**Location:** `packages/database/prisma/migrations/`

**New Tables:**

```
brokers
├── id (PK)
├── name (UNIQUE)
├── displayName
├── type (ENUM: PAPER, ZERODHA, ANGELONE, UPSTOX, SHOONYA, FYERS)
└── config (JSONB)

broker_accounts
├── id (PK)
├── userId (FK → users)
├── brokerId (FK → brokers)
├── externalAccountId
├── isActive
├── lastSyncedAt
└── UNIQUE(userId, brokerId)

broker_sessions
├── id (PK)
├── brokerAccountId (FK)
├── sessionToken (encrypted)
├── refreshToken (encrypted)
├── expiresAt
├── isActive
└── createdAt

broker_tokens
├── id (PK)
├── brokerAccountId (FK)
├── tokenType
├── token (encrypted)
├── expiresAt

broker_orders
├── id (PK)
├── brokerAccountId (FK)
├── symbol
├── side (BUY|SELL)
├── quantity
├── price
├── orderType
├── status
├── externalOrderId
├── executedQuantity
├── executedPrice
├── rejectionReason
├── createdAt
└── updatedAt

broker_positions
├── id (PK)
├── brokerAccountId (FK)
├── symbol
├── quantity
├── avgPrice
├── currentPrice
├── pnl
├── pnlPercent
├── mode
├── lastSyncedAt

broker_holdings
├── id (PK)
├── brokerAccountId (FK)
├── symbol
├── quantity
├── pledgeQuantity
├── avgPrice
├── currentPrice
└── lastSyncedAt

broker_funds
├── id (PK)
├── brokerAccountId (FK)
├── availableCash
├── usedMargin
├── totalMargin
├── marginMultiplier
└── lastSyncedAt
```

**Indexes & Constraints:**

- `UNIQUE(userId, brokerId)` on broker_accounts
- `INDEX(brokerAccountId, status)` on broker_orders
- `INDEX(symbol, lastSyncedAt)` on broker_positions
- Foreign keys with CASCADE delete

### 4.2 Update Existing Schema

**Changes to `trades` table:**

- Add column: `brokerAccountId` (FK → broker_accounts) [NULLABLE]
- Add column: `externalOrderId` (STRING) [NULLABLE]
- Add index: `(brokerAccountId, status)`

---

## Phase 5: Broker Adapters Implementation (Week 3-4)

### 5.1 Implement Required Adapters

For each broker (Zerodha, AngelOne, Upstox, Shoonya, Fyers):

**Files per broker (e.g., Zerodha):**

```
packages/broker-sdk/zerodha/
├── adapter.ts                  — Implements BrokerAdapter
├── session-manager.ts          — Zerodha-specific session handling
├── http-client.ts              — Zerodha API client
├── types.ts                    — Zerodha response types
├── validators.ts               — Zerodha-specific validators
└── __tests__/                  — Unit tests
```

**Implementation Pattern:**

1. Extend SessionManager with broker-specific logic
2. Create HTTP client with rate limiting, retries
3. Implement all BrokerAdapter methods
4. Add credential encryption for sensitive data
5. Add comprehensive error handling

**Priority Order:**

1. **Zerodha** (most popular in India)
2. **AngelOne** (active retail traders)
3. **Upstox** (good API coverage)
4. **Shoonya** (good for automation)
5. **Fyers** (alternate option)

### 5.2 Implement Adapters Incrementally

**For each adapter:**

- [ ] Create session management
- [ ] Implement login/logout/refresh
- [ ] Implement getProfile
- [ ] Implement getFunds
- [ ] Implement getPositions/getHoldings
- [ ] Implement placeOrder/modifyOrder/cancelOrder
- [ ] Implement subscribeMarketData
- [ ] Add error handling & retries
- [ ] Add unit tests (90%+ coverage)
- [ ] Add integration tests against mock broker APIs

---

## Phase 6: Market Data Provider Layer (Week 4)

### 6.1 Create Market Data Provider Interface

**Location:** `packages/broker-sdk/common/interfaces/market-data-provider.ts`

```typescript
export interface MarketDataProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getLtp(symbol: string): Promise<number>;
  getHistoricalData(symbol: string, period: Period): Promise<Candle[]>;
  on(event: string, handler: Function): void;
}
```

### 6.2 Implement Market Data Providers

**Providers to implement:**

1. **YahooProvider** (already exists, refactor into new interface)
2. **SimulatedProvider** (already exists, refactor)
3. **ZerodhaProvider** (WebSocket + REST)
4. **AngelOneProvider** (WebSocket)
5. **UpstoxProvider** (WebSocket)
6. **ShoonyaProvider** (WebSocket)

**Location:** `packages/broker-sdk/*/market-data-provider.ts`

---

## Phase 7: Kafka Event Contracts (Week 4)

### 7.1 Define Event Contracts

**Location:** `packages/shared-events/`

**New Topics & DTOs:**

```typescript
// broker.login
interface BrokerLoginEvent {
  brokerAccountId: string;
  brokerId: string;
  timestamp: number;
  status: 'success' | 'failure';
  error?: string;
}

// broker.connected
interface BrokerConnectedEvent {
  brokerAccountId: string;
  sessionToken: string;
  expiresAt: number;
}

// broker.order.created
interface BrokerOrderCreatedEvent {
  brokerAccountId: string;
  orderId: string;
  externalOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: OrderStatus;
  timestamp: number;
}

// broker.order.updated
interface BrokerOrderUpdatedEvent {
  brokerAccountId: string;
  orderId: string;
  externalOrderId: string;
  status: OrderStatus;
  executedQuantity: number;
  executedPrice: number;
  timestamp: number;
}

// broker.position.updated
interface BrokerPositionUpdatedEvent {
  brokerAccountId: string;
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  timestamp: number;
}

// broker.holdings.updated
interface BrokerHoldingsUpdatedEvent {
  brokerAccountId: string;
  holdings: { symbol: string; quantity: number; pledgeQuantity: number }[];
  timestamp: number;
}

// broker.funds.updated
interface BrokerFundsUpdatedEvent {
  brokerAccountId: string;
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  timestamp: number;
}
```

### 7.2 Create Kafka Producers

**Location:** `packages/shared-events/producers/`

- [ ] BrokerEventProducer class
- [ ] Methods for emitting each event type
- [ ] Schema validation before publish

### 7.3 Create Kafka Consumers

**Location:** `apps/broker-integration-service/src/kafka/consumers/`

- [ ] Consume broker.order.created → update DB
- [ ] Consume broker.position.updated → update DB
- [ ] Consume broker.funds.updated → update DB

---

## Phase 8: Auto-Trader Integration (Week 4-5)

### 8.1 Update Auto-Trader Service

**Location:** `apps/auto-trader/`

**Changes:**

- [ ] Inject BrokerRouter (factory pattern)
- [ ] Update order placement logic:
  ```typescript
  // Before: Direct order to virtual ledger
  // After: Route through BrokerRouter to appropriate adapter
  ```
- [ ] Add broker account selection logic
- [ ] Update position sync to consume broker events
- [ ] Maintain existing signal/pattern/ML gates

**Key Point:** Auto-Trader remains broker-agnostic

### 8.2 Create Broker Router

**Location:** `apps/broker-integration-service/src/services/broker-router.ts`

```typescript
export class BrokerRouter {
  async placeOrder(
    brokerAccountId: string,
    order: OrderRequest
  ): Promise<OrderResponse> {
    const adapter = await this.getAdapter(brokerAccountId);
    return adapter.placeOrder(order);
  }

  async modifyOrder(brokerAccountId: string, ...): Promise<void> { }
  async cancelOrder(brokerAccountId: string, ...): Promise<void> { }
}
```

---

## Phase 9: Frontend Extensions (Week 5)

### 9.1 Create Broker Management Pages

**Location:** `apps/frontend-react/src/pages/`

**New Pages:**

- [ ] `/brokers` — List connected brokers
- [ ] `/brokers/connect` — Connect new broker (OAuth flow)
- [ ] `/brokers/accounts` — Manage broker accounts
- [ ] `/brokers/orders` — Monitor live orders
- [ ] `/brokers/positions` — Real-time positions
- [ ] `/brokers/holdings` — Holdings view

### 9.2 Create Components

**Location:** `apps/frontend-react/src/components/`

- [ ] `BrokerSelector` — Choose active broker for trading
- [ ] `BrokerStatus` — Connection status indicator
- [ ] `OrderMonitor` — Real-time order feed
- [ ] `PositionMonitor` — Live position updates
- [ ] `HoldingsTable` — Holdings display
- [ ] `BrokerConnectDialog` — OAuth connection flow

### 9.3 Add RTK Query Endpoints

**Location:** `apps/frontend-react/src/api/`

```typescript
// Broker management
getConnectedBrokers();
getBrokerAccounts();
connectBroker(brokerType);
disconnectBroker(brokerAccountId);

// Broker operations
getBrokerOrders();
getBrokerPositions();
getBrokerHoldings();
getBrokerFunds();
placeBrokerOrder();
modifyBrokerOrder();
cancelBrokerOrder();
```

### 9.4 Add Socket.IO Events

**Events:**

- `broker-connected`
- `broker-disconnected`
- `broker-order-created`
- `broker-order-updated`
- `broker-position-updated`
- `broker-holdings-updated`
- `broker-funds-updated`

---

## Phase 10: Testing & Validation (Week 5-6)

### 10.1 Unit Tests

**Target:** 90%+ coverage per package

**Packages to test:**

- `broker-sdk/common/` — Interfaces, validators, encryption
- `broker-sdk/paper/` — Virtual ledger, market simulator
- `broker-sdk/*/` — Each adapter
- `apps/broker-integration-service/` — Services, controllers

### 10.2 Integration Tests

**Setup:** Docker Compose with test brokers

**Test Scenarios:**

- [ ] Session management (login, token refresh, disconnect)
- [ ] Order flow (place → execute → settle)
- [ ] Position sync (update → broadcast)
- [ ] Funds sync
- [ ] Error recovery
- [ ] Kafka event publishing

### 10.3 Contract Tests

**Tool:** Pact.js

**Contracts:**

- [ ] Auto-Trader ↔ Broker Integration Service
- [ ] Broker Integration Service ↔ Paper Trading Adapter
- [ ] Kafka producers/consumers

### 10.4 E2E Tests (Cypress)

**Location:** `apps/frontend-react/cypress/e2e/`

**Tests:**

- [ ] Connect broker flow
- [ ] Place order flow
- [ ] Monitor positions
- [ ] View orders
- [ ] Disconnect broker

---

## Phase 11: Monitoring & Observability (Week 6)

### 11.1 Add Prometheus Metrics

**Location:** `apps/broker-integration-service/src/metrics/`

**Metrics:**

```
broker_login_latency_ms (histogram)
broker_order_latency_ms (histogram)
broker_reconnect_count (counter)
broker_api_errors_total (counter)
broker_session_expired_count (counter)
broker_position_sync_latency_ms (histogram)
broker_quote_latency_ms (histogram)
```

### 11.2 Create Grafana Dashboards

**Dashboards:**

- [ ] Broker Connectivity (login/disconnect events)
- [ ] Order Metrics (latency, success rate)
- [ ] Position Sync (lag, update frequency)
- [ ] Error Tracking (API errors, session failures)

### 11.3 Health Checks

**Endpoints:**

```
GET /health                    → Overall health
GET /health/brokers           → Broker connections
GET /health/kafka             → Kafka connectivity
GET /health/database          → DB connectivity
```

---

## Phase 12: Docker & Deployment (Week 6)

### 12.1 Create Broker Integration Service Dockerfile

**Location:** `infrastructure/docker/broker-integration-service.Dockerfile`

**Requirements:**

- Node 20+
- Multi-stage build
- Non-root user
- Health check endpoint
- Memory limits

### 12.2 Update docker-compose.yml

**Add:**

```yaml
broker-integration-service:
  build:
    context: .
    dockerfile: infrastructure/docker/broker-integration-service.Dockerfile
  ports:
    - '3008:3008'
  environment:
    - DATABASE_URL=postgresql://...
    - KAFKA_BROKERS=kafka:9092
    - JWT_SECRET=...
  depends_on:
    - postgres
    - kafka
  healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:3008/health']
    interval: 10s
    timeout: 5s
    retries: 3
```

### 12.3 Environment Variables

**Add to `.env.example`:**

```bash
# Broker Integration Service
BROKER_INTEGRATION_SERVICE_PORT=3008
BROKER_SESSION_TIMEOUT_MINUTES=240
BROKER_HEARTBEAT_INTERVAL_SECONDS=30

# Encryption
BROKER_ENCRYPTION_KEY=<your-256-bit-key>

# Broker Config (per broker)
ZERODHA_BASE_URL=https://api.kite.trade
ANGELONE_BASE_URL=https://api.angelone.in
# ... etc
```

---

## Phase 13: CI/CD Updates (Week 6)

### 13.1 Update GitHub Actions

**Location:** `.github/workflows/`

**Updates to `ci.yml`:**

- [ ] Add lint for broker-sdk package
- [ ] Add tests for broker-sdk + broker-integration-service
- [ ] Ensure coverage ≥ 90%
- [ ] Add security scan (npm audit, Trivy)
- [ ] Build broker-integration-service Docker image
- [ ] Push to registry

**Add new workflow: `broker-tests.yml`**

- Run broker adapter tests in parallel
- Test against mock broker APIs
- Report test results

---

## Phase 14: Documentation & Handoff (Week 6-7)

### 14.1 Update architect.md

**Changes:**

- [ ] Add Broker Integration Service to topology
- [ ] Update services table with new service
- [ ] Document BrokerAdapter pattern
- [ ] Document Paper Trading Engine
- [ ] Add new Kafka topics
- [ ] Update API routes

### 14.2 Create API Documentation

**Location:** `docs/api/`

**Files:**

- [ ] Broker Management API (Swagger)
- [ ] Order API (Swagger)
- [ ] Position API (Swagger)
- [ ] Holding API (Swagger)

### 14.3 Create Developer Guide

**Location:** `docs/developer/`

- [ ] How to add a new broker adapter
- [ ] How to configure brokers
- [ ] How to test broker integrations
- [ ] Troubleshooting guide

### 14.4 Create Runbooks

**Location:** `docs/runbooks/`

- [ ] Connect a broker account
- [ ] Configure live trading
- [ ] Monitor broker connectivity
- [ ] Recover from session failure
- [ ] Scale broker services

---

## Success Criteria Checklist

### Architecture & Design

- [ ] ADR documents complete
- [ ] BrokerAdapter interface finalized
- [ ] Package structure approved
- [ ] Event contracts defined

### Implementation

- [ ] Paper Trading Adapter complete (90%+ tests)
- [ ] Broker Integration Service complete
- [ ] At least 2 real broker adapters (Zerodha + 1 other)
- [ ] Database migrations applied
- [ ] Kafka event flow working
- [ ] Auto-Trader integration complete

### Frontend

- [ ] Broker management pages created
- [ ] Real-time updates working
- [ ] Paper trading trades executing
- [ ] UI tests passing

### Testing & Quality

- [ ] Unit test coverage ≥ 90%
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] No security vulnerabilities
- [ ] Docker build succeeding

### Deployment

- [ ] Docker Compose works
- [ ] All services start successfully
- [ ] Health checks passing
- [ ] Logs are structured
- [ ] Monitoring dashboards working

### Documentation

- [ ] Architecture documented
- [ ] APIs documented
- [ ] Developer guide complete
- [ ] Runbooks created
- [ ] README updated

---

## Risk Mitigation

| Risk                        | Mitigation                                                       |
| --------------------------- | ---------------------------------------------------------------- |
| Breaking existing services  | Use adapter pattern, comprehensive integration tests             |
| Performance degradation     | Profile under load, add caching, use connection pooling          |
| Broker API changes          | Abstract broker APIs, version API contracts, monitor for changes |
| Credential exposure         | Use AES-256-GCM encryption, rotate keys, audit access logs       |
| Session management failures | Implement robust SessionManager, auto-reconnect, circuit breaker |
| Data sync inconsistencies   | Use idempotent operations, versioned events, reconciliation jobs |

---

## Timeline Summary

| Phase | Duration  | Deliverable                                            |
| ----- | --------- | ------------------------------------------------------ |
| 1     | 1 week    | ADRs, interfaces, package plan                         |
| 2     | 1 week    | Broker SDK common, Broker Integration Service skeleton |
| 3     | 1-2 weeks | Paper Trading Adapter                                  |
| 4     | 1 week    | Database schema                                        |
| 5     | 1-2 weeks | Real broker adapters (Zerodha, AngelOne, etc.)         |
| 6     | 1 week    | Market Data Provider Layer                             |
| 7     | 1 week    | Kafka event contracts                                  |
| 8     | 1 week    | Auto-Trader integration                                |
| 9     | 1 week    | Frontend extensions                                    |
| 10    | 1 week    | Testing & validation                                   |
| 11    | 1 week    | Monitoring & observability                             |
| 12    | 1 week    | Docker & deployment                                    |
| 13    | 1 week    | CI/CD updates                                          |
| 14    | 1 week    | Documentation & handoff                                |

**Total Estimated Time:** 14-16 weeks (production-ready)

---

## Next Steps

1. **Review this plan** with the team
2. **Approve Phase 1** (ADRs and interfaces)
3. **Set up phase 1 work:** Create ADR documents and core interfaces
4. **Begin phase 2:** Implement Broker SDK common package and service skeleton

---

**Questions?** Review `implement-paper-trading.md` for detailed requirements.
