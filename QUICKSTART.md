# Quick Start: Begin Phase 1 Now

**Status:** Ready to execute  
**Duration:** 5 days (1 week)  
**Effort:** 1 person, high focus  
**Blocker:** None

---

## What is Phase 1?

Create the **architecture blueprint** for broker integration.

- 5 Architecture Decision Records (ADRs)
- Core interfaces (BrokerAdapter, MarketDataProvider)
- Package structure
- Team alignment

**Output:** Clear design docs + team consensus to proceed.

---

## Setup (5 minutes)

### 1. Create docs/adr directory

```bash
mkdir -p docs/adr
```

### 2. Create broker-sdk package skeleton

```bash
mkdir -p packages/broker-sdk/common/{interfaces,types,enums,validators,encryption,errors}
mkdir -p packages/broker-sdk/{paper,angelone,shoonya,upstox,zerodha,fyers}

# Create package.json
cd packages/broker-sdk
cat > package.json << 'EOF'
{
  "name": "@stockpred/broker-sdk",
  "version": "0.1.0",
  "description": "Broker abstraction layer and adapters",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@stockpred/shared-types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^1.0.0"
  }
}
EOF
```

### 3. Create broker-integration-service skeleton

```bash
mkdir -p apps/broker-integration-service/src/{config,controllers,services,kafka,middleware}

cd apps/broker-integration-service
cat > package.json << 'EOF'
{
  "name": "@stockpred/broker-integration-service",
  "version": "0.1.0",
  "description": "Broker integration service",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "ts-node src/main.ts",
    "test": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.2.0",
    "@stockpred/broker-sdk": "workspace:*",
    "@stockpred/shared-events": "workspace:*",
    "@stockpred/shared-types": "workspace:*"
  }
}
EOF
```

---

## Day 1: ADR Documents (1-2 hours each)

Create 5 markdown files in `docs/adr/`

### ADR-001: Broker Architecture

**File:** `docs/adr/ADR-001-Broker-Architecture.md`

Copy from PHASE_1_TASKS.md Task 1.1.1 → write complete ADR

**Key sections:**

- Problem: How to support 5+ brokers?
- Solution: Adapter pattern + BrokerAdapter interface
- Benefits: Single logic, multiple implementations
- Sequence diagram: Order flow through adapters

**Acceptance:** ✅ Complete, 2-3 pages

---

### ADR-002: Paper Trading

**File:** `docs/adr/ADR-002-Paper-Trading.md`

**Key sections:**

- Virtual capital simulation
- Order fill simulation (market price)
- Margin & PnL calculation
- Why paper trading is essential

**Acceptance:** ✅ Complete, 2-3 pages

---

### ADR-003: Market Data Providers

**File:** `docs/adr/ADR-003-Market-Data-Providers.md`

**Key sections:**

- MarketDataProvider interface
- 6 implementations (Yahoo, Simulated, Zerodha, AngelOne, Upstox, Shoonya)
- Fallback strategy
- Latency targets

**Acceptance:** ✅ Complete, 2-3 pages

---

### ADR-004: Broker Security

**File:** `docs/adr/ADR-004-Broker-Security.md`

**Key sections:**

- Credential encryption (AES-256-GCM)
- Key rotation process
- Credential lifecycle
- Security controls

**Acceptance:** ✅ Complete, 2-3 pages

---

### ADR-005: Kafka Event Contracts

**File:** `docs/adr/ADR-005-Kafka-Event-Contracts.md`

**Key sections:**

- Event envelope structure
- 10+ event types (broker.login, broker.order.created, etc.)
- Versioning strategy
- Schema validation

**Acceptance:** ✅ Complete, 2-3 pages

---

## Days 2-3: Core Interfaces (2-3 hours each)

### Create BrokerAdapter Interface

**File:** `packages/broker-sdk/common/interfaces/broker-adapter.ts`

```typescript
export interface BrokerAdapter {
  // Session
  login(): Promise<void>;
  logout(): Promise<void>;
  refreshToken(): Promise<void>;

  // Account
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<BrokerFunds>;
  getPositions(): Promise<BrokerPosition[]>;
  getHoldings(): Promise<BrokerHolding[]>;

  // Orders
  placeOrder(request: OrderRequest): Promise<OrderResponse>;
  modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<void>;

  // Market Data
  subscribeMarketData(symbols: string[]): Promise<void>;
  unsubscribeMarketData(symbols: string[]): Promise<void>;

  // Events
  on(event: string, handler: Function): void;
}
```

**Acceptance:** ✅ Interface with full JSDoc, types match all brokers

---

### Create Domain Types

**File:** `packages/broker-sdk/common/types/index.ts`

