# SKILL: STOCKPRED_BROKER_INTEGRATION_AND_AUTOTRADING

## Skill Type

Architecture + Implementation Skill

## Target Model

Claude Haiku 4.5

## Execution Mode

High Effort

---

# Primary Objective

You are extending an existing enterprise-grade stock market platform called StockPred.

You MUST NOT generate a new application.

You MUST extend the existing architecture.

Preserve:

- Existing services
- Existing Kafka event flow
- Existing Redis architecture
- Existing PostgreSQL schemas
- Existing Auto Trader
- Existing ML Engine
- Existing Signal Engine
- Existing Frontend

The goal is to introduce:

1. Broker Integration Layer
2. Broker Abstraction Layer
3. Paper Trading Engine
4. Real-Time Broker Connectivity
5. Live Trading Readiness
6. Multi-Broker Support
7. Real-Time Market Data Providers

---

# Critical Rules

## Rule 1

Never bypass existing services.

Bad:

```typescript
SignalEngine -> Broker
```

Good:

```typescript
SignalEngine
    ↓
RiskEngine
    ↓
AutoTrader
    ↓
BrokerIntegrationService
    ↓
BrokerAdapter
```

---

## Rule 2

Auto Trader must never know broker implementation details.

Auto Trader can only communicate using:

```typescript
BrokerAdapter;
```

---

## Rule 3

Broker implementations must be replaceable.

Adding a new broker must require:

```text
1 new adapter

0 business logic changes
```

---

## Rule 4

All trading actions must be event-driven.

Avoid synchronous dependencies where possible.

Prefer:

```text
Kafka
Redis Streams
Events
```

Over:

```text
Direct Service Calls
```

---

# Existing Architecture

```text
Frontend
      │
      ▼
API Gateway
      │
      ▼
Signal Engine
      │
      ▼
Pattern Engine
      │
      ▼
ML Engine
      │
      ▼
Risk Engine
      │
      ▼
Auto Trader
```

Extend into:

```text
Frontend
      │
      ▼
API Gateway
      │
      ▼
Signal Engine
      │
      ▼
Pattern Engine
      │
      ▼
ML Engine
      │
      ▼
Risk Engine
      │
      ▼
Auto Trader
      │
      ▼
Broker Integration Service
      │
      ▼
Broker Adapter
      │
      ▼
Broker API
```

---

# New Service

Create:

```text
apps/broker-integration-service
```

Responsibilities:

- Login
- Session Management
- Token Refresh
- Broker Connectivity
- Order Routing
- Position Sync
- Holdings Sync
- Funds Sync
- WebSocket Management
- Market Data Subscriptions

---

# Required Deliverables

Claude must generate:

## ADR Documents

Create:

```text
docs/adr
```

Files:

```text
ADR-001-Broker-Architecture.md

ADR-002-Paper-Trading.md

ADR-003-Market-Data-Providers.md

ADR-004-Broker-Security.md

ADR-005-Kafka-Event-Contracts.md
```

---

# Broker Adapter

Create:

```typescript
export interface BrokerAdapter {
  login(): Promise<void>;

  logout(): Promise<void>;

  refreshToken(): Promise<void>;

  getProfile();

  getFunds();

  getPositions();

  getHoldings();

  placeOrder();

  modifyOrder();

  cancelOrder();

  subscribeMarketData();
}
```

No implementation may bypass this contract.

---

# Required Adapters

Generate:

```text
PaperTradingAdapter

AngelOneAdapter

ShoonyaAdapter

UpstoxAdapter

ZerodhaAdapter

FyersAdapter
```

Each adapter must live in:

```text
packages/broker-sdk
```

Structure:

```text
packages/

 broker-sdk/

   common/

   paper/

   angelone/

   shoonya/

   upstox/

   zerodha/

   fyers/
```

---

# Paper Trading Adapter

PaperTradingAdapter becomes default implementation.

Capabilities:

```text
Virtual Funds

Virtual Holdings

Virtual Orders

Virtual Positions

Virtual PnL

Virtual Margin
```

Must fully implement:

```typescript
BrokerAdapter;
```

---

# Broker Session Management

Requirements:

```text
Auto Reconnect

Auto Refresh

Heartbeat

Session Recovery

Rate Limiting

Retry Logic

Circuit Breaker
```

Implement:

```typescript
SessionManager;
```

for every broker.

---

# Market Data Provider Layer

