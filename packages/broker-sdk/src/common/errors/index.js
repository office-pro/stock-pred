'use strict';
/**
 * Custom Broker SDK Errors
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.NotImplementedError =
  exports.SymbolNotFoundError =
  exports.CircuitBreakerOpenError =
  exports.TimeoutError =
  exports.MarginError =
  exports.OrderRejectionError =
  exports.InsufficientFundsError =
  exports.ValidationError =
  exports.AuthorizationError =
  exports.AuthenticationError =
  exports.BrokerError =
    void 0;
class BrokerError extends Error {
  code;
  brokerCode;
  constructor(message, code = 'BROKER_ERROR', brokerCode) {
    super(message);
    this.code = code;
    this.brokerCode = brokerCode;
    this.name = 'BrokerError';
    Object.setPrototypeOf(this, BrokerError.prototype);
  }
}
exports.BrokerError = BrokerError;
class AuthenticationError extends BrokerError {
  constructor(message = 'Authentication failed', brokerCode) {
    super(message, 'AUTH_ERROR', brokerCode);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}
exports.AuthenticationError = AuthenticationError;
class AuthorizationError extends BrokerError {
  constructor(message = 'Not authorized to perform this action', brokerCode) {
    super(message, 'AUTHZ_ERROR', brokerCode);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}
exports.AuthorizationError = AuthorizationError;
class ValidationError extends BrokerError {
  field;
  constructor(message, field) {
    super(message, 'VALIDATION_ERROR');
    this.field = field;
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
exports.ValidationError = ValidationError;
class InsufficientFundsError extends BrokerError {
  required;
  available;
  constructor(required, available) {
    super(`Insufficient funds: required ${required}, available ${available}`, 'INSUFFICIENT_FUNDS');
    this.required = required;
    this.available = available;
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}
exports.InsufficientFundsError = InsufficientFundsError;
class OrderRejectionError extends BrokerError {
  orderId;
  constructor(message, orderId, brokerCode) {
    super(message, 'ORDER_REJECTED', brokerCode);
    this.orderId = orderId;
    this.name = 'OrderRejectionError';
    Object.setPrototypeOf(this, OrderRejectionError.prototype);
  }
}
exports.OrderRejectionError = OrderRejectionError;
class MarginError extends BrokerError {
  constructor(message = 'Margin requirement not met', brokerCode) {
    super(message, 'MARGIN_ERROR', brokerCode);
    this.name = 'MarginError';
    Object.setPrototypeOf(this, MarginError.prototype);
  }
}
exports.MarginError = MarginError;
class TimeoutError extends BrokerError {
  constructor(message = 'Request timed out', brokerCode) {
    super(message, 'TIMEOUT', brokerCode);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}
exports.TimeoutError = TimeoutError;
class CircuitBreakerOpenError extends BrokerError {
  constructor(message = 'Circuit breaker is open') {
    super(message, 'CIRCUIT_BREAKER_OPEN');
    this.name = 'CircuitBreakerOpenError';
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}
exports.CircuitBreakerOpenError = CircuitBreakerOpenError;
class SymbolNotFoundError extends ValidationError {
  constructor(symbol) {
    super(`Symbol not found: ${symbol}`, 'symbol');
    this.name = 'SymbolNotFoundError';
    Object.setPrototypeOf(this, SymbolNotFoundError.prototype);
  }
}
exports.SymbolNotFoundError = SymbolNotFoundError;
class NotImplementedError extends BrokerError {
  constructor(method, brokerName) {
    super(`${method} not implemented for ${brokerName}`, 'NOT_IMPLEMENTED');
    this.name = 'NotImplementedError';
    Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}
exports.NotImplementedError = NotImplementedError;
//# sourceMappingURL=index.js.map
