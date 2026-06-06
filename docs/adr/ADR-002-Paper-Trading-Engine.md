# ADR-002: Paper Trading Engine

**Date:** 2026-06-06  
**Status:** Accepted  
**Participants:** Architecture Review Board, Trading Engine Team

## Problem

Paper trading is the **platform default and primary use case** for users. We must:

1. Implement paper trading as a BrokerAdapter (not special-case in auto-trader)
2. Ensure paper trading math is **identical** to current auto-trader behavior
3. Support unlimited virtual orders (no rate limits)
4. Simulate realistic order fills based on market prices
5. Maintain separate state from live trading (zero bleed-through)

## Solution

Create **PaperTradingAdapter** wrapping a **VirtualLedger** (in-memory state machine):

```
BrokerRouter
    └─→ PaperTradingAdapter (implements BrokerAdapter)
        └─→ VirtualLedger (state machine)
            ├─ Cash account
            ├─ Open positions map
            ├─ Pending orders queue
            ├─ Trade history
            └─ PnL tracking
```

### VirtualLedger State Machine

```typescript
interface VirtualLedger {
  cash: number; // Available cash
  positions: Map<symbol, Position>; // Open positions
  pendingOrders: Map<orderId, Order>; // Pending orders (LIMIT, SL)
  trades: Trade[]; // Closed trades (history)

  // State transitions
  placeOrder(req: OrderRequest): Order;
  fillOrder(orderId, fillPrice): Trade;
  cancelOrder(orderId): void;
  closePosition(symbol): Trade;
}

interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  entryTime: number;
  currentPrice?: number;
  targetPrice: number;
  stopLossPrice: number;
  mode: 'CNC' | 'MIS' | 'NRML';
}

interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // LIMIT price
  triggerPrice?: number; // SL trigger
  type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  status: OrderStatus; // PENDING, FILLED, CANCELLED, REJECTED
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
}
```

## PaperTradingAdapter Implementation

### 1. Order Placement

```typescript
async placeOrder(req: OrderRequest): Promise<OrderResponse> {
  // Validation
  if (!this.ledger.hasSymbol(req.symbol)) throw Error('Unknown symbol');
  if (req.side === 'BUY' && this.ledger.cash < req.quantity * req.price) {
    return { success: false, error: 'Insufficient cash', status: 'REJECTED' };
  }

  // Create order
  const orderId = uuid();
  const order = {
    id: orderId,
    symbol: req.symbol,
    side: req.side,
    quantity: req.quantity,
    price: req.orderType === 'LIMIT' ? req.price : undefined,
    type: req.orderType,
    status: 'PENDING',
    createdAt: Date.now(),
  };

  // MARKET orders fill immediately
  if (req.orderType === 'MARKET') {
    return this.fillOrder(orderId, this.getMarketPrice(req.symbol));
  }

  // LIMIT/SL orders await fill or expiry
  this.ledger.pendingOrders.set(orderId, order);
  return { orderId, status: 'PENDING', externalOrderId: orderId };
}
```

### 2. Order Fill Simulation

```typescript
// Called on each market tick
onMarketTick(tick: MarketTick): void {
  for (const [orderId, order] of this.ledger.pendingOrders) {
    // LIMIT: fill if price crosses limit
    if (order.type === 'LIMIT' && order.side === 'BUY' && tick.price <= order.price) {
      this.fillOrder(orderId, tick.price);
    }
    if (order.type === 'LIMIT' && order.side === 'SELL' && tick.price >= order.price) {
      this.fillOrder(orderId, tick.price);
    }

    // SL: fill if price breaches trigger
    if (order.type === 'SL' && order.side === 'SELL' && tick.price <= order.triggerPrice) {
      // Convert to market order, fill at next available price (slippage)
      this.fillOrder(orderId, tick.price * 0.99);  // 1% slippage
    }
  }

  // Update position prices for unrealized PnL
  for (const [symbol, pos] of this.ledger.positions) {
    if (pos.symbol === tick.symbol) {
      pos.currentPrice = tick.price;
    }
  }
}
```

### 3. Position Sizing (From Auto-Trader)

```typescript
// MUST match auto-trader's positionSize() formula exactly
private positionSize(entryPrice: number, stopLossPrice: number): number {
  const riskPercent = 1;  // 1% per trade
  const availableCash = this.ledger.cash;
  const riskAmount = (availableCash * riskPercent) / 100;
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  if (riskPerShare === 0) return 0;

  return Math.floor(riskAmount / riskPerShare);
}
```

### 4. PnL Calculation (From Auto-Trader)

```typescript
private calculatePnL(pos: Position, exitPrice: number): number {
  if (pos.side === 'BUY') {
    return (exitPrice - pos.entryPrice) * pos.quantity;
  } else {
    return (pos.entryPrice - exitPrice) * pos.quantity;
  }
}

// Unrealized PnL for open positions
getUnrealizedPnL(symbol?: string): number {
  let total = 0;
  for (const [sym, pos] of this.ledger.positions) {
    if (symbol && symbol !== sym) continue;
    total += (pos.currentPrice - pos.entryPrice) * pos.quantity;
  }
  return total;
}

// Realized PnL from closed trades
getRealizedPnL(): number {
  return this.ledger.trades.reduce((sum, t) => sum + t.pnl, 0);
}
```

