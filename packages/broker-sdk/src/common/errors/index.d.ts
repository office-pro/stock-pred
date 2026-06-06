/**
 * Custom Broker SDK Errors
 */
export declare class BrokerError extends Error {
    code: string;
    brokerCode?: string | undefined;
    constructor(message: string, code?: string, brokerCode?: string | undefined);
}
export declare class AuthenticationError extends BrokerError {
    constructor(message?: string, brokerCode?: string);
}
export declare class AuthorizationError extends BrokerError {
    constructor(message?: string, brokerCode?: string);
}
export declare class ValidationError extends BrokerError {
    field?: string | undefined;
    constructor(message: string, field?: string | undefined);
}
export declare class InsufficientFundsError extends BrokerError {
    required: number;
    available: number;
    constructor(required: number, available: number);
}
export declare class OrderRejectionError extends BrokerError {
    orderId?: string | undefined;
    constructor(message: string, orderId?: string | undefined, brokerCode?: string);
}
export declare class MarginError extends BrokerError {
    constructor(message?: string, brokerCode?: string);
}
export declare class TimeoutError extends BrokerError {
    constructor(message?: string, brokerCode?: string);
}
export declare class CircuitBreakerOpenError extends BrokerError {
    constructor(message?: string);
}
export declare class SymbolNotFoundError extends ValidationError {
    constructor(symbol: string);
}
export declare class NotImplementedError extends BrokerError {
    constructor(method: string, brokerName: string);
}
//# sourceMappingURL=index.d.ts.map