Create:

```typescript
interface MarketDataProvider
```

Methods:

```typescript
connect();

disconnect();

subscribe();

unsubscribe();

getQuotes();

getLtp();

getHistoricalData();
```

---

# Market Data Implementations

Create:

```text
YahooProvider

SimulatedProvider

AngelOneProvider

ShoonyaProvider

UpstoxProvider

ZerodhaProvider
```

---

# Database Changes

Generate migrations.

New tables:

```sql
brokers

broker_accounts

broker_sessions

broker_tokens

broker_orders

broker_positions

broker_holdings

broker_funds
```

Include:

```sql
PK

FK

Indexes

Unique Constraints
```

---

# Event Contracts

Generate strongly typed contracts.

Topics:

```text
broker.login

broker.connected

broker.disconnected

broker.order.created

broker.order.updated

broker.order.cancelled

broker.position.updated

broker.holdings.updated

broker.funds.updated
```

Generate:

```typescript
Event DTOs

Validators

Schemas

Kafka Producers

Kafka Consumers
```

---

# Security Requirements

Credentials must never be stored plaintext.

Use:

```text
AES-256-GCM
```

Generate:

```typescript
CredentialEncryptionService;
```

Support:

```text
Encrypt

Decrypt

Rotate Keys
```

---

# Risk Engine Integration

Risk Engine remains source of truth.

Every trade must pass:

```text
Position Validation

Capital Validation

Daily Loss Validation

Strategy Validation

Exposure Validation
```

before reaching Broker Integration Service.

---

# Frontend Changes

Add:

```text
Broker Management

Broker Status

Connected Accounts

Order Monitor

Position Monitor

Holdings Monitor
```

Pages:

```text
/ brokers

/ brokers/accounts

/ brokers/orders

/ brokers/positions

/ brokers/holdings
```

Use:

```text
React

TypeScript

Material UI

TradingView
```

---

# WebSocket Events

Add:

```text
broker

broker-order

broker-position

broker-holding

broker-funds
```

Latency target:

```text
<100ms
```

---

# Monitoring

Generate:

```text
Prometheus Metrics

Grafana Dashboards

Health Checks
```

Metrics:

```text
broker_login_latency

broker_order_latency

broker_reconnect_count

broker_api_errors

broker_session_expired

broker_position_sync_latency
```

---

# Testing Requirements

Generate:

```text
Unit Tests

Integration Tests

Contract Tests

E2E Tests
```

Coverage:

```text
90%+
```

Tools:

```text
Vitest

Cypress

Supertest
```

---

# Cypress Tags

Support:

```text
@smoke

@regression

@blocked

@fix

@wip
```

Behavior:

@blocked

```text
Execute

Capture Result

Ignore Failure
```

@fix

```text
Execute

Ignore Assertion Failures

Report Separately
```

@wip

```text
Skip Execution
```

Generate custom Cypress plugin.

---

# CI/CD

Generate:

```text
.github/workflows
```

Pipelines:

```text
lint

test

coverage

build

docker

security

release
```

Fail build when:

```text
Coverage < 90%

Lint Errors > 0

Critical Security Issues Found
```

---

# Docker

Update:

```yaml
docker-compose.yml
```

Add:

```text
broker-integration-service
```

All services must start with:

```bash
docker compose up -d
```

---

# Claude Implementation Instructions

When generating code:

1. Create ADR first.
2. Create interfaces second.
3. Create DTOs third.
4. Create database migrations fourth.
5. Create adapters fifth.
6. Create services sixth.
7. Create API endpoints seventh.
8. Create tests eighth.
9. Create Docker updates ninth.
10. Create CI/CD updates tenth.

Never generate placeholder implementations.

Always generate production-ready TypeScript.

Use strict typing.

No any types.

No TODO comments.

No mock implementations unless explicitly requested.

---

# Success Criteria

Implementation is successful when:

- Existing StockPred architecture remains operational.
- Paper Trading Adapter executes trades.
- Orders flow through BrokerAdapter.
- Real-time market data works.
- Broker sessions auto recover.
- Kafka event architecture remains intact.
- Auto Trader remains broker agnostic.
- New brokers can be added with zero business logic changes.
- Live trading can be enabled using configuration only.
- All tests pass.
- Coverage exceeds 90%.
- Docker deployment succeeds.
- CI/CD pipeline succeeds.
- Production readiness checklist passes.
