# Phase 1: Architecture & Documentation - Detailed Task Breakdown

**Duration:** 1 week (5 working days)  
**Priority:** HIGH (blocks all subsequent phases)  
**Team Size:** 1-2 people

---

## Day 1: ADR Documents

### Task 1.1.1: Create ADR-001-Broker-Architecture.md

**File:** `docs/adr/ADR-001-Broker-Architecture.md`

**Sections:**

```markdown
# ADR 001: Broker Architecture

## Status

PROPOSED

## Context

StockPred needs to support multiple brokers (Zerodha, AngelOne, Upstox, Shoonya, Fyers)
while maintaining a single Auto-Trader implementation.

## Problem

Without abstraction, adding each broker requires modifying core trading logic.
Code duplication and tight coupling to broker APIs.

## Decision

Implement Adapter Pattern with BrokerAdapter interface.

- One interface, multiple implementations
- SessionManager for connection lifecycle
- Factory pattern for broker instantiation
- Event-driven architecture via Kafka

## Architecture Diagram

[Include diagram showing adapter pattern]

## Benefits

- Single business logic, multiple brokers
- Adding new broker = 1 new adapter file
- Auto-Trader remains broker-agnostic
- Paper trading as default fallback

## Consequences

- Additional abstraction layer (minimal overhead)
- Broker API diversity requires careful interface design
- Session management complexity

## Alternatives Considered

1. Direct broker integration (rejected: tight coupling)
2. Separate trading engines per broker (rejected: code duplication)

## References

- Strategy Pattern (Gang of Four)
- Dependency Injection Pattern

## Related ADRs

- ADR-004-Broker-Security.md
- ADR-005-Kafka-Event-Contracts.md
```

**Acceptance Criteria:**

- [ ] Document explains adapter pattern clearly
- [ ] Includes sequence diagram for order flow
- [ ] Addresses broker API diversity
- [ ] Session management strategy outlined
- [ ] References design patterns used

---

### Task 1.1.2: Create ADR-002-Paper-Trading.md

**File:** `docs/adr/ADR-002-Paper-Trading.md`

**Key Sections:**

```markdown
# ADR 002: Paper Trading Engine

## Status

PROPOSED

## Context

StockPred must support paper trading by default with live trading opt-in.
Paper trading needs to feel realistic without broker connectivity.

## Decision

Create PaperTradingAdapter implementing BrokerAdapter interface.

- Virtual capital (default 1M INR)
- Virtual positions/orders/holdings
- Market price-based order fills
- Full margin & PnL simulation

## Implementation Strategy

Virtual Ledger:

- Manages capital, cash, positions, orders
- Tracks margin usage
- Calculates PnL (realized/unrealized)

Market Simulator:

- Fetches live prices from market-data-service
- Simulates realistic order fills
- Adds slippage simulation

Benefits:

- Works offline (no broker dependency)
- Identical interface to real brokers
- Perfect for testing/learning
- No API rate limits

## Virtual Order Flow

[Include state diagram: PENDING → EXECUTED/REJECTED]

## Margin Calculation

- Available Cash = Total Capital - Used Margin
- Margin Used = Sum of (Position Value / Multiplier)

## PnL Calculation

- Unrealized = Position Value - Invested Capital
- Realized = Sum of closed trade PnLs
```

**Acceptance Criteria:**

- [ ] Virtual ledger design documented
- [ ] Order flow state diagram included
- [ ] Margin calculation formula clear
- [ ] PnL calculation examples provided
- [ ] Comparison with live broker behavior

---

### Task 1.1.3: Create ADR-003-Market-Data-Providers.md

**File:** `docs/adr/ADR-003-Market-Data-Providers.md`

**Key Sections:**

````markdown
# ADR 003: Market Data Provider Layer

## Status

PROPOSED

## Context

Platform needs multiple market data sources:

- Yahoo Finance (reference/dev)
- Simulated (offline dev)
- Broker APIs (Zerodha, AngelOne, Upstox, Shoonya)

## Decision

Create MarketDataProvider interface with pluggable implementations.

- Unified abstraction for all sources
- Real-time updates via WebSocket/polling
- Historical data fetch capability

