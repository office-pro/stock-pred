"use strict";
/**
 * BrokerRouter
 *
 * Routes all broker operations to the selected adapter (Paper, Zerodha, AngelOne, etc.)
 * Provides a single, unified interface for auto-trader to use.
 * Also emits Kafka events for audit and downstream consumers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrokerRouter = void 0;
const uuid_1 = require("uuid");
const broker_factory_1 = require("./broker-factory");
class BrokerRouter {
    adapter;
    kafkaProducer;
    listeners = new Map();
    constructor(config = {}) {
        const brokerType = config.brokerType || process.env.BROKER_TYPE || 'PAPER';
        this.adapter = broker_factory_1.BrokerFactory.create(brokerType);
        this.kafkaProducer = config.kafkaProducer;
        // Forward adapter events to our listeners
        this.adapter.on('order_placed', (data) => this.emit('order_placed', data));
        this.adapter.on('order_filled', (data) => this.emit('order_filled', data));
        this.adapter.on('order_rejected', (data) => this.emit('order_rejected', data));
        this.adapter.on('order_cancelled', (data) => this.emit('order_cancelled', data));
        this.adapter.on('position_updated', (data) => this.emit('position_updated', data));
        this.adapter.on('funds_updated', (data) => this.emit('funds_updated', data));
        this.adapter.on('authenticated', (data) => this.emit('authenticated', data));
        this.adapter.on('unauthenticated', (data) => this.emit('unauthenticated', data));
        this.adapter.on('error', (data) => this.emit('error', data));
    }
    // ===== SESSION MANAGEMENT =====
    async login() {
        await this.adapter.login();
    }
    async logout() {
        await this.adapter.logout();
    }
    async refreshToken() {
        await this.adapter.refreshToken();
    }
    isAuthenticated() {
        return this.adapter.isAuthenticated();
    }
    // ===== ACCOUNT INFORMATION =====
    async getProfile() {
        return this.adapter.getProfile();
    }
    async getFunds() {
        return this.adapter.getFunds();
    }
    async getPositions() {
        return this.adapter.getPositions();
    }
    async getHoldings() {
        return this.adapter.getHoldings();
    }
    async getOrders(status) {
        return this.adapter.getOrders(status);
    }
    async getTrades(filters) {
        return this.adapter.getTrades(filters);
    }
    // ===== ORDER MANAGEMENT =====
    async placeOrder(request) {
        // Validate order request
        this.validateOrderRequest(request);
        // Call adapter
        const response = await this.adapter.placeOrder(request);
        // Emit Kafka event if we have Kafka producer
        if (this.kafkaProducer && (response.status === 'OPEN' || response.status === 'EXECUTED')) {
            try {
                await this.publishOrderEvent('broker.order.created', request, response);
            }
            catch (e) {
                console.error('Failed to publish order event to Kafka:', e);
                // Don't fail the order placement if Kafka publish fails
                // (This is fire-and-forget async publishing)
            }
        }
        return response;
    }
    async modifyOrder(orderId, mods) {
        return this.adapter.modifyOrder(orderId, mods);
    }
    async cancelOrder(orderId) {
        await this.adapter.cancelOrder(orderId);
        // Publish cancellation event
        if (this.kafkaProducer) {
            try {
                await this.publishCancellationEvent(orderId);
            }
            catch (e) {
                console.error('Failed to publish cancellation event to Kafka:', e);
            }
        }
    }
    // ===== MARKET DATA =====
    async subscribeMarketData(symbols) {
        if (this.adapter.subscribeMarketData) {
            await this.adapter.subscribeMarketData(symbols);
        }
    }
    async unsubscribeMarketData(symbols) {
        if (this.adapter.unsubscribeMarketData) {
            await this.adapter.unsubscribeMarketData(symbols);
        }
    }
    // ===== EVENT MANAGEMENT =====
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(handler);
    }
    off(event, handler) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx >= 0)
                handlers.splice(idx, 1);
        }
    }
    emit(event, data) {
        const handlers = this.listeners.get(event) || [];
        for (const handler of handlers) {
            try {
                handler(data);
            }
            catch (e) {
                console.error(`Error in ${event} listener:`, e);
            }
        }
    }
    // ===== KAFKA EVENT PUBLISHING =====
    async publishOrderEvent(topic, request, response) {
        if (!this.kafkaProducer)
            return;
        const event = {
            eventId: (0, uuid_1.v4)(),
            timestamp: Date.now(),
            source: 'broker-router',
            type: topic,
            version: 'v1',
            data: {
                brokerOrderId: response.brokerOrderId || response.orderId,
                tradeId: request.externalOrderId,
                symbol: request.symbol,
                side: request.side,
                quantity: request.quantity,
                price: request.price,
                orderType: request.orderType,
                status: response.status,
                createdAt: response.createdAt || Date.now(),
            },
        };
        await this.kafkaProducer.emit(topic, event);
    }
    async publishCancellationEvent(orderId) {
        if (!this.kafkaProducer)
            return;
        const event = {
            eventId: (0, uuid_1.v4)(),
            timestamp: Date.now(),
            source: 'broker-router',
            type: 'broker.order.cancelled',
            version: 'v1',
            data: {
                orderId,
            },
        };
        await this.kafkaProducer.emit('broker.order.cancelled', event);
    }
    // ===== VALIDATION =====
    validateOrderRequest(request) {
        if (!request.symbol || request.symbol.trim().length === 0) {
            throw new Error('Order symbol is required');
        }
        if (!['BUY', 'SELL'].includes(request.side)) {
            throw new Error('Order side must be BUY or SELL');
        }
        if (request.quantity <= 0) {
            throw new Error('Order quantity must be positive');
        }
        if (request.orderType === 'LIMIT' && !request.price) {
            throw new Error('LIMIT orders require a price');
        }
        if (request.orderType === 'SL' && !request.triggerPrice) {
            throw new Error('SL orders require a trigger price');
        }
        if (!['MARKET', 'LIMIT', 'SL', 'SL-M'].includes(request.orderType)) {
            throw new Error('Invalid order type');
        }
        if (!['DAY', 'IOC', 'GTC'].includes(request.validity)) {
            throw new Error('Invalid order validity');
        }
        if (!['MIS', 'CNC', 'NRML'].includes(request.product)) {
            throw new Error('Invalid product type');
        }
    }
}
exports.BrokerRouter = BrokerRouter;
//# sourceMappingURL=broker-router.js.map