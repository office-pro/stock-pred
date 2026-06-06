/**
 * Custom Broker SDK Errors
 */

export class BrokerError extends Error {
  constructor(
    message: string,
    public code: string = 'BROKER_ERROR',
    public brokerCode?: string,
  ) {
    super(message);
    this.name = 'BrokerError';
    Object.setPrototypeOf(this, BrokerError.prototype);
  }
}

export class AuthenticationError extends BrokerError {
  constructor(message: string = 'Authentication failed', brokerCode?: string) {
    super(message, 'AUTH_ERROR', brokerCode);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class AuthorizationError extends BrokerError {
  constructor(message: string = 'Not authorized to perform this action', brokerCode?: string) {
    super(message, 'AUTHZ_ERROR', brokerCode);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

export class ValidationError extends BrokerError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class InsufficientFundsError extends BrokerError {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(
      `Insufficient funds: required ${required}, available ${available}`,
      'INSUFFICIENT_FUNDS',
    );
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

export class OrderRejectionError extends BrokerError {
  constructor(
    message: string,
    public orderId?: string,
    brokerCode?: string,
  ) {
    super(message, 'ORDER_REJECTED', brokerCode);
    this.name = 'OrderRejectionError';
    Object.setPrototypeOf(this, OrderRejectionError.prototype);
  }
}

export class MarginError extends BrokerError {
  constructor(message: string = 'Margin requirement not met', brokerCode?: string) {
    super(message, 'MARGIN_ERROR', brokerCode);
    this.name = 'MarginError';
    Object.setPrototypeOf(this, MarginError.prototype);
  }
}

export class TimeoutError extends BrokerError {
  constructor(message: string = 'Request timed out', brokerCode?: string) {
    super(message, 'TIMEOUT', brokerCode);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class CircuitBreakerOpenError extends BrokerError {
  constructor(message: string = 'Circuit breaker is open') {
    super(message, 'CIRCUIT_BREAKER_OPEN');
    this.name = 'CircuitBreakerOpenError';
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

export class SymbolNotFoundError extends ValidationError {
  constructor(symbol: string) {
    super(`Symbol not found: ${symbol}`, 'symbol');
    this.name = 'SymbolNotFoundError';
    Object.setPrototypeOf(this, SymbolNotFoundError.prototype);
  }
}

export class NotImplementedError extends BrokerError {
  constructor(method: string, brokerName: string) {
    super(`${method} not implemented for ${brokerName}`, 'NOT_IMPLEMENTED');
    this.name = 'NotImplementedError';
    Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}
