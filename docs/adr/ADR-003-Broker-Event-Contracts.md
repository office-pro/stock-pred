# ADR-003: Broker Event Contracts

**Date:** 2026-06-06  
**Status:** Accepted  
**Participants:** Architecture Review Board, Event Bus Team

## Problem

Broker integration introduces new Kafka events (login, order creation, fills, position updates, etc.) that must be:

1. **Versioned:** Support broker API changes without breaking consumers
2. **Documented:** Clear schema for all event types
3. **Discoverable:** Services know what to subscribe to
4. **Traceable:** Audit trail for compliance
5. **Reliable:** At-least-once delivery, idempotent consumption

## Solution

Define **broker event contracts** in `packages/shared-events` and publish via Kafka topics.

### Event Envelope (Wrapper)

All events follow this structure:

```typescript
interface BrokerEventEnvelope {
  eventId: string; // UUID, unique per event
  timestamp: number; // Milliseconds (Date.now())
  source: string; // 'auto-trader', 'broker-integration-service'
  type: string; // 'broker.login', 'broker.order.created', etc.
  version: string; // 'v1', 'v2' (schema version)
  brokerAccountId: string; // FK to BrokerAccount
  data: Record<string, any>; // Event-specific payload
  correlationId?: string; // Trace across services
  tags?: { [key: string]: string }; // Custom tags (symbol, userId, etc.)
}
```

### Broker Event Topics

**Topic 1: `broker.login`** (Auth Events)

```typescript
interface BrokerLoginEvent {
  brokerAccountId: string;
  brokerName: string; // 'ZERODHA', 'ANGELONE', etc.
  accountId: string; // Broker-specific account identifier
  success: boolean;
  error?: string;
  sessionToken?: string; // (encrypted in transit)
  expiresAt?: number; // Token expiry timestamp
  timestamp: number;
}

// Consumers: notification-service, api-gateway, audit-logs
// Retention: 7 days
```

**Topic 2: `broker.logout`** (Session End)

```typescript
interface BrokerLogoutEvent {
  brokerAccountId: string;
  reason: 'USER_INITIATED' | 'TOKEN_EXPIRED' | 'ERROR';
  error?: string;
  timestamp: number;
}

// Consumers: notification-service, audit-logs
// Retention: 7 days
```

**Topic 3: `broker.order.created`** (Order Placement)

```typescript
interface BrokerOrderCreatedEvent {
  brokerOrderId: string; // Broker-assigned order ID
  tradeId?: string; // StockPred trade ID (FK)
  brokerAccountId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // LIMIT price (null for MARKET)
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  product: 'MIS' | 'CNC' | 'NRML';
  status: 'PENDING' | 'OPEN' | 'REJECTED';
  error?: string; // If rejected
  createdAt: number;
  timestamp: number;
}

// Consumers: api-gateway, notification-service, audit-logs
// Retention: 30 days (for backtest audit)
```

**Topic 4: `broker.order.filled`** (Fill Notification)

```typescript
interface BrokerOrderFilledEvent {
  brokerOrderId: string;
  tradeId?: string;
  brokerAccountId: string;
  symbol: string;
  filledQuantity: number; // May be partial
  fillPrice: number;
  fillTime: number; // Broker's timestamp
  commission?: number; // If available
  timestamp: number;
}

// Consumers: auto-trader, api-gateway, notification-service
// Retention: 30 days
```

**Topic 5: `broker.order.cancelled`** (Cancellation)

```typescript
interface BrokerOrderCancelledEvent {
  brokerOrderId: string;
  tradeId?: string;
  brokerAccountId: string;
  cancelledQuantity: number; // Unfilled quantity
  reason: 'USER_REQUESTED' | 'SYSTEM' | 'EXPIRED';
  timestamp: number;
}

// Consumers: auto-trader, api-gateway
// Retention: 30 days
```

**Topic 6: `broker.order.rejected`** (Order Rejection)

```typescript
interface BrokerOrderRejectedEvent {
  brokerOrderId: string;
  tradeId?: string;
  brokerAccountId: string;
  symbol: string;
  reason: string; // 'Insufficient funds', 'Circuit breaker active', etc.
  code: string; // Broker error code
  timestamp: number;
}

// Consumers: auto-trader (retry logic), api-gateway, audit-logs
// Retention: 30 days
```

**Topic 7: `broker.position.updated`** (Position Sync)

```typescript
interface BrokerPositionUpdatedEvent {
  brokerAccountId: string;
  symbol: string;
  quantity: number; // Net position
  averagePrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  mode: 'CNC' | 'MIS' | 'NRML';
  multiplier?: number; // For index futures, etc.
  timestamp: number; // Broker-side timestamp
  pulledAt: number; // Local pull timestamp
}

// Consumers: api-gateway, notification-service
// Retention: 7 days (realtime state, not historical)
// Frequency: On-demand (POST /brokers/positions/sync), or periodic (daily)
```

**Topic 8: `broker.holdings.updated`** (Holdings Sync)

```typescript
interface BrokerHoldingsUpdatedEvent {
  brokerAccountId: string;
  holdings: Array<{
    symbol: string;
    quantity: number;
    pledgeQuantity?: number;
    currentPrice: number;
    value: number;
    multiplier?: number;
  }>;
  timestamp: number;
  pulledAt: number;
}

// Consumers: api-gateway
// Retention: 7 days
// Frequency: On-demand, or daily EOD
```