```typescript
export interface BrokerProfile {
  id: string;
  name: string;
  email: string;
  brokerId: string;
  brokerName: string;
}

export interface BrokerFunds {
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  mode: 'CNC' | 'MIS' | 'NRML';
}

export interface BrokerHolding {
  symbol: string;
  quantity: number;
  pledgeQuantity: number;
  currentPrice: number;
  value: number;
}

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  product?: 'MIS' | 'CNC' | 'NRML';
}

export interface OrderResponse {
  orderId: string;
  externalOrderId: string;
  status: OrderStatus;
  timestamp: number;
}

export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIAL' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';

export interface OrderModification {
  price?: number;
  quantity?: number;
  triggerPrice?: number;
}
```

**Acceptance:** ✅ All types defined, covers 5+ brokers

---

### Create Enums

**File:** `packages/broker-sdk/common/enums/index.ts`

```typescript
export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  SL = 'SL',
  SL_M = 'SL-M',
}

export enum OrderValidity {
  DAY = 'DAY',
  IOC = 'IOC',
  GTC = 'GTC',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIAL = 'PARTIAL',
  EXECUTED = 'EXECUTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum PositionMode {
  CNC = 'CNC',
  MIS = 'MIS',
  NRML = 'NRML',
}

export enum BrokerType {
  PAPER = 'PAPER',
  ZERODHA = 'ZERODHA',
  ANGELONE = 'ANGELONE',
  UPSTOX = 'UPSTOX',
  SHOONYA = 'SHOONYA',
  FYERS = 'FYERS',
}
```

**Acceptance:** ✅ All enums defined, covers all brokers

---

### Create SessionManager Base Class

**File:** `packages/broker-sdk/common/session-manager.ts`

```typescript
export abstract class SessionManager {
  protected sessionToken?: string;
  protected refreshToken?: string;
  protected expiresAt: number = 0;
  protected reconnectAttempts: number = 0;
  protected circuitBreakerOpen: boolean = false;

  abstract authenticate(): Promise<void>;
  abstract refreshAccessToken(): Promise<void>;
  abstract isTokenExpired(): boolean;

  async ensureActive(): Promise<void> {
    if (this.circuitBreakerOpen) {
      throw new Error('Circuit breaker open');
    }
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  async startHeartbeat(intervalSecs: number): Promise<void> {
    setInterval(async () => {
      try {
        await this.ensureActive();
      } catch (e) {
        console.error('Heartbeat failed:', e);
      }
    }, intervalSecs * 1000);
  }

  async reconnect(): Promise<void> {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s... max 10 retries
  }

  isHealthy(): boolean {
    return !this.circuitBreakerOpen && !this.isTokenExpired();
  }
}
```

**Acceptance:** ✅ Abstract class, extendable per broker

---

## Days 4-5: Structure & Documentation

### Create Package Structure

```bash
# Already done above, but verify:
ls -la packages/broker-sdk/common/
ls -la apps/broker-integration-service/src/

# Should see:
# packages/broker-sdk/common/
#   ├── interfaces/
#   ├── types/
#   ├── enums/
#   └── session-manager.ts

# apps/broker-integration-service/
#   ├── src/
#   │   ├── main.ts
#   │   ├── config/
#   │   ├── controllers/
#   │   ├── services/
#   │   ├── kafka/
#   │   └── middleware/
```

### Update architect.md

**File:** `.claude/commands/architect.md`

Add this section before "## Summary":

```markdown
### 11. Broker Integration Service (:3008)

**Role:** Broker abstraction layer, order routing, session management.

**Architecture:**

- Adapter pattern for multi-broker support
- SessionManager for connection lifecycle
- BrokerRouter for intelligent order routing
- Paper Trading Adapter as default

**Brokers Supported:**

- Paper Trading (default, no connectivity)
- Zerodha (OAuth, WebSocket)
- AngelOne (API key, WebSocket)
- Upstox (OAuth, WebSocket)
- Shoonya (API key, WebSocket)
- Fyers (API key, REST)

**Bootstrap:**

- Port: `BROKER_INTEGRATION_SERVICE_PORT` (default 3008)
- Default broker: `BROKER_DEFAULT_TYPE` (default PAPER)
- Database: Prisma (broker_accounts, broker_sessions, broker_orders, etc.)

**HTTP Routes:**

| Method | Path                 | Purpose                  |
| ------ | -------------------- | ------------------------ |
| POST   | `/brokers/login`     | Authenticate with broker |
| POST   | `/brokers/logout`    | Logout from broker       |
| GET    | `/brokers/profile`   | Get broker profile       |
| GET    | `/brokers/funds`     | Get funds snapshot       |
| GET    | `/brokers/positions` | Get open positions       |
| GET    | `/brokers/holdings`  | Get holdings             |
| POST   | `/orders`            | Place order              |
| PUT    | `/orders/:id`        | Modify order             |
| DELETE | `/orders/:id`        | Cancel order             |
| GET    | `/health`            | Health check             |

**Kafka Integration:**

Consumes:

- `trade.executed` (from auto-trader) → Route to broker

Produces:

- `broker.login` → Auth events
- `broker.order.created` → Order placement
- `broker.order.updated` → Order fills
- `broker.position.updated` → Position sync
- `broker.holdings.updated` → Holdings sync
- `broker.funds.updated` → Funds sync
```

