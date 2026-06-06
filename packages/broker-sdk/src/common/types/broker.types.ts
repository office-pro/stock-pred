/**
 * Broker Domain Types
 * Shared types across all broker adapters
 */

export interface BrokerProfile {
  id: string;
  name: string;
  email: string;
  accountId: string;
  brokerName: string;
  brokerType: string;
  tradingSegments: string[]; // e.g., ['EQUITY', 'DERIVATIVES', 'CURRENCY']
}

export interface BrokerFunds {
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number;
  pledgedMargin?: number;
  updatedAt: number;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  mode: 'CNC' | 'MIS' | 'NRML'; // Delivery, Intraday, Normal
  multiplier?: number; // For options, futures
}

export interface BrokerHolding {
  symbol: string;
  quantity: number;
  pledgeQuantity?: number;
  currentPrice: number;
  value: number;
  multiplier?: number;
}

export interface BrokerOrder {
  orderId: string;
  brokerOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  filledQuantity: number;
  price: number;
  filledPrice?: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  validity: 'DAY' | 'IOC' | 'GTC';
  status: OrderStatus;
  mode: 'CNC' | 'MIS' | 'NRML';
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface BrokerTrade {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  fillPrice: number;
  commission: number;
  tax: number;
  executedAt: number;
}

export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIAL' | 'EXECUTED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';

export interface Credentials {
  type: 'OAUTH' | 'API_KEY' | 'PASSWORD';
  provider: 'ZERODHA' | 'ANGELONE' | 'UPSTOX' | 'SHOONYA' | 'FYERS' | 'PAPER';
}

export interface OAuthCredential extends Credentials {
  type: 'OAUTH';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
}

export interface ApiKeyCredential extends Credentials {
  type: 'API_KEY';
  apiKey: string;
  apiSecret?: string;
  clientCode?: string;
}

export interface PasswordCredential extends Credentials {
  type: 'PASSWORD';
  username: string;
  password: string;
  totp?: string;
}

export interface BrokerLoginResponse {
  success: boolean;
  accountId: string;
  sessionToken?: string;
  expiresAt?: number;
  error?: string;
}

export interface BrokerLogoutResponse {
  success: boolean;
  error?: string;
}
