/**
 * Common Broker SDK Exports
 */

// Interfaces
export type { BrokerAdapter, BrokerAdapterEvent, BrokerAdapterEventData } from './interfaces/broker-adapter';

// Types
export type { BrokerProfile, BrokerFunds, BrokerPosition, BrokerHolding, BrokerOrder, BrokerTrade } from './types/broker.types';
export type { OrderRequest, OrderResponse, OrderModification, OrderFillEvent } from './types/order.types';
export type {
  Credentials,
  OAuthCredential,
  ApiKeyCredential,
  PasswordCredential,
  OrderStatus,
  BrokerLoginResponse,
  BrokerLogoutResponse,
} from './types/broker.types';

// Enums
export {
  OrderType,
  OrderValidity,
  OrderSide,
  OrderStatus as OrderStatusEnum,
  PositionMode,
  Product,
  BrokerType,
  CredentialType,
} from './enums';

// Errors
export {
  BrokerError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  InsufficientFundsError,
  OrderRejectionError,
  MarginError,
  TimeoutError,
  CircuitBreakerOpenError,
  SymbolNotFoundError,
  NotImplementedError,
} from './errors';

// Session Manager
export { SessionManager } from './session-manager';
export type { SessionConfig } from './session-manager';

// Router & Factory
export { BrokerRouter } from './broker-router';
export type { BrokerRouterConfig } from './broker-router';
export { BrokerFactory } from './broker-factory';