---

## Verification Checklist (End of Day 5)

Run these commands to verify completion:

```bash
# 1. Check ADR documents exist
ls -la docs/adr/ADR-*.md
# Should output 5 files

# 2. Check package structure
ls -la packages/broker-sdk/common/interfaces/
ls -la packages/broker-sdk/common/types/
ls -la packages/broker-sdk/common/enums/
# All should exist

# 3. Check service structure
ls -la apps/broker-integration-service/src/
# Should have config, controllers, services, kafka, middleware

# 4. Verify package.json files
cat packages/broker-sdk/package.json | grep -A2 '"name"'
cat apps/broker-integration-service/package.json | grep -A2 '"name"'

# 5. Verify interfaces exist
test -f packages/broker-sdk/common/interfaces/broker-adapter.ts && echo "✅ BrokerAdapter exists"
test -f packages/broker-sdk/common/types/index.ts && echo "✅ Types exist"
test -f packages/broker-sdk/common/enums/index.ts && echo "✅ Enums exist"
test -f packages/broker-sdk/common/session-manager.ts && echo "✅ SessionManager exists"
```

---

## Success Criteria

Phase 1 is complete when:

- ✅ All 5 ADR documents written (8-15 pages total)
- ✅ BrokerAdapter interface defined
- ✅ Domain types, enums, base classes created
- ✅ Package structure ready (`packages/broker-sdk/`, `apps/broker-integration-service/`)
- ✅ architect.md updated with Broker Integration Service
- ✅ Team has reviewed and approved architecture
- ✅ Team ready to proceed to Phase 2

---

## What Happens Next (Phase 2)

After Phase 1 sign-off:

**Week 2:** Build the actual code

- Implement common package (encryption, validation, errors)
- Create SessionManager implementations
- Scaffold Broker Integration Service with NestJS

**Then:** Implement adapters, paper trading, database migrations, Kafka events, etc.

---

## Time Estimate

| Day          | Task                          | Hours           |
| ------------ | ----------------------------- | --------------- |
| **Day 1**    | Write 5 ADRs                  | 6-8             |
| **Days 2-3** | Code interfaces & types       | 4-6             |
| **Days 4-5** | Setup structure, docs, review | 4-6             |
| **Total**    |                               | **14-20 hours** |

**For 1 dedicated person:** 2-3 days full focus (or 1 week part-time)

---

## File Checklist

By end of Phase 1, you'll have created:

**Documentation**

- [ ] `docs/adr/ADR-001-Broker-Architecture.md`
- [ ] `docs/adr/ADR-002-Paper-Trading.md`
- [ ] `docs/adr/ADR-003-Market-Data-Providers.md`
- [ ] `docs/adr/ADR-004-Broker-Security.md`
- [ ] `docs/adr/ADR-005-Kafka-Event-Contracts.md`

**Code**

- [ ] `packages/broker-sdk/package.json`
- [ ] `packages/broker-sdk/tsconfig.json`
- [ ] `packages/broker-sdk/common/interfaces/broker-adapter.ts`
- [ ] `packages/broker-sdk/common/interfaces/market-data-provider.ts`
- [ ] `packages/broker-sdk/common/types/index.ts`
- [ ] `packages/broker-sdk/common/enums/index.ts`
- [ ] `packages/broker-sdk/common/session-manager.ts`
- [ ] `packages/broker-sdk/common/errors/index.ts`
- [ ] `apps/broker-integration-service/package.json`
- [ ] `apps/broker-integration-service/tsconfig.json`
- [ ] `apps/broker-integration-service/src/main.ts` (skeleton)

**Updated**

- [ ] `.claude/commands/architect.md` (add Broker Integration Service section)
- [ ] `IMPLEMENTATION_PLAN.md` (created)
- [ ] `PHASE_1_TASKS.md` (created)
- [ ] `QUICKSTART.md` (this file)

---

## Questions?

Refer to:

1. **PHASE_1_TASKS.md** for detailed day-by-day breakdown
2. **IMPLEMENTATION_PLAN.md** for full 14-phase roadmap
3. **implement-paper-trading.md** for original requirements

---

**Ready to start? Begin with Day 1: Write the 5 ADR documents.** ✅
