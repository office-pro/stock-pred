"use strict";
/**
 * Broker SDK Enums
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CredentialType = exports.BrokerType = exports.Product = exports.PositionMode = exports.OrderStatus = exports.OrderSide = exports.OrderValidity = exports.OrderType = void 0;
var OrderType;
(function (OrderType) {
    OrderType["MARKET"] = "MARKET";
    OrderType["LIMIT"] = "LIMIT";
    OrderType["SL"] = "SL";
    OrderType["SL_M"] = "SL-M";
})(OrderType || (exports.OrderType = OrderType = {}));
var OrderValidity;
(function (OrderValidity) {
    OrderValidity["DAY"] = "DAY";
    OrderValidity["IOC"] = "IOC";
    OrderValidity["GTC"] = "GTC";
})(OrderValidity || (exports.OrderValidity = OrderValidity = {}));
var OrderSide;
(function (OrderSide) {
    OrderSide["BUY"] = "BUY";
    OrderSide["SELL"] = "SELL";
})(OrderSide || (exports.OrderSide = OrderSide = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDING"] = "PENDING";
    OrderStatus["OPEN"] = "OPEN";
    OrderStatus["PARTIAL"] = "PARTIAL";
    OrderStatus["EXECUTED"] = "EXECUTED";
    OrderStatus["CANCELLED"] = "CANCELLED";
    OrderStatus["REJECTED"] = "REJECTED";
    OrderStatus["EXPIRED"] = "EXPIRED";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var PositionMode;
(function (PositionMode) {
    PositionMode["CNC"] = "CNC";
    PositionMode["MIS"] = "MIS";
    PositionMode["NRML"] = "NRML";
})(PositionMode || (exports.PositionMode = PositionMode = {}));
var Product;
(function (Product) {
    Product["MIS"] = "MIS";
    Product["CNC"] = "CNC";
    Product["NRML"] = "NRML";
})(Product || (exports.Product = Product = {}));
var BrokerType;
(function (BrokerType) {
    BrokerType["PAPER"] = "PAPER";
    BrokerType["ZERODHA"] = "ZERODHA";
    BrokerType["ANGELONE"] = "ANGELONE";
    BrokerType["UPSTOX"] = "UPSTOX";
    BrokerType["SHOONYA"] = "SHOONYA";
    BrokerType["FYERS"] = "FYERS";
})(BrokerType || (exports.BrokerType = BrokerType = {}));
var CredentialType;
(function (CredentialType) {
    CredentialType["OAUTH"] = "OAUTH";
    CredentialType["API_KEY"] = "API_KEY";
    CredentialType["PASSWORD"] = "PASSWORD";
})(CredentialType || (exports.CredentialType = CredentialType = {}));
//# sourceMappingURL=index.js.map