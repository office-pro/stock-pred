/**
 * Order Types
 * Request and response types for order operations
 */

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // Required for LIMIT orders, ignored for MARKET
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  product: 'MIS' | 'CNC' | 'NRML';
  triggerPrice?: number; // For SL orders
  targetPrice?: number; // For bracket orders (optional)
  stopLossPrice?: number; // For bracket orders (optional)
  disclosedQuantity?: number; // Partial disclosure (optional)
  externalOrderId?: string; // Client-side order tracking ID
}

export interface OrderResponse {
  orderId: string; // StockPred internal order ID
  brokerOrderId?: string; // Broker-assigned order ID
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
