/**
 * Broker SDK Enums
 */

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  SL = 'SL',
  SL_M = 'SL-M',
}

export enum OrderValidity {
  DAY = 'DAY',
  IOC = 'IOC', // Immediate or Cancel
  GTC = 'GTC', // Good Till Cancel
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIAL = 'PARTIAL',
  EXECUTED = 'EXECUTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum PositionMode {
  CNC = 'CNC', // Delivery (Commodity/Consolidated)
  MIS = 'MIS', // Intraday/Margin Intraday Square-off
  NRML = 'NRML', // Normal (Overnight)
}

export enum Product {
  MIS = 'MIS',
  CNC = 'CNC',
  NRML = 'NRML',
}

export enum BrokerType {
  PAPER = 'PAPER',
  ZERODHA = 'ZERODHA',
  ANGELONE = 'ANGELONE',
  UPSTOX = 'UPSTOX',
  SHOONYA = 'SHOONYA',
  FYERS = 'FYERS',
}

export enum CredentialType {
  OAUTH = 'OAUTH',
  API_KEY = 'API_KEY',
  PASSWORD = 'PASSWORD',
}
