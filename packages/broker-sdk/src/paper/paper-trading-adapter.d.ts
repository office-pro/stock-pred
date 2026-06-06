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
import type { BrokerAdapter, BrokerAdapterEvent } from '../common/interfaces/broker-adapter';
import type { OrderRequest, OrderResponse, OrderModification, BrokerProfile, BrokerFunds, BrokerPosition, BrokerHolding, BrokerOrder, BrokerTrade } from '../common/types/index';
export declare class PaperTradingAdapter implements BrokerAdapter {
    private brokerAccountId;
    private authenticated;
    private cash;
    private _startOfDayEquity;
    private _startOfWeekEquity;
    private dailyDrawdownTripped;
    private weeklyDrawdownTripped;
    private positions;
    private orders;
    private trades;
    private listeners;
    constructor();
    login(): Promise<void>;
    logout(): Promise<void>;
    refreshToken(): Promise<void>;
    isAuthenticated(): boolean;
    getProfile(): Promise<BrokerProfile>;
    getFunds(): Promise<BrokerFunds>;
    getPositions(): Promise<BrokerPosition[]>;
    getHoldings(): Promise<BrokerHolding[]>;
    getOrders(status?: string): Promise<BrokerOrder[]>;
    getTrades(filters?: {
        symbol?: string;
        from?: number;
        to?: number;
    }): Promise<BrokerTrade[]>;
    placeOrder(request: OrderRequest): Promise<OrderResponse>;
    modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse>;
    cancelOrder(orderId: string): Promise<void>;
    subscribeMarketData(_symbols: string[]): Promise<void>;
    unsubscribeMarketData(_symbols: string[]): Promise<void>;
    on(event: BrokerAdapterEvent, handler: Function): void;
    off(event: BrokerAdapterEvent, handler: Function): void;
    onMarketTick(symbol: string, price: number, _time: number): void;
    private fillOrder;
    private calculateUsedMargin;
    private resetDaily;
    private resetWeekly;
    private getEquity;
    private emit;
}
//# sourceMappingURL=paper-trading-adapter.d.ts.map