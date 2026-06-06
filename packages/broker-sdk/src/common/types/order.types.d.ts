/**
 * Order Types
 * Request and response types for order operations
 */
export interface OrderRequest {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
    validity: 'DAY' | 'IOC' | 'GTC';
    product: 'MIS' | 'CNC' | 'NRML';
    triggerPrice?: number;
    targetPrice?: number;
    stopLossPrice?: number;
    disclosedQuantity?: number;
    externalOrderId?: string;
}
export interface OrderResponse {
    orderId: string;
    brokerOrderId?: string;
    status: OrderStatus;
    createdAt?: number;
    error?: string;
    code?: string;
}
export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIAL' | 'EXECUTED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export interface OrderModification {
    price?: number;
    quantity?: number;
    triggerPrice?: number;
}
export interface OrderFillEvent {
    orderId: string;
    brokerOrderId: string;
    symbol: string;
    filledQuantity: number;
    fillPrice: number;
    fillTime: number;
    commission?: number;
}
//# sourceMappingURL=order.types.d.ts.map