# Phase 2 Implementation Plan: Broker SDK Integration with Auto-Trader

**Duration:** 1 week (Week 2)  
**Status:** Starting now  
**Objective:** Wire BrokerRouter into auto-trader with zero breaking changes

---

## Phase 2 Overview

Phase 2 integrates the broker-sdk (from Phase 1) into the auto-trader service using NestJS dependency injection. The auto-trader will delegate order operations to BrokerRouter while maintaining all existing functionality (database persistence, Kafka events, audit logs, risk management).

```
Current (Paper Trading Only):
Auto-Trader → Direct state updates (cash, positions map)

Phase 2 (Broker-Agnostic):
Auto-Trader → BrokerRouter → BrokerAdapter (Paper or Live)
                           → Database persistence
                           → Kafka events
                           → Audit logs
```

---

## Integration Architecture

### Before Phase 2

```typescript
// apps/auto-trader/src/trader/trader.service.ts
private cash = 1_000_000;
private positions = new Map<string, OpenPosition>();

private async openPosition(...) {
  this.cash -= quantity * price;  // Direct state
  // Persist to DB
  // Emit Kafka event
}
```

### After Phase 2

```typescript
// apps/auto-trader/src/trader/trader.service.ts
@Inject(BrokerRouter) private broker: BrokerRouter;

private async openPosition(...) {
  // Delegate to broker (paper or live)
  const response = await this.broker.placeOrder({
    symbol, side: 'BUY', quantity, price,
    orderType: 'MARKET', validity: 'DAY', product: 'CNC'
  });

  if (response.status === 'REJECTED') {
    throw new BadRequestException(response.error);
  }

  // Persist to DB (including brokerOrderId)
  // Emit Kafka event
}
```

---

## Task Breakdown

### Task 1: Create BrokerModule (1 hour)

**File:** `apps/auto-trader/src/broker/broker.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BrokerRouter, BrokerFactory } from '@stockpred/broker-sdk';

@Module({
  providers: [
    {
      provide: BrokerRouter,
      useFactory: () => {
        const brokerType = process.env.BROKER_TYPE || 'PAPER';
        return new BrokerRouter({ brokerType });
      },
    },
  ],
  exports: [BrokerRouter],
})
export class BrokerModule {}
```

**Acceptance:**

- [ ] Module compiles
- [ ] Exports BrokerRouter
- [ ] Can be imported in other modules

---

### Task 2: Update App Module (30 minutes)

**File:** `apps/auto-trader/src/app.module.ts`

Add `BrokerModule` to imports:

```typescript
import { BrokerModule } from './broker/broker.module';

@Module({
  imports: [
    // ... existing imports
    BrokerModule,
  ],
  // ...
})
export class AppModule {}
```

**Acceptance:**

- [ ] AppModule still compiles
- [ ] BrokerModule is imported
- [ ] BrokerRouter is available for injection

---

### Task 3: Inject BrokerRouter into TraderService (1 hour)

**File:** `apps/auto-trader/src/trader/trader.service.ts`

```typescript
import { BrokerRouter, OrderRequest } from '@stockpred/broker-sdk';

@Injectable()
export class TraderService {
  constructor(
    @Inject(BrokerRouter) private broker: BrokerRouter,
    // ... existing dependencies
  ) {}
}
```

**Acceptance:**

- [ ] BrokerRouter is injected
- [ ] Service compiles
- [ ] No runtime errors on startup

---

### Task 4: Modify openPosition() Method (2 hours)

**File:** `apps/auto-trader/src/trader/trader.service.ts` (lines 325-388)

**Before:**

```typescript
private async openPosition(...): Promise<ExecutedTrade> {
  await this.assertLiveAllowed();
  this.cash -= quantity * price;  // Direct update
  // ... DB persist ...
  // ... Kafka emit ...
}
```

**After:**