## Provider Implementations

1. **YahooProvider** — HTTP REST, rate limited
2. **SimulatedProvider** — GBM-based synthetic data
3. **ZerodhaProvider** — WebSocket live, REST historical
4. **AngelOneProvider** — WebSocket live
5. **UpstoxProvider** — WebSocket live
6. **ShoonyaProvider** — WebSocket live

## Interface Contract

```typescript
interface MarketDataProvider {
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
````

## Latency Targets

- Real-time quotes: <500ms
- Historical data fetch: <2s per 1000 bars
- Subscribe/unsubscribe: <1s

## Fallback Strategy

If primary provider fails:

1. Try secondary provider
2. Use cached data
3. Return last known price

## Configuration

Environment-based provider selection:

```
MARKET_DATA_PROVIDER=zerodha|angelone|yahoo|simulated
```

````

**Acceptance Criteria:**
- [ ] Interface clearly defined
- [ ] All 6 providers listed with capabilities
- [ ] Latency targets specified
- [ ] Fallback strategy documented
- [ ] Configuration approach defined

---

### Task 1.1.4: Create ADR-004-Broker-Security.md

**File:** `docs/adr/ADR-004-Broker-Security.md`

**Key Sections:**
```markdown
# ADR 004: Broker Security & Credential Management

## Status
PROPOSED

## Context
Brokers require sensitive credentials:
- API keys
- OAuth tokens
- Session tokens
- Passwords (for some brokers)

Storing plaintext = data breach risk.

## Decision
Use AES-256-GCM encryption for all credentials.
- 256-bit keys
- Authenticated encryption (GCM mode)
- Key rotation capability
- Audit logging

## Credential Storage Hierarchy
1. **Encryption Key** → Environment variable (rotated by ops team)
2. **Encrypted Credentials** → PostgreSQL (broker_tokens table)
3. **Session Tokens** → Encrypted in broker_sessions table
4. **Refresh Tokens** → Encrypted + hashed in broker_sessions table

## Encryption Flow
````

Plain Credential + Master Key
→ encrypt(AES-256-GCM)
→ ciphertext + nonce + tag
→ Store in DB

```

## Decryption Flow
```

DB ciphertext + nonce + tag
→ decrypt(AES-256-GCM, Master Key)
→ Plaintext credential (in memory)
→ Use for auth
→ Discard after use

```

## Key Rotation Process
1. Generate new master key
2. Decrypt all credentials with old key
3. Re-encrypt with new key
4. Update master key reference
5. Audit trail recorded

## Credential Lifecycle
- Creation: Encrypt on receive
- Storage: Always encrypted at rest
- Usage: Decrypt in memory only
- Rotation: Re-encrypt with new key
- Revocation: Physically delete from DB

## Security Controls
- Never log plaintext credentials
- Credentials cleared from memory after use
- API keys never returned to frontend
- Broker tokens never stored in localStorage
- Session tokens have expiration + rotation

## Implementation Classes
1. **CredentialEncryptor** — Encrypt/decrypt operations
2. **CredentialManager** — Lifecycle management
3. **TokenRotationService** — Automatic token refresh
```

**Acceptance Criteria:**

- [ ] Encryption scheme clearly documented
- [ ] Key rotation process detailed
- [ ] Credential lifecycle diagram included
- [ ] Security controls listed
- [ ] Audit logging requirements specified

---

### Task 1.1.5: Create ADR-005-Kafka-Event-Contracts.md

**File:** `docs/adr/ADR-005-Kafka-Event-Contracts.md`

**Key Sections:**

````markdown
# ADR 005: Kafka Event Contracts

## Status

PROPOSED

## Context

Broker Integration Service and Auto-Trader communicate via Kafka.
Event schema changes can break services.

## Decision

Define formal event contracts with versioning.

- Strong typing (TypeScript interfaces)
- Schema validation (Zod/Joi)
- Backward compatibility strategy
- Version in event envelope

## Event Envelope

All Kafka events wrap in envelope:

```typescript
interface EventEnvelope<T> {
  eventId: string; // UUID, idempotency key
  timestamp: number; // ms since epoch
  source: string; // service name
  type: string; // e.g., "broker.order.created"
  version: string; // semver, e.g., "1.0.0"
  data: T; // payload
}
```
````

