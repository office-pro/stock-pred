/**
 * NSE cash delivery (CNC) friction — port of apps/ml-engine/app/costs.py.
 * Slippage bps are constructor options (default 5), never a hard-coded 0.0005 in arithmetic.
 */

import type { ExecutionCostBreakdown } from '@stockpred/shared-types';

export interface ExecutionCostModelOptions {
  /** Slippage in basis points each side. Default 5 (= 0.05%). */
  slippageBps?: number;
  brokerageRate?: number;
  sttBuy?: number;
  sttSell?: number;
  exchangeRate?: number;
  sebiRate?: number;
  stampBuy?: number;
  gstRate?: number;
}

export interface SideCostDetail {
  fillPrice: number;
  notional: number;
  brokerage: number;
  exchange: number;
  sebi: number;
  gst: number;
  stamp: number;
  stt: number;
  feesTotal: number;
  /** Absolute ₹ impact of slippage vs raw price (informational). */
  slippageCost: number;
}

export interface ExecutionCostModel {
  readonly slippageBps: number;
  applySlippage(price: number, side: 'BUY' | 'SELL'): number;
  sideFees(
    notional: number,
    side: 'BUY' | 'SELL',
  ): Omit<SideCostDetail, 'fillPrice' | 'slippageCost' | 'notional'> & { feesTotal: number };
  entryCost(rawPrice: number, quantity: number): SideCostDetail;
  exitCost(rawPrice: number, quantity: number): SideCostDetail;
  roundTrip(input: {
    entryRawPrice: number;
    exitRawPrice: number;
    quantity: number;
  }): ExecutionCostBreakdown;
}

/** Conservative discount-broker CNC schedule matching costs.py. */
export class NSEDeliveryCostModel implements ExecutionCostModel {
  readonly slippageBps: number;
  private readonly brokerageRate: number;
  private readonly sttBuy: number;
  private readonly sttSell: number;
  private readonly exchangeRate: number;
  private readonly sebiRate: number;
  private readonly stampBuy: number;
  private readonly gstRate: number;

  constructor(options: ExecutionCostModelOptions = {}) {
    this.slippageBps = options.slippageBps ?? 5;
    this.brokerageRate = options.brokerageRate ?? 0.0003;
    this.sttBuy = options.sttBuy ?? 0.001;
    this.sttSell = options.sttSell ?? 0.001;
    this.exchangeRate = options.exchangeRate ?? 0.00000297;
    this.sebiRate = options.sebiRate ?? 0.0000001;
    this.stampBuy = options.stampBuy ?? 0.00015;
    this.gstRate = options.gstRate ?? 0.18;
  }

  private slippageRate(): number {
    return this.slippageBps / 10_000;
  }

  applySlippage(price: number, side: 'BUY' | 'SELL'): number {
    if (price <= 0) return price;
    const rate = this.slippageRate();
    return side === 'BUY' ? price * (1 + rate) : price * (1 - rate);
  }

  sideFees(
    notional: number,
    side: 'BUY' | 'SELL',
  ): Omit<SideCostDetail, 'fillPrice' | 'slippageCost' | 'notional'> & { feesTotal: number } {
    if (notional <= 0) {
      return {
        brokerage: 0,
        exchange: 0,
        sebi: 0,
        gst: 0,
        stamp: 0,
        stt: 0,
        feesTotal: 0,
      };
    }
    const brokerage = notional * this.brokerageRate;
    const exchange = notional * this.exchangeRate;
    const sebi = notional * this.sebiRate;
    const gst = this.gstRate * (brokerage + exchange + sebi);
    const stamp = side === 'BUY' ? notional * this.stampBuy : 0;
    const stt = notional * (side === 'BUY' ? this.sttBuy : this.sttSell);
    const feesTotal = brokerage + exchange + sebi + gst + stamp + stt;
    return { brokerage, exchange, sebi, gst, stamp, stt, feesTotal };
  }

  entryCost(rawPrice: number, quantity: number): SideCostDetail {
    const fillPrice = this.applySlippage(rawPrice, 'BUY');
    const notional = Math.abs(quantity * fillPrice);
    const fees = this.sideFees(notional, 'BUY');
    const slippageCost = Math.abs(fillPrice - rawPrice) * quantity;
    return { fillPrice, notional, slippageCost, ...fees };
  }

  exitCost(rawPrice: number, quantity: number): SideCostDetail {
    const fillPrice = this.applySlippage(rawPrice, 'SELL');
    const notional = Math.abs(quantity * fillPrice);
    const fees = this.sideFees(notional, 'SELL');
    const slippageCost = Math.abs(rawPrice - fillPrice) * quantity;
    return { fillPrice, notional, slippageCost, ...fees };
  }

  roundTrip(input: {
    entryRawPrice: number;
    exitRawPrice: number;
    quantity: number;
  }): ExecutionCostBreakdown {
    const qty = input.quantity;
    const entry = this.entryCost(input.entryRawPrice, qty);
    const exit = this.exitCost(input.exitRawPrice, qty);
    const grossPnl = (input.exitRawPrice - input.entryRawPrice) * qty;
    const feesTotal = entry.feesTotal + exit.feesTotal;
    const slippage = entry.slippageCost + exit.slippageCost;
    const netPnl = (exit.fillPrice - entry.fillPrice) * qty - feesTotal;
    return {
      entryPrice: input.entryRawPrice,
      exitPrice: input.exitRawPrice,
      quantity: qty,
      entryFillPrice: entry.fillPrice,
      exitFillPrice: exit.fillPrice,
      brokerage: entry.brokerage + exit.brokerage,
      exchange: entry.exchange + exit.exchange + entry.sebi + exit.sebi,
      taxes: entry.gst + exit.gst + entry.stamp + exit.stamp + entry.stt + exit.stt,
      slippage,
      feesTotal,
      grossPnl,
      netPnl,
    };
  }
}
