/**
 * BrokerRouter
 *
 * Routes all broker operations to the selected adapter (Paper, Zerodha, AngelOne, etc.)
 * Provides a single, unified interface for auto-trader to use.
 * Also emits Kafka events for audit and downstream consumers.
 */
import type { OrderRequest, OrderResponse, OrderModification, BrokerProfile, BrokerFunds, BrokerPosition, BrokerHolding, BrokerOrder, BrokerTrade } from './types/index';
export interface BrokerRouterConfig {
    brokerType?: string;
    kafkaProducer?: any;
}
export declare class BrokerRouter {
    private adapter;
    private kafkaProducer?;
    private listeners;
    constructor(config?: BrokerRouterConfig);
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
    subscribeMarketData(symbols: string[]): Promise<void>;
    unsubscribeMarketData(symbols: string[]): Promise<void>;
    on(event: string, handler: Function): void;
    off(event: string, handler: Function): void;
    private emit;
    private publishOrderEvent;
    private publishCancellationEvent;
    private validateOrderRequest;
}
//# sourceMappingURL=broker-router.d.ts.map