## Event Topics

### broker.login (Broker Integration Service → All)

```typescript
interface BrokerLoginEvent {
  brokerAccountId: string;
  brokerId: string;
  brokerName: string;
  externalAccountId?: string;
  status: 'success' | 'failure';
  error?: string;
  timestamp: number;
}
```

### broker.connected (Broker Integration Service → All)

```typescript
interface BrokerConnectedEvent {
  brokerAccountId: string;
  brokerId: string;
  sessionToken?: string; // may be undefined
  expiresAt: number;
  timestamp: number;
}
```

### broker.order.created (Broker Integration Service → Auto-Trader + API Gateway)

```typescript
interface BrokerOrderCreatedEvent {
  brokerAccountId: string;
  orderId: string;
  externalOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  status: OrderStatus;
  timestamp: number;
}
```

### broker.order.updated (Broker Integration Service → Auto-Trader + API Gateway)

```typescript
interface BrokerOrderUpdatedEvent {
  brokerAccountId: string;
  orderId: string;
  externalOrderId: string;
  status: OrderStatus;
  executedQuantity: number;
  executedPrice: number;
  averagePrice: number;
  rejectionReason?: string;
  timestamp: number;
}
```

### broker.position.updated (Broker Integration Service → Frontend)

```typescript
interface BrokerPositionUpdatedEvent {
  brokerAccountId: string;
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
}
```

### broker.holdings.updated (Broker Integration Service → Frontend)

```typescript
interface BrokerHoldingsUpdatedEvent {
  brokerAccountId: string;
  holdings: Array<{
    symbol: string;
    quantity: number;
    pledgeQuantity: number;
    currentPrice: number;
    value: number;
  }>;
  timestamp: number;
}
```

### broker.funds.updated (Broker Integration Service → Frontend + Auto-Trader)

```typescript
interface BrokerFundsUpdatedEvent {
  brokerAccountId: string;
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number;
  timestamp: number;
}
```

## Versioning Strategy

- New fields: Add as optional, increment minor version (1.0.0 → 1.1.0)
- Breaking changes: New major version (1.0.0 → 2.0.0)
- Consumers must handle version mismatches gracefully
- Old versions deprecated after 2 releases

## Schema Validation

All events validated against schema before publish:

```typescript
const brokerOrderSchema = z.object({
  brokerAccountId: z.string().uuid(),
  orderId: z.string(),
  symbol: z.string().min(1),
  quantity: z.number().int().positive(),
  // ... more fields
});
```

## Error Handling

If schema validation fails:

1. Log error with full context
2. Emit to dead-letter-queue
3. Alert monitoring system
4. DO NOT crash consumer

## Ordering Guarantees

- Key: brokerAccountId (all events for account go to same partition)
- Ensures order.created always processed before order.updated

````

**Acceptance Criteria:**
- [ ] Event envelope structure defined
- [ ] All 10+ event types documented
- [ ] Event payloads detailed with examples
- [ ] Versioning strategy explained
- [ ] Schema validation approach defined
- [ ] Error handling strategy documented

---

## Day 2-3: Core Interfaces

### Task 1.2.1: Create BrokerAdapter Interface

**File:** `packages/broker-sdk/common/interfaces/broker-adapter.ts`

