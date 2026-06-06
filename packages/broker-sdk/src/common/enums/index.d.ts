/**
 * Broker SDK Enums
 */
export declare enum OrderType {
    MARKET = "MARKET",
    LIMIT = "LIMIT",
    SL = "SL",
    SL_M = "SL-M"
}
export declare enum OrderValidity {
    DAY = "DAY",
    IOC = "IOC",// Immediate or Cancel
    GTC = "GTC"
}
export declare enum OrderSide {
    BUY = "BUY",
    SELL = "SELL"
}
export declare enum OrderStatus {
    PENDING = "PENDING",
    OPEN = "OPEN",
    PARTIAL = "PARTIAL",
    EXECUTED = "EXECUTED",
    CANCELLED = "CANCELLED",
    REJECTED = "REJECTED",
    EXPIRED = "EXPIRED"
}
export declare enum PositionMode {
    CNC = "CNC",// Delivery (Commodity/Consolidated)
    MIS = "MIS",// Intraday/Margin Intraday Square-off
    NRML = "NRML"
}
export declare enum Product {
    MIS = "MIS",
    CNC = "CNC",
    NRML = "NRML"
}
export declare enum BrokerType {
    PAPER = "PAPER",
    ZERODHA = "ZERODHA",
    ANGELONE = "ANGELONE",
    UPSTOX = "UPSTOX",
    SHOONYA = "SHOONYA",
    FYERS = "FYERS"
}
export declare enum CredentialType {
    OAUTH = "OAUTH",
    API_KEY = "API_KEY",
    PASSWORD = "PASSWORD"
}
//# sourceMappingURL=index.d.ts.map