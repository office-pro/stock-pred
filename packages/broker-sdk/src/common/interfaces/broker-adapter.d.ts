/**
 * BrokerAdapter Interface
 *
 * Standard contract for all broker implementations (real and simulated).
 * Each broker must implement these methods to integrate with StockPred.
 */
import type { BrokerProfile, BrokerFunds, BrokerPosition, BrokerHolding, BrokerOrder, BrokerTrade, OrderRequest, OrderResponse, OrderModification } from '../types';
export type BrokerAdapterEvent = 'authenticated' | 'unauthenticated' | 'order_placed' | 'order_filled' | 'order_rejected' | 'order_cancelled' | 'position_updated' | 'funds_updated' | 'error';
export interface BrokerAdapterEventData {
    authenticated: {
        brokerAccountId: string;
        accountId: string;
    };
    unauthenticated: {
        reason: string;
    };
    order_placed: {
        orderId: string;
        symbol: string;
    };
    order_filled: {
        orderId: string;
        fillPrice: number;
        filledQuantity: number;
    };
    order_rejected: {
        orderId: string;
        reason: string;
    };
    order_cancelled: {
        orderId: string;
    };
    position_updated: {
        symbol: string;
        quantity: number;
    };
    funds_updated: {
        availableCash: number;
        usedMargin: number;
    };
    error: {
        error: string;
        code: string;
    };
}
/**
 * BrokerAdapter Interface
 *
 * All broker implementations (Zerodha, AngelOne, Paper, etc.) must implement this interface.
 * Auto-trader depends ONLY on this interface, not on specific broker implementations.
 */
export interface BrokerAdapter {
    /**
     * Authenticate with the broker using provided credentials
     * @param credentials Broker-specific credentials (OAuth token, API key, password, etc.)
     * @returns Promise resolving when authentication succeeds
     * @throws BrokerError if authentication fails
     */
    login(): Promise<void>;
    /**
     * Logout and terminate session with broker
     */
    logout(): Promise<void>;
    /**
     * Refresh session token (for OAuth brokers)
     * Called automatically by SessionManager, can also be called manually
     */
    refreshToken(): Promise<void>;
    /**
     * Check if currently authenticated
     * @returns true if session is active and token not expired
     */
    isAuthenticated(): boolean;
    /**
     * Get broker account profile (name, email, account ID, etc.)
     */
    getProfile(): Promise<BrokerProfile>;
    /**
     * Get current funds status (cash, margin, buying power)
     */
    getFunds(): Promise<BrokerFunds>;
    /**
     * Get all open positions
     */
    getPositions(): Promise<BrokerPosition[]>;
    /**
     * Get holdings (long-term positions/deliveries)
     */
    getHoldings(): Promise<BrokerHolding[]>;
    /**
     * Get order history, optionally filtered by status
     */
    getOrders(status?: string): Promise<BrokerOrder[]>;
    /**
     * Get trade history (filled orders)
     */
    getTrades(filters?: {
        symbol?: string;
        from?: number;
        to?: number;
    }): Promise<BrokerTrade[]>;
    /**
     * Place a new order with the broker
     * @param request Order request with symbol, side, quantity, price, type, etc.
     * @returns Order response with broker's order ID and status
     * @throws BrokerError if order placement fails (validation, margin, etc.)
     */
    placeOrder(request: OrderRequest): Promise<OrderResponse>;
    /**
     * Modify an existing order (price, quantity, etc.)
     * Not all brokers support modification; may require cancel + place
     */
    modifyOrder(orderId: string, mods: OrderModification): Promise<OrderResponse>;
    /**
     * Cancel an existing order
     * @throws BrokerError if order cannot be cancelled (already filled, etc.)
     */
    cancelOrder(orderId: string): Promise<void>;
    /**
     * Subscribe to real-time updates for specific symbols (optional, broker-dependent)
     */
    subscribeMarketData?(symbols: string[]): Promise<void>;
    /**
     * Unsubscribe from real-time updates
     */
    unsubscribeMarketData?(symbols: string[]): Promise<void>;
    /**
     * Register event listener for broker events
     * @example adapter.on('order_filled', (data) => { ... })
     */
    on<E extends BrokerAdapterEvent>(event: E, handler: (data: BrokerAdapterEventData[E]) => void): void;
    /**
     * Remove event listener
     */
    off<E extends BrokerAdapterEvent>(event: E, handler: (data: BrokerAdapterEventData[E]) => void): void;
}
//# sourceMappingURL=broker-adapter.d.ts.map