**Topic 9: `broker.funds.updated`** (Account Funds)

```typescript
interface BrokerFundsUpdatedEvent {
  brokerAccountId: string;
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number; // availableCash × marginMultiplier
  timestamp: number;
  pulledAt: number;
}

// Consumers: api-gateway, auto-trader (for position sizing)
// Retention: 7 days
// Frequency: On-demand, or periodic (e.g., every 5 min during market hours)
```

**Topic 10: `broker.error`** (Error Events)

```typescript
interface BrokerErrorEvent {
  brokerAccountId: string;
  brokerOrderId?: string;
  error: string; // Human-readable error message
  code: string; // Broker error code
  severity: 'WARNING' | 'ERROR' | 'CRITICAL';
  timestamp: number;
}

// Consumers: notification-service, monitoring, audit-logs
// Retention: 30 days
// Examples:
//   - WebSocket disconnected (WARNING)
//   - Order rejected due to duplicate (ERROR)
//   - Session token expired (ERROR)
//   - Account blocked by broker (CRITICAL)
```

## Event Versioning Strategy

### Schema Evolution Rules

1. **Adding optional fields:** No version bump (backward-compatible)
2. **Removing fields:** New version (bump major)
3. **Changing field type:** New version (e.g., `quantity: number` → `quantity: string`)
4. **Renaming fields:** New version (map old → new in consumer)

### Version Handling

```typescript
// packages/shared-events/src/handlers/broker-order-created.ts

export const BrokerOrderCreatedV1 = {
  symbol: z.string(),
  quantity: z.number(),
  price: z.number().optional(),
  status: z.enum(['PENDING', 'OPEN', 'REJECTED']),
};

export const BrokerOrderCreatedV2 = {
  ...BrokerOrderCreatedV1,
  chainId?: z.string(),         // NEW field (OCO orders)
};

export function handleBrokerOrderCreated(event: BrokerEventEnvelope) {
  if (event.version === 'v1') {
    const data = BrokerOrderCreatedV1.parse(event.data);
    // Handle v1
  } else if (event.version === 'v2') {
    const data = BrokerOrderCreatedV2.parse(event.data);
    // Handle v2
  }
}
```

## Idempotency

All broker events include `eventId` (UUID) to enable idempotent consumption:

```typescript
// Consumer pseudocode
async function consume(event: BrokerEventEnvelope) {
  // Check if we've already processed this eventId
  const processed = await db.brokerEvents.findOne({ eventId: event.eventId });
  if (processed) {
    console.log('Already processed, skipping');
    return;
  }

  // Process event
  await processEvent(event);

  // Record we've seen this eventId
  await db.brokerEvents.create({ eventId: event.eventId, processedAt: Date.now() });
}
```

## Kafka Topic Configuration

```yaml
# docker-compose.yml
kafka:
  environment:
    # Auto-create topics with these defaults
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'true'

# Topic configs (created via kafka-topics CLI or Kafdrop)
broker.login:
  partitions: 3
  replication-factor: 1
  retention-ms: 604800000 # 7 days
  compression-type: snappy

broker.order.created:
  partitions: 10 # Higher throughput expected
  replication-factor: 1
  retention-ms: 2592000000 # 30 days
  compression-type: snappy

broker.order.filled:
  partitions: 10
  replication-factor: 1
  retention-ms: 2592000000
  compression-type: snappy

# ... etc
```

## Publishing from Broker Adapters

```typescript
// BrokerAdapter implementation (paper or real)
export class PaperTradingAdapter implements BrokerAdapter {
  constructor(private kafka: EventProducer) {}

  async placeOrder(req: OrderRequest): Promise<OrderResponse> {
    // ... business logic

    const event: BrokerEventEnvelope = {
      eventId: uuid(),
      timestamp: Date.now(),
      source: 'paper-trading-adapter',
      type: 'broker.order.created',
      version: 'v1',
      brokerAccountId: this.brokerAccountId,
      data: {
        brokerOrderId: orderId,
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        price: req.price,
        orderType: req.orderType,
        status: 'OPEN',
        createdAt: Date.now(),
      },
    };

    await this.kafka.emit('broker.order.created', event);
    return response;
  }
}
```

## Monitoring & Alerts

Create Kafka monitoring dashboard (Kafdrop or Confluent Control Center):

| Metric                      | Alert Threshold |
| --------------------------- | --------------- |
| `broker.order.created` lag  | > 1 minute      |
| `broker.error` rate         | > 5 per minute  |
| `broker.login` failure rate | > 10%           |
| Topic partition rebalancing | any event       |

## Backward Compatibility

If broker API changes and event schema must change:

```
Old consumers   New consumers
     ↓               ↓
    topic ← Kafka (mixed versions)
```

Use `version` field to handle gracefully:

- Old consumers ignore events with version > supported
- New consumers handle old versions via migration logic

## Implementation Checklist

- [ ] Event interface definitions in `packages/shared-events`
- [ ] Zod schemas for runtime validation
- [ ] Kafka topics created (auto or manual)
- [ ] BrokerAdapter publishes events
- [ ] Auto-trader consumes broker events (for position updates, etc.)
- [ ] API gateway consumes broker events (for Socket.IO broadcast)
- [ ] Notification service consumes broker events
- [ ] Audit logs capture all broker events
- [ ] Unit tests: event creation, validation, versioning
- [ ] Integration tests: Kafka publish-consume flow

---

**Document Status:** Ready for implementation