**Requirements:**
```typescript
/**
 * Core abstraction for all broker implementations.
 * Brokers implementing this interface become pluggable.
 */
export interface BrokerAdapter {
  // ========== Session Management ==========

  /**
   * Authenticate with broker.
   * Stores session tokens securely.
   * Throws on auth failure.
   */
  login(): Promise<void>;

  /**
   * Logout and clear session.
   * Disconnects WebSocket if applicable.
   */
  logout(): Promise<void>;

  /**
   * Refresh auth tokens before expiry.
   * Called periodically by SessionManager.
   */
  refreshToken(): Promise<void>;

  // ========== Account Info ==========

  /**
   * Get broker profile (name, email, broker ID, etc.)
   */
  getProfile(): Promise<BrokerProfile>;

  /**
   * Get current funds (cash, margin, buying power).
   * Called frequently; should be cached.
   */
  getFunds(): Promise<BrokerFunds>;

  /**
   * Get active positions (open trades).
   * May be empty in paper trading.
   */
  getPositions(): Promise<BrokerPosition[]>;

  /**
   * Get holdings (owned securities).
   * May be empty for intraday traders.
   */
  getHoldings(): Promise<BrokerHolding[]>;

  // ========== Order Management ==========

  /**
   * Place new order (BUY/SELL/STOPLOSS/etc.)
   * Validates price/quantity before sending.
   * Returns order object with external ID.
   */
  placeOrder(request: OrderRequest): Promise<OrderResponse>;

  /**
   * Modify pending order (price/quantity).
   * Fails if order already executed.
   */
  modifyOrder(
    orderId: string,
    modifications: OrderModification
  ): Promise<OrderResponse>;

  /**
   * Cancel pending order.
   * No-op if already executed/cancelled.
   */
  cancelOrder(orderId: string): Promise<void>;

  // ========== Market Data ==========

  /**
   * Subscribe to real-time quotes for symbols.
   * Emits 'quote' events on market data.
   */
  subscribeMarketData(symbols: string[]): Promise<void>;

  /**
   * Unsubscribe from market data.
   */
  unsubscribeMarketData(symbols: string[]): Promise<void>;

  // ========== Event Emitter ==========

  /**
   * Register event listener.
   * Events: quote, order_update, position_update, error
   */
  on(event: string, handler: Function): void;
}
````

**Acceptance Criteria:**

- [ ] Interface fully documented
- [ ] All methods have JSDoc with examples
- [ ] Error conditions documented
- [ ] Return types clearly defined
- [ ] Async/await patterns consistent

---

### Task 1.2.2: Create Domain Types

**File:** `packages/broker-sdk/common/types/index.ts`

**Core Types:**

```typescript
// Broker Profile
export interface BrokerProfile {
  id: string;
  name: string;
  email: string;
  brokerId: string;
  brokerName: string;
  externalId: string;
}

// Funds
export interface BrokerFunds {
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number;
}

// Position (open trade)
export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  mode: 'CNC' | 'MIS' | 'NRML'; // different across brokers
  externalId?: string;
}

// Holding (owned security)
export interface BrokerHolding {
  symbol: string;
  quantity: number;
  pledgeQuantity: number;
  avgPrice?: number;
  currentPrice: number;
  value: number;
}

// Order
export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  product?: 'MIS' | 'CNC' | 'NRML';
  disclosedQuantity?: number;
  triggerPrice?: number;
}

export interface OrderResponse {
  orderId: string;
  externalOrderId: string;
  status: OrderStatus;
  timestamp: number;
}

export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIAL'
  | 'EXECUTED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface OrderModification {
  price?: number;
  quantity?: number;
  triggerPrice?: number;
}

// Session
export interface BrokerSession {
  id: string;
  brokerAccountId: string;
  sessionToken: string;
  refreshToken?: string;
  expiresAt: number;
  isActive: boolean;
}
```

**Acceptance Criteria:**

- [ ] All core types defined
- [ ] Types map to all 5+ brokers
- [ ] Optional fields marked correctly
- [ ] Documentation for complex types
- [ ] Can be imported across services

---

### Task 1.2.3: Create Enums

**File:** `packages/broker-sdk/common/enums/index.ts`

**Enums:**

```typescript
export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  SL = 'SL',
  SL_M = 'SL-M',
}