```typescript
private async openPosition(
  symbol: string,
  quantity: number,
  price: number,
  target: number,
  stopLoss: number,
  userId?: string,
): Promise<ExecutedTrade> {
  // Risk checks (before broker call)
  if (this.riskManager.isTripped) {
    throw new ForbiddenException(`Circuit breaker active`);
  }

  // Construct order request
  const orderRequest: OrderRequest = {
    symbol,
    side: 'BUY',
    quantity,
    price,
    orderType: 'MARKET',
    validity: 'DAY',
    product: 'CNC',
    targetPrice: target,
    stopLossPrice: stopLoss,
    externalOrderId: `paper-${Date.now()}-${symbol}`,
  };

  // Delegate to broker (paper or live)
  let orderResponse: OrderResponse;
  try {
    orderResponse = await this.broker.placeOrder(orderRequest);
  } catch (error) {
    await this.audit('ORDER_REJECTED', 'auto-trader', {
      reason: error instanceof Error ? error.message : 'unknown error',
    });
    throw new BadRequestException(
      `Order failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  // Check for rejection
  if (orderResponse.status === 'REJECTED') {
    await this.audit('ORDER_REJECTED', 'auto-trader', {
      reason: orderResponse.error,
    });
    throw new BadRequestException(`Order rejected: ${orderResponse.error}`);
  }

  // Only update state if broker accepted
  this.cash -= quantity * price;

  let tradeId = orderRequest.externalOrderId!;
  try {
    await this.prisma.stock.upsert({
      where: { symbol },
      update: {},
      create: { symbol, name: symbol, exchange: 'NSE', sector: 'Unknown', indices: [] },
    });
    const row = await this.prisma.trade.create({
      data: {
        symbol,
        side: TradeSide.BUY,
        quantity,
        price: round2(price),
        mode: this.mode,
        status: TradeStatus.OPEN,
        target: round2(target),
        stopLoss: round2(stopLoss),
        userId,
        brokerOrderId: orderResponse.brokerOrderId || orderResponse.orderId, // NEW
      },
    });
    tradeId = row.id;
  } catch (error) {
    console.warn(`[auto-trader] trade persist failed: ${(error as Error).message}`);
  }

  const position: OpenPosition = {
    tradeId,
    symbol,
    quantity,
    entryPrice: price,
    target,
    stopLoss,
    openedAt: Date.now(),
  };
  this.positions.set(symbol, position);

  const executed: ExecutedTrade = {
    id: tradeId,
    symbol,
    side: TradeSide.BUY,
    quantity,
    price: round2(price),
    mode: this.mode,
    status: TradeStatus.OPEN,
    target: round2(target),
    stopLoss: round2(stopLoss),
    executedAt: position.openedAt,
  };

  await this.audit('TRADE_OPENED', 'auto-trader', { ...executed }, userId);
  await this.producer
    .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, symbol)
    .catch(() => undefined);

  console.log(`[auto-trader] OPEN ${symbol} x${quantity} @ ${round2(price)}`);
  return executed;
}
```

**Acceptance:**

- [ ] Method signature unchanged (same parameters, return type)
- [ ] BrokerRouter.placeOrder() called
- [ ] Order rejection handled gracefully
- [ ] Database persistence still works
- [ ] Kafka event still published
- [ ] Audit logging still works
- [ ] Paper trading math unchanged

---

### Task 5: Modify closePosition() Method (1.5 hours)

**File:** `apps/auto-trader/src/trader/trader.service.ts` (lines 390-436)

**Before:**

```typescript
private async closePosition(
  position: OpenPosition,
  exitPrice: number,
  reason: TradeExitReason,
): Promise<ExecutedTrade> {
  this.positions.delete(position.symbol);
  this.cash += proceeds;
  // ... DB update ...
  // ... Kafka emit ...
}
```

**After:**

```typescript
private async closePosition(
  position: OpenPosition,
  exitPrice: number,
  reason: TradeExitReason,
): Promise<ExecutedTrade> {
  // Note: Paper trading adapter handles order cancellation internally
  // Real brokers (Phase 3+) will send cancellation requests

  this.positions.delete(position.symbol);
  const proceeds = position.quantity * exitPrice;
  this.cash += proceeds;
  const pnl = round2((exitPrice - position.entryPrice) * position.quantity);
  this.realizedPnl += pnl;

  try {
    await this.prisma.trade.update({
      where: { id: position.tradeId },
      data: {
        status: TradeStatus.CLOSED,
        exitPrice: round2(exitPrice),
        exitReason: reason,
        pnl,
        closedAt: new Date(),
      },
    });
  } catch (error) {
    console.warn(`[auto-trader] trade close persist failed: ${(error as Error).message}`);
  }

  const executed: ExecutedTrade = {
    id: position.tradeId,
    symbol: position.symbol,
    side: TradeSide.SELL,
    quantity: position.quantity,
    price: round2(position.entryPrice),
    mode: this.mode,
    status: TradeStatus.CLOSED,
    exitPrice: round2(exitPrice),
    exitReason: reason,
    pnl,
    executedAt: position.openedAt,
    closedAt: Date.now(),
  };

  await this.audit('TRADE_CLOSED', 'auto-trader', { ...executed });
  await this.producer
    .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, position.symbol)
    .catch(() => undefined);

  console.log(
    `[auto-trader] CLOSE ${position.symbol} x${position.quantity} @ ${round2(exitPrice)} pnl ${pnl} (${reason})`,
  );

  return executed;
}
```

**Acceptance:**

- [ ] Method signature unchanged
- [ ] Database update still works
- [ ] Kafka event still published
- [ ] Audit logging still works
- [ ] PnL calculation unchanged

---

### Task 6: Remove assertLiveAllowed() Call (30 minutes)

**File:** `apps/auto-trader/src/trader/trader.service.ts`

**Current (lines 306-323):**

```typescript
private async assertLiveAllowed(): Promise<void> {
  if (this.mode !== TradingMode.LIVE) return;
  if (!this.liveEnabled) { ... }
  const broker = await this.prisma.broker.findFirst({ ... });
  if (!broker) { ... }
  throw new ForbiddenException('No live broker adapter configured');
}
```

**Action:**

- Remove the call to `await this.assertLiveAllowed()` from openPosition()
- Keep the method (for now) - BrokerRouter will handle validation

**Why:** BrokerRouter now handles broker selection and validation. The paper adapter always works; real brokers will have their own auth validation.

**Acceptance:**

- [ ] No breaking changes
- [ ] Paper trading still works
- [ ] Live trading validation deferred to real adapters (Phase 3+)

---

### Task 7: Update Trade Model (1 hour)

**File:** `packages/database/prisma/schema.prisma`

Add `brokerOrderId` field to Trade model:

```prisma
model Trade {
  id              String    @id @default(uuid())
  symbol          String
  side            String
  quantity        Int
  price           Float
  target          Float?
  stopLoss        Float?
  mode            String
  status          String
  exitPrice       Float?
  exitReason      String?
  pnl             Float?
  userId          String?
  brokerOrderId   String?   @unique @map("broker_order_id")  // NEW
  executedAt      DateTime  @default(now())
  closedAt        DateTime?
  createdAt       DateTime  @default(now())

  @@index([symbol])
  @@index([status])
  @@map("trades")
}
```

**Acceptance:**

- [ ] Schema compiles
- [ ] Migration file created
- [ ] Field is optional (backward-compatible)
- [ ] Unique constraint on brokerOrderId

---

### Task 8: Run Database Migration (30 minutes)

**Command:**

```bash
npm run prisma:generate
npm run prisma:migrate
```

**Acceptance:**

- [ ] Migration runs without errors
- [ ] Database schema updated
- [ ] No data loss

---

### Task 9: Unit Tests - PaperTradingAdapter (2 hours)

**File:** `packages/broker-sdk/src/paper/paper-trading-adapter.spec.ts`

Tests to write:

```typescript
describe('PaperTradingAdapter', () => {
  describe('placeOrder', () => {
    test('accepts BUY order with sufficient cash', async () => {
      // Arrange: adapter with 100k cash
      // Act: place BUY 10 shares @ 500
      // Assert: cash reduced by 5000
    });

    test('rejects BUY order with insufficient cash', async () => {
      // Arrange: adapter with 1k cash
      // Act: place BUY 10 shares @ 500
      // Assert: returns REJECTED status
    });

    test('MARKET order fills immediately', async () => {
      // Arrange: MARKET order
      // Act: place order
      // Assert: status === EXECUTED, not PENDING
    });

    test('LIMIT order stays pending until price crossed', async () => {
      // Arrange: LIMIT BUY @ 500
      // Act: place order at 1000 price, then tick @ 499
      // Assert: order still PENDING
      // Act: tick @ 500
      // Assert: order EXECUTED
    });

    test('position sizing matches formula', async () => {
      // Verify: qty = floor((cash × 1%) / (entry - SL))
    });

    test('PnL calculation matches formula', async () => {
      // Verify: pnl = (exit - entry) × qty
    });
  });

  describe('cancelOrder', () => {
    test('closes position and realizes PnL', () => {
      // Arrange: open position entry @ 100
      // Act: exit @ 110
      // Assert: realized PnL += 10 per share
    });
  });
});
```

**Acceptance:**

- [ ] All tests pass
- [ ] Paper adapter behavior verified
- [ ] Math matches auto-trader

---

### Task 10: Integration Tests - Auto-Trader + BrokerRouter (2 hours)

**File:** `apps/auto-trader/src/trader/trader.service.spec.ts`

Tests to write:

```typescript
describe('TraderService + BrokerRouter', () => {
  describe('openPosition', () => {
    test('delegates to BrokerRouter.placeOrder', async () => {
      // Arrange: TraderService with mocked BrokerRouter
      // Act: openPosition(...)
      // Assert: broker.placeOrder() was called with correct order
    });

    test('rejects order on broker rejection', async () => {
      // Arrange: BrokerRouter mocked to return REJECTED
      // Act: openPosition(...)
      // Assert: throws BadRequestException
    });

    test('persists trade with brokerOrderId', async () => {
      // Arrange: successful order
      // Act: openPosition(...)
      // Assert: Prisma.trade.create() called with brokerOrderId
    });

    test('publishes Kafka event on success', async () => {
      // Arrange: successful order
      // Act: openPosition(...)
      // Assert: producer.publish() called with TradeExecutedEvent
    });

    test('updates in-memory positions', async () => {
      // Arrange: successful order
      // Act: openPosition(...)
      // Assert: positions.get(symbol) exists
    });
  });

  describe('closePosition', () => {
    test('updates position status in DB', async () => {
      // Arrange: open position
      // Act: closePosition(...)
      // Assert: Prisma.trade.update() called with CLOSED status
    });

    test('publishes Kafka event on close', async () => {
      // Arrange: open position
      // Act: closePosition(...)
      // Assert: producer.publish() called
    });

    test('calculates PnL correctly', async () => {
      // Arrange: entry @ 100, exit @ 110
      // Act: closePosition(...)
      // Assert: pnl = 10 per share
    });
  });

  describe('executeManualTrade', () => {
    test('still works (BUY)', async () => {
      // Arrange: market price available
      // Act: executeManualTrade(symbol, BUY, qty)
      // Assert: position opened, Kafka event published
    });

    test('still works (SELL)', async () => {
      // Arrange: open position
      // Act: executeManualTrade(symbol, SELL, qty)
      // Assert: position closed, Kafka event published
    });
  });

  describe('risk management', () => {
    test('circuit breaker still enforced', async () => {
      // Arrange: drawdown limit exceeded
      // Act: openPosition(...)
      // Assert: throws ForbiddenException
    });

    test('paper trading capital calculation unchanged', () => {
      // Arrange: positions and cash
      // Act: getPortfolio()
      // Assert: equity = cash + market value
    });
  });
});
```

**Acceptance:**

- [ ] All tests pass
- [ ] Auto-trader integration verified
- [ ] No regressions in existing behavior

---

## Implementation Order

1. ✅ Task 1: BrokerModule (create)
2. ✅ Task 2: AppModule update (import BrokerModule)
3. ✅ Task 3: Inject BrokerRouter into TraderService
4. ✅ Task 4: Modify openPosition() to use broker.placeOrder()
5. ✅ Task 5: Modify closePosition() (no broker call needed yet)
6. ✅ Task 6: Remove assertLiveAllowed() call
7. ✅ Task 7: Add brokerOrderId to Trade model
8. ✅ Task 8: Run database migration
9. ✅ Task 9: Write unit tests for PaperTradingAdapter
10. ✅ Task 10: Write integration tests for auto-trader + BrokerRouter

---

## Testing Strategy

### Pre-Integration Checklist

- [ ] `npm run build` succeeds (all packages)
- [ ] No TypeScript errors
- [ ] No linting errors

### Post-Integration Checklist

- [ ] Auto-trader service starts
- [ ] Paper trading works end-to-end
- [ ] Kafka events still published
- [ ] Database persistence works
- [ ] Risk management still enforced
- [ ] All unit tests pass
- [ ] All integration tests pass

### Regression Tests

- [ ] Manual trade execution works
- [ ] Auto-buy gate still works
- [ ] Circuit breaker still works
- [ ] Target/SL hit detection still works
- [ ] Reversal signal exit still works
- [ ] Bearish ML exit still works

---

## Success Criteria

✅ **Phase 2 is complete when:**

1. BrokerRouter injected into TraderService
2. openPosition() and closePosition() delegate to broker
3. All existing functionality still works (0 regressions)
4. Database persistence includes brokerOrderId
5. Unit tests for PaperTradingAdapter pass (80%+ coverage)
6. Integration tests for auto-trader pass
7. Manual testing confirms paper trading works end-to-end
8. Kafka events still publish correctly
9. Risk management still enforced
10. Audit logging still works

---

## Risk Mitigation

| Risk                             | Mitigation                                                     |
| -------------------------------- | -------------------------------------------------------------- |
| **Breaking auto-trader**         | Keep method signatures unchanged, add broker layer gradually   |
| **Database migration fails**     | Test locally first, rollback plan ready                        |
| **Paper trading math changes**   | PaperTradingAdapter math = auto-trader math (regression tests) |
| **Kafka events stop publishing** | Test event publishing in integration tests                     |
| **Performance regression**       | Paper adapter is in-memory (same as before)                    |

---

## Rollback Plan

If Phase 2 breaks anything:

1. Remove `@Inject(BrokerRouter)` from TraderService
2. Remove broker.placeOrder() calls
3. Revert database migration: `prisma migrate resolve --rolled-back`
4. Revert auto-trader to pre-Phase 2 state

(Clean rollback possible because Phase 2 only adds, doesn't remove existing logic)

---

**Phase 2 starts now. Let's implement!**