### 5. Margin & Risk Limits

```typescript
// Must reject orders that violate risk limits
async placeOrder(req: OrderRequest): Promise<OrderResponse> {
  // Check daily drawdown limit (3%)
  const dailyDrawdown = (this.ledger.startOfDayEquity - this.getEquity()) / this.ledger.startOfDayEquity;
  if (dailyDrawdown >= 0.03) {
    return { success: false, error: 'Daily drawdown limit exceeded', status: 'REJECTED' };
  }

  // Check position size
  const qty = this.positionSize(req.price, req.stopLoss);
  if (qty < req.quantity) {
    return { success: false, error: 'Insufficient margin', status: 'REJECTED' };
  }

  // ... rest of placeOrder logic
}
```

## Comparison with Current Auto-Trader

### Current Auto-Trader (direct position management)

```typescript
// In TraderService
private positions = new Map<symbol, Trade>();
private cash = 1_000_000;

private openPosition(symbol, quantity, price) {
  this.cash -= quantity * price;  // Direct state update
  this.positions.set(symbol, { qty, price, ... });
  return trade;
}
```

### New PaperTradingAdapter (via VirtualLedger)

```typescript
// In PaperTradingAdapter
private ledger = new VirtualLedger(1_000_000);

async placeOrder(req) {
  return this.ledger.placeOrder(req);  // Delegates to ledger
}
```

**Guarantee:** Math is identical; only wrapper changes.

## Order Types Supported

| Type       | Behavior                         | Auto-Trader Equivalent      |
| ---------- | -------------------------------- | --------------------------- |
| **MARKET** | Fill immediately at market price | default (price from tick)   |
| **LIMIT**  | Fill when price crosses limit    | manual order with limit     |
| **SL**     | Fill when price breaches trigger | current SL logic            |
| **SL-M**   | Trigger → MARKET order           | combined (trigger + market) |

## Margin Rules (Per Broker, Paper = NSE CNC Default)

- **CNC (Delivery):** No margin; full amount due at settlement
- **MIS (Intraday):** 20x leverage; must square off by close
- **NRML (Normal):** 4x leverage; overnight allowed

For **paper trading default = CNC** (no margin, cash required upfront).

## Ledger Reset & Teardown

```typescript
// Daily reset (midnight UTC)
resetDaily(): void {
  this.ledger.startOfDayEquity = this.getEquity();
  this.ledger.dailyDrawdownBreaker = false;
}

// Weekly reset (Monday UTC)
resetWeekly(): void {
  this.ledger.startOfWeekEquity = this.getEquity();
  this.ledger.weeklyDrawdownBreaker = false;
}

// On logout
async logout(): Promise<void> {
  // Save trade history to DB (optional)
  // Clear positions (optional)
  this.ledger.clear();
}
```

## Testing Strategy

### Unit Tests

- [ ] Position sizing matches auto-trader formula
- [ ] PnL calculation matches (BUY/SELL separately)
- [ ] LIMIT orders fill on correct price crossover
- [ ] SL orders trigger on breach
- [ ] Insufficient cash rejects BUY
- [ ] Daily/weekly drawdown limits enforced
- [ ] Order cancellation works
- [ ] Position close at target/SL

### Integration Tests

- [ ] 100 ticks → fills any pending orders → PnL correct
- [ ] Multiple concurrent positions
- [ ] Risk limits don't prevent valid trades (boundary testing)

### Regression Tests

- [ ] Benchmark: same prices → same PnL as current auto-trader
- [ ] Benchmark: same signals → same trades as current auto-trader

## Known Limitations

1. **No Partial Fills:** Orders fill completely or not at all (reality: partial fills exist)
   - Mitigation: Good enough for paper trading
2. **Synchronous:** All operations in-memory (no network latency)
   - Mitigation: Real brokers will have latency; test layer handles
3. **No Slippage Model:** Uses tick price as fill price (reality: slippage varies)
   - Mitigation: Add gaussian slippage in Phase 2 if needed
4. **No Liquidity Check:** Assumes any quantity can fill (reality: limited depth)
   - Mitigation: Phase 2 integration with market depth data

## Migration Checklist

- [ ] VirtualLedger implemented & tested
- [ ] PaperTradingAdapter implements BrokerAdapter interface
- [ ] Paper adapter behavior matches current auto-trader 100%
- [ ] Unit tests pass (position sizing, PnL, fills)
- [ ] Integration tests pass (auto-trader + paper adapter)
- [ ] E2E tests pass (signal-to-trade flow)
- [ ] No regression in existing trade history accuracy

---

**Document Status:** Ready for implementation