export enum OrderValidity {
  DAY = 'DAY',
  IOC = 'IOC', // Immediate or Cancel
  GTC = 'GTC', // Good Till Cancel
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
  CNC = 'CNC', // Cash & Carry (overnight holdings)
  MIS = 'MIS', // Margin Intraday Square-off
  NRML = 'NRML', // Normal (Futures)
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

**Acceptance Criteria:**

- [ ] All brokers represented
- [ ] All order types covered
- [ ] All order statuses included
- [ ] Values match broker conventions
- [ ] Exportable from package

---

### Task 1.2.4: Create SessionManager Base Class

**File:** `packages/broker-sdk/common/session-manager.ts`

**Requirements:**

```typescript
/**
 * Base class for broker session lifecycle management.
 * Handles: login, token refresh, heartbeat, auto-reconnect, circuit breaker.
 */
export abstract class SessionManager {
  protected sessionToken?: string;
  protected refreshToken?: string;
  protected expiresAt: number = 0;
  protected lastHeartbeat: number = 0;
  protected reconnectAttempts: number = 0;
  protected circuitBreakerOpen: boolean = false;

  abstract authenticate(): Promise<void>;
  abstract refreshAccessToken(): Promise<void>;
  abstract isTokenExpired(): boolean;

  async ensureActive(): Promise<void> {
    if (this.circuitBreakerOpen) {
      throw new SessionError('Circuit breaker open');
    }
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  async startHeartbeat(intervalSecs: number): Promise<void> {
    // Ping broker every N seconds
    // If fails 3x, trip circuit breaker
  }

  async reconnect(): Promise<void> {
    // Auto-reconnect with exponential backoff
    // Max 10 retries with increasing delays
  }

  isHealthy(): boolean {
    // Check if session valid, tokens fresh, circuit breaker open
  }
}
```

**Acceptance Criteria:**

- [ ] Abstract class structure clear
- [ ] All lifecycle methods outlined
- [ ] Error handling strategy defined
- [ ] Can be subclassed per broker
- [ ] Testable without real broker connection

---

## Day 4: Package & Directory Structure

### Task 1.3.1: Create Package Directory Structure

**Commands to execute:**

```bash
# Create package structure
mkdir -p packages/broker-sdk/common/{interfaces,types,enums,validators,encryption,errors}
mkdir -p packages/broker-sdk/{paper,angelone,shoonya,upstox,zerodha,fyers}/{__tests__,types}

# Create service structure
mkdir -p apps/broker-integration-service/{src,test}
mkdir -p apps/broker-integration-service/src/{config,controllers,services,kafka,middleware}

# Create docs structure
mkdir -p docs/adr
mkdir -p docs/api
mkdir -p docs/runbooks
mkdir -p docs/developer
```

**Files to create:**

- [ ] `packages/broker-sdk/package.json` (workspace)
- [ ] `packages/broker-sdk/tsconfig.json`
- [ ] `packages/broker-sdk/README.md`
- [ ] `apps/broker-integration-service/package.json`
- [ ] `apps/broker-integration-service/tsconfig.json`
- [ ] `apps/broker-integration-service/README.md`

**Acceptance Criteria:**

- [ ] All directories created
- [ ] Package.json files configured
- [ ] TypeScript configs set up
- [ ] Can run `npm install` without errors
- [ ] Can run `npx tsc --noEmit` successfully

---

### Task 1.3.2: Update Root package.json Workspaces

**File:** `package.json`

**Add to workspaces array:**

```json
{
  "workspaces": ["packages/*", "apps/*"]
}
```

Update to include:

```json
{
  "workspaces": [
    "packages/shared-types",
    "packages/shared-utils",
    "packages/shared-events",
    "packages/database",
    "packages/broker-sdk",    // NEW
    "apps/api-gateway",
    "apps/auth-service",
    ...
    "apps/broker-integration-service"  // NEW
  ]
}
```

**Acceptance Criteria:**

- [ ] broker-sdk added to workspaces
- [ ] broker-integration-service added
- [ ] `npm install` installs all workspaces
- [ ] Workspace hoisting works

---

### Task 1.3.3: Create CONTRIBUTING.md

**File:** `CONTRIBUTING.md` (update existing or create)

**Sections:**

- Broker adapter implementation guide
- How to add new broker in 10 steps
- Code style & conventions
- Testing requirements (90%+ coverage)
- PR checklist for broker changes

---

## Day 5: Documentation & Review

### Task 1.4.1: Update architect.md

**File:** `.claude/commands/architect.md` (or docs/architect.md)

**Changes:**

1. Add Broker Integration Service to topology diagram
2. Add broker adapter section
3. Document new Kafka topics
4. Update service table
5. Update API routes table

**Section to add:**

```markdown
### 11. Broker Integration Service (:3008)

**Role:** Broker abstraction layer, order routing, session management.

**Architecture:**

- Adapter pattern for multi-broker support
- SessionManager for connection lifecycle
- BrokerRouter for order routing
- Paper Trading as default

**Brokers Supported:**

- Paper Trading (default, no connectivity needed)
- Zerodha (OAuth, WebSocket)
- AngelOne (API key, WebSocket)
- Upstox (OAuth, WebSocket)
- Shoonya (API key, WebSocket)
- Fyers (API key, REST)

**Bootstrap:**

- Port: 3008
- Env: BROKER_DEFAULT_TYPE=PAPER
- Database: Prisma (broker_accounts, broker_sessions, broker_orders, etc.)
```

**Acceptance Criteria:**

- [ ] Broker Integration Service documented
- [ ] Updated topology diagram
- [ ] Updated services table
- [ ] Updated Kafka topics list
- [ ] New ADR references added

---

### Task 1.4.2: Create Phase 1 Completion Checklist

**File:** `PHASE_1_CHECKLIST.md`

```markdown
# Phase 1 Completion Checklist

## ADR Documents (5/5)

- [x] ADR-001-Broker-Architecture.md (Task 1.1.1)
- [x] ADR-002-Paper-Trading.md (Task 1.1.2)
- [x] ADR-003-Market-Data-Providers.md (Task 1.1.3)
- [x] ADR-004-Broker-Security.md (Task 1.1.4)
- [x] ADR-005-Kafka-Event-Contracts.md (Task 1.1.5)

## Core Interfaces (4/4)

- [x] BrokerAdapter interface (Task 1.2.1)
- [x] Domain types (Task 1.2.2)
- [x] Enums (Task 1.2.3)
- [x] SessionManager base class (Task 1.2.4)

## Package Structure (3/3)

- [x] Directory structure created (Task 1.3.1)
- [x] package.json files configured (Task 1.3.2)
- [x] Workspaces updated (Task 1.3.3)

## Documentation (2/2)

- [x] architect.md updated (Task 1.4.1)
- [x] CONTRIBUTING.md created (Task 1.3.3)

## Review & Sign-Off

- [ ] Tech lead review
- [ ] Architecture approved
- [ ] Team alignment confirmed
- [ ] Phase 2 kickoff scheduled
```

---

## Deliverables Summary

**By end of Day 5, you will have:**

### Documentation

✅ 5 ADR documents (4500+ lines total)
✅ Updated architect.md with broker integration section
✅ CONTRIBUTING.md with broker adapter guide

### Code Structure

✅ `packages/broker-sdk/` package created
✅ `apps/broker-integration-service/` service skeleton
✅ Core interfaces defined (BrokerAdapter, MarketDataProvider)
✅ Domain types, enums, base classes
✅ Updated workspace configuration

### Ready for Phase 2

✅ Clear architecture documented
✅ Interfaces approved for implementation
✅ Package structure ready
✅ Team alignment on approach

---

## Estimation

| Task                       | Duration   | Owner        |
| -------------------------- | ---------- | ------------ |
| 1.1.1 - 1.1.5 (ADRs)       | 1.5 days   | 1 person     |
| 1.2.1 - 1.2.4 (Interfaces) | 1 day      | 1 person     |
| 1.3.1 - 1.3.3 (Structure)  | 0.5 days   | 1 person     |
| 1.4.1 - 1.4.2 (Docs)       | 1 day      | 1 person     |
| **Total**                  | **4 days** | **1 person** |

---

## Success Criteria

Phase 1 is successful when:

- [ ] All 5 ADRs complete and reviewed
- [ ] BrokerAdapter interface approved
- [ ] Package structure ready for development
- [ ] Team agrees on approach before proceeding
- [ ] Phase 2 tasks can start without rework

---

## Next Steps After Phase 1

1. **Review ADRs** with team (1-2 hours)
2. **Approve interfaces** (30 mins)
3. **Confirm schedule** for Phase 2 (30 mins)
4. **Begin Phase 2:** Implement Broker SDK common package and Broker Integration Service skeleton

**Estimated kickoff for Phase 2:** Day 6 (Week 2)
