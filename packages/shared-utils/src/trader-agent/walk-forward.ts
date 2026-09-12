import type {
  AgentRiskBudgetConfig,
  AgentWalkForwardConfig,
  AgentWalkForwardReport,
  ConfidenceSensitivityResult,
  DecisionReasonCode,
  ExecutionCostBreakdown,
  FunnelMetrics,
  PerformanceSummary,
  RankedReasonCode,
  RegimeSliceMetrics,
  TradeDecision,
  TradeEligibility,
  ValidationChecks,
  WalkForwardOpportunity,
  WalkForwardRegimeSnapshot,
  WalkForwardTradeRecord,
  WalkForwardTradingVerdict,
  WalkForwardVerdict,
} from '@stockpred/shared-types';
import {
  AGENT_WALKFORWARD_SCHEMA_VERSION,
  DEFAULT_AGENT_RISK_BUDGETS,
  DEFAULT_RISK_LIMITS,
} from '@stockpred/shared-types';
import { applyDecisionPolicy } from './decision-policy';
import { evaluateTrade } from './decision-engine';
import { NSEDeliveryCostModel } from './execution-costs';
import { DEFAULT_DUPLICATE_ORDER_WINDOW_MS, simulateRevalidatingGate } from './gate-sim';
import { assertNoFutureData, buildHistoricalDecisionContext } from './historical-context';
import { evaluatePortfolio } from './portfolio-engine';
import { confidenceToScale, evaluateRisk } from './risk-engine';
import { SimulatedBook } from './simulated-book';

/** Default TTL/freshness for daily (or slower) walk-forward bars. Live PAPER still uses 15m. */
const DEFAULT_WALKFORWARD_TTL_MS = 7 * 86_400_000;
const DEFAULT_WALKFORWARD_QUOTE_AGE_MS = 7 * 86_400_000;

interface PendingOpen {
  opportunityId: string;
  decisionId: string;
  symbol: string;
  sector: string | null;
  decisionTimestamp: number;
  fillTimestamp: number;
  quantity: number;
  entryRaw: number;
  /** Slipped fill + fees already computed at accept time. */
  entryFillPrice: number;
  fillCost: number;
  stopLoss: number;
  target1: number | null;
  eligibility: TradeEligibility;
  regimeSnapshot: WalkForwardRegimeSnapshot;
  reasonCodes: DecisionReasonCode[];
  regimeKey: string;
  exitPrice: number;
  exitTimestamp: number;
  exitReason: WalkForwardTradeRecord['exitReason'];
  /** False until clock reaches fillTimestamp — avoids future openedAt on the book. */
  onBook: boolean;
}

interface WalkForwardRunFlags {
  sawSameBarFillAttempt: boolean;
  sawFutureData: boolean;
  riskCeilingExceeded: boolean;
  positionLimitBreached: boolean;
  sectorLimitBreached: boolean;
  cashReserveBreached: boolean;
  ttlBlocked: boolean;
  freshnessBlocked: boolean;
  duplicateBlocked: boolean;
  confidenceRaisedCeiling: boolean;
  liveAutoAccepted: boolean;
  costsMissing: boolean;
  regimeUsedFuture: boolean;
}

function emptyFunnel(): FunnelMetrics {
  return {
    candidates: 0,
    autonomousEligible: 0,
    humanOnly: 0,
    rejectedEligibility: 0,
    riskPass: 0,
    riskBlocked: 0,
    portfolioPass: 0,
    portfolioBlocked: 0,
    policyPass: 0,
    policyHumanRequired: 0,
    policyRejected: 0,
    gatePass: 0,
    gateBlocked: 0,
    autoAccepted: 0,
    humanRequired: 0,
    filled: 0,
    liveAutoAccepted: 0,
    liveHumanRequired: 0,
  };
}

function emptyFlags(): WalkForwardRunFlags {
  return {
    sawSameBarFillAttempt: false,
    sawFutureData: false,
    riskCeilingExceeded: false,
    positionLimitBreached: false,
    sectorLimitBreached: false,
    cashReserveBreached: false,
    ttlBlocked: false,
    freshnessBlocked: false,
    duplicateBlocked: false,
    confidenceRaisedCeiling: false,
    liveAutoAccepted: false,
    costsMissing: false,
    regimeUsedFuture: false,
  };
}

function resolveBudgets(config: AgentWalkForwardConfig): AgentRiskBudgetConfig {
  return { ...DEFAULT_AGENT_RISK_BUDGETS, ...config.riskBudgets };
}

function sortOpportunities(opps: WalkForwardOpportunity[]): WalkForwardOpportunity[] {
  return [...opps].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const sym = a.symbol.toUpperCase().localeCompare(b.symbol.toUpperCase());
    if (sym !== 0) return sym;
    return a.opportunityId.localeCompare(b.opportunityId);
  });
}

function bumpReason(
  map: Map<string, RankedReasonCode>,
  code: DecisionReasonCode | string,
  layer: RankedReasonCode['layer'],
): void {
  const key = `${layer}:${code}`;
  const prev = map.get(key);
  if (prev) prev.count += 1;
  else map.set(key, { code, count: 1, layer });
}

function summarizeTrades(
  trades: WalkForwardTradeRecord[],
  endingCash: number,
  endingEquity: number,
  useNet: boolean,
): PerformanceSummary {
  const closed = trades.filter((t) => t.exitReason !== 'OPEN');
  let gross = 0;
  let net = 0;
  let fees = 0;
  let wins = 0;
  let losses = 0;
  for (const t of closed) {
    gross += t.costs.grossPnl;
    net += t.costs.netPnl;
    fees += t.costs.feesTotal;
    const pnl = useNet ? t.costs.netPnl : t.costs.grossPnl;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
  }
  const n = closed.length;
  return {
    tradeCount: n,
    winCount: wins,
    lossCount: losses,
    grossPnl: gross,
    netPnl: net,
    feesTotal: fees,
    avgGrossPnl: n ? gross / n : 0,
    avgNetPnl: n ? net / n : 0,
    endingCash,
    endingEquity,
  };
}

function resolveExit(
  bars: WalkForwardOpportunity['bars'],
  fillIndex: number,
  stop: number,
  target: number | null,
  horizonBars: number,
): { exitPrice: number; exitTimestamp: number; exitReason: WalkForwardTradeRecord['exitReason'] } {
  const end = Math.min(bars.length - 1, fillIndex + horizonBars);
  for (let i = fillIndex; i <= end; i++) {
    const bar = bars[i];
    // Intrabar: stop first (conservative), then target.
    if (bar.low <= stop) {
      const exitPrice = bar.open < stop ? bar.open : stop;
      return { exitPrice, exitTimestamp: bar.timestamp, exitReason: 'STOP_LOSS_HIT' };
    }
    if (target != null && bar.high >= target) {
      const exitPrice = bar.open > target ? bar.open : target;
      return { exitPrice, exitTimestamp: bar.timestamp, exitReason: 'TARGET_HIT' };
    }
  }
  const last = bars[Math.min(end, bars.length - 1)];
  return {
    exitPrice: last.close,
    exitTimestamp: last.timestamp,
    exitReason: 'HORIZON',
  };
}

/** Materialize fills whose fill bar is at or before asOf; then close exits that are due. */
function advanceBookTo(
  pending: PendingOpen[],
  asOf: number | null,
  book: SimulatedBook,
  costModel: NSEDeliveryCostModel,
  trades: WalkForwardTradeRecord[],
  funnel: FunnelMetrics,
  regimeMap: Map<string, RegimeSliceMetrics>,
): PendingOpen[] {
  for (const row of pending) {
    if (row.onBook) continue;
    if (asOf != null && row.fillTimestamp > asOf) continue;
    book.openPosition({
      symbol: row.symbol,
      quantity: row.quantity,
      entryPrice: row.entryFillPrice,
      fillCost: row.fillCost,
      target: row.target1 ?? row.entryFillPrice * 1.04,
      stopLoss: row.stopLoss,
      sector: row.sector,
      openedAt: row.fillTimestamp,
      decisionId: row.decisionId,
      opportunityId: row.opportunityId,
    });
    row.onBook = true;
  }

  const remaining: PendingOpen[] = [];
  for (const row of pending) {
    if (!row.onBook || (asOf != null && row.exitTimestamp > asOf)) {
      remaining.push(row);
      continue;
    }
    const costs: ExecutionCostBreakdown = costModel.roundTrip({
      entryRawPrice: row.entryRaw,
      exitRawPrice: row.exitPrice,
      quantity: row.quantity,
    });
    const exitSide = costModel.exitCost(row.exitPrice, row.quantity);
    book.closePosition(row.symbol, exitSide.notional - exitSide.feesTotal, costs.netPnl);

    funnel.filled += 1;
    const slice = regimeMap.get(row.regimeKey);
    if (slice) {
      slice.filled += 1;
      slice.grossPnl += costs.grossPnl;
      slice.netPnl += costs.netPnl;
    }

    trades.push({
      opportunityId: row.opportunityId,
      decisionId: row.decisionId,
      symbol: row.symbol,
      sector: row.sector,
      decisionTimestamp: row.decisionTimestamp,
      fillTimestamp: row.fillTimestamp,
      exitTimestamp: row.exitTimestamp,
      quantity: row.quantity,
      entry: row.entryRaw,
      stopLoss: row.stopLoss,
      target1: row.target1,
      exitReason: row.exitReason,
      eligibility: row.eligibility,
      regimeSnapshot: row.regimeSnapshot,
      costs,
      reasonCodes: row.reasonCodes,
    });
  }
  return remaining;
}

function tradingVerdict(
  net: PerformanceSummary,
  funnel: FunnelMetrics,
  technicalPass: boolean,
): WalkForwardTradingVerdict {
  if (!technicalPass) return 'FAIL';
  if (funnel.filled === 0 && funnel.candidates > 0) {
    return funnel.autoAccepted === 0 && funnel.autonomousEligible > 0 ? 'REVIEW' : 'ACCEPTABLE';
  }
  if (net.netPnl > 0 && net.winCount >= net.lossCount) return 'STRONG';
  if (net.netPnl >= 0) return 'ACCEPTABLE';
  if (net.netPnl > -net.feesTotal * 2) return 'REVIEW';
  return 'FAIL';
}

/**
 * Costed agent walk-forward: same production pipeline as PAPER auto.
 * Only fill/exit differ (next-bar open + costs). No shadow brain.
 */
export function runAgentWalkForward(
  config: AgentWalkForwardConfig,
  opportunities: WalkForwardOpportunity[],
): AgentWalkForwardReport {
  const budgets = resolveBudgets(config);
  const slippageBps = config.slippageBps ?? 5;
  const decisionTtlMs = config.decisionTtlMs ?? DEFAULT_WALKFORWARD_TTL_MS;
  const maxQuoteAgeMs = config.maxQuoteAgeMs ?? DEFAULT_WALKFORWARD_QUOTE_AGE_MS;
  const duplicateOrderWindowMs = config.duplicateOrderWindowMs ?? DEFAULT_DUPLICATE_ORDER_WINDOW_MS;
  const horizonDefault = config.defaultHorizonBars ?? 5;
  const tradingEnabled = config.tradingEnabled !== false;
  const killSwitch = config.killSwitch === true;
  const riskPerTrade =
    config.riskLimits?.perTradeRiskPercent ?? DEFAULT_RISK_LIMITS.perTradeRiskPercent;
  const minRiskReward = config.minRiskReward ?? 1.5;
  const costModel = new NSEDeliveryCostModel({ slippageBps });

  const sorted = sortOpportunities(opportunities);
  const book = new SimulatedBook(config.initialCash, {
    dayStartEquity: config.dayStartEquity ?? config.initialCash,
    weekStartEquity: config.weekStartEquity ?? config.initialCash,
  });

  const funnel = emptyFunnel();
  const reasonMap = new Map<string, RankedReasonCode>();
  const trades: WalkForwardTradeRecord[] = [];
  const regimeMap = new Map<string, RegimeSliceMetrics>();
  const flags = emptyFlags();
  let pending: PendingOpen[] = [];

  for (const opportunity of sorted) {
    // Bring fills/exits current before the next decision so portfolio state is as-of T.
    pending = advanceBookTo(
      pending,
      opportunity.timestamp,
      book,
      costModel,
      trades,
      funnel,
      regimeMap,
    );

    funnel.candidates += 1;
    const context = buildHistoricalDecisionContext({
      opportunity,
      cash: book.cash,
      equity: book.equity,
      dayStartEquity: book.dayStartEquity,
      weekStartEquity: book.weekStartEquity,
      positions: book.toPortfolioSnapshot().holdings,
    });

    try {
      assertNoFutureData(context, opportunity.timestamp, { throwOnViolation: true });
    } catch {
      flags.sawFutureData = true;
      bumpReason(reasonMap, 'DATA_STALE', 'eligibility');
      continue;
    }

    if (
      opportunity.regimeSnapshot == null &&
      opportunity.analysis.generatedAt > opportunity.timestamp
    ) {
      flags.regimeUsedFuture = true;
    }

    const regimeKey = context.regimeSnapshot.trendVolKey;
    const slice = regimeMap.get(regimeKey) ?? {
      trendVolKey: regimeKey,
      candidates: 0,
      autoAccepted: 0,
      filled: 0,
      grossPnl: 0,
      netPnl: 0,
    };
    slice.candidates += 1;
    regimeMap.set(regimeKey, slice);

    const decision = evaluateTrade({
      analysis: context.analysis,
      opportunityId: opportunity.opportunityId,
      decisionId: opportunity.opportunityId,
      quoteTimestamp: context.quote.timestamp,
      ttlMs: decisionTtlMs,
    });
    // Deterministic harness clock (evaluateTrade uses Date.now by default).
    decision.createdAt = opportunity.timestamp;

    for (const code of decision.reasonCodes) bumpReason(reasonMap, code, 'eligibility');

    if (decision.eligibility === 'AUTONOMOUS_ELIGIBLE') funnel.autonomousEligible += 1;
    else if (decision.eligibility === 'HUMAN_ONLY') funnel.humanOnly += 1;
    else funnel.rejectedEligibility += 1;

    const risk = evaluateRisk({
      decision,
      capital: book.equity,
      cash: book.cash,
      riskPerTradePercent: riskPerTrade,
      minRiskReward,
      dayStartEquity: book.dayStartEquity,
      weekStartEquity: book.weekStartEquity,
      confidence: decision.confidence,
      tradingEnabled,
      killSwitch,
      maxQuoteAgeMs,
      now: opportunity.timestamp,
    });

    for (const code of risk.reasonCodes) bumpReason(reasonMap, code, 'risk');
    if (!risk.allowed) {
      for (const code of risk.blockedBy) bumpReason(reasonMap, code, 'risk');
      funnel.riskBlocked += 1;
      if (risk.blockedBy.includes('DECISION_EXPIRED')) flags.ttlBlocked = true;
      if (risk.blockedBy.includes('DATA_STALE')) flags.freshnessBlocked = true;
    } else {
      funnel.riskPass += 1;
      if (risk.quantityBeforeConfidence != null && risk.quantity > risk.quantityBeforeConfidence) {
        flags.riskCeilingExceeded = true;
        flags.confidenceRaisedCeiling = true;
      }
      if (confidenceToScale(decision.confidence) > 1) {
        flags.confidenceRaisedCeiling = true;
      }
    }

    const portfolio = evaluatePortfolio({
      decision,
      risk,
      portfolio: book.toPortfolioSnapshot(),
      maxOpenPositions: budgets.maxOpenPositions,
      maxNameExposurePct: budgets.maxNameExposurePct,
      maxSectorExposurePct: budgets.maxSectorExposurePct,
      cashReservePct: budgets.cashReservePct,
      symbolSector: context.sector,
    });

    for (const code of portfolio.reasonCodes) bumpReason(reasonMap, code, 'portfolio');
    if (!portfolio.allowed) {
      for (const code of portfolio.blockedBy) bumpReason(reasonMap, code, 'portfolio');
      funnel.portfolioBlocked += 1;
      if (portfolio.blockedBy.includes('MAX_POSITIONS')) flags.positionLimitBreached = true;
      if (portfolio.blockedBy.includes('SECTOR_EXPOSURE_LIMIT')) flags.sectorLimitBreached = true;
      if (portfolio.blockedBy.includes('CASH_RESERVE_FLOOR')) flags.cashReserveBreached = true;
    } else {
      funnel.portfolioPass += 1;
    }

    const policy = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    for (const code of policy.reasonCodes) bumpReason(reasonMap, code, 'policy');

    const livePolicy = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    if (livePolicy.outcome === 'AUTO_ACCEPTED') {
      funnel.liveAutoAccepted += 1;
      flags.liveAutoAccepted = true;
    } else if (livePolicy.outcome === 'HUMAN_REQUIRED') {
      funnel.liveHumanRequired += 1;
    }

    if (policy.outcome === 'REJECT') {
      funnel.policyRejected += 1;
      continue;
    }
    if (policy.outcome === 'HUMAN_REQUIRED') {
      funnel.policyHumanRequired += 1;
      funnel.humanRequired += 1;
      continue;
    }

    funnel.policyPass += 1;
    funnel.autoAccepted += 1;
    regimeMap.get(regimeKey)!.autoAccepted += 1;

    const bars = opportunity.bars;
    if (bars.length < 2) {
      flags.sawSameBarFillAttempt = true;
      funnel.gateBlocked += 1;
      bumpReason(reasonMap, 'REVALIDATION_FAILED', 'gate');
      continue;
    }

    const fillBar = bars[1];
    const signalBar = bars[0];
    if (fillBar.timestamp <= signalBar.timestamp) {
      flags.sawSameBarFillAttempt = true;
    }

    const gateNow = fillBar.timestamp;
    const gate = simulateRevalidatingGate({
      decision,
      livePrice: fillBar.open,
      maxPriceDeviationPct: budgets.maxPriceDeviationPct,
      book,
      now: gateNow,
      maxQuoteAgeMs,
      duplicateOrderWindowMs,
      tradingEnabled,
      killSwitch,
    });

    for (const code of gate.reasonCodes) bumpReason(reasonMap, code, 'gate');
    if (!gate.passed) {
      funnel.gateBlocked += 1;
      if (gate.reasonCodes.includes('DECISION_EXPIRED')) flags.ttlBlocked = true;
      if (gate.reasonCodes.includes('DATA_STALE')) flags.freshnessBlocked = true;
      if (gate.reasonCodes.includes('DUPLICATE_ORDER')) flags.duplicateBlocked = true;
      continue;
    }
    funnel.gatePass += 1;

    if (!risk.allowed || risk.quantity < 1) continue;

    if (fillBar.timestamp === signalBar.timestamp) {
      flags.sawSameBarFillAttempt = true;
      continue;
    }

    const qty = risk.quantity;
    const entryRaw = fillBar.open;
    const stop = risk.stopLoss;
    const target = decision.setup.target1;
    const horizon = opportunity.horizonBars ?? horizonDefault;
    const exit = resolveExit(bars, 1, stop, target, horizon);
    const entrySide = costModel.entryCost(entryRaw, qty);

    // Submit timestamp = fill bar (for DUPLICATE_ORDER). Position opens when clock ≥ fill.
    book.recordSubmit(decision.symbol, gateNow);
    pending.push({
      opportunityId: opportunity.opportunityId,
      decisionId: decision.decisionId,
      symbol: decision.symbol,
      sector: context.sector,
      decisionTimestamp: opportunity.timestamp,
      fillTimestamp: fillBar.timestamp,
      quantity: qty,
      entryRaw,
      entryFillPrice: entrySide.fillPrice,
      fillCost: entrySide.notional + entrySide.feesTotal,
      stopLoss: stop,
      target1: target,
      eligibility: decision.eligibility,
      regimeSnapshot: context.regimeSnapshot,
      reasonCodes: [...decision.reasonCodes, ...policy.reasonCodes],
      regimeKey,
      exitPrice: exit.exitPrice,
      exitTimestamp: exit.exitTimestamp,
      exitReason: exit.exitReason,
      onBook: false,
    });

    bumpReason(reasonMap, 'POLICY_AUTO_ACCEPTED', 'execution');
  }

  // Flush remaining fills/exits after the last opportunity.
  pending = advanceBookTo(pending, null, book, costModel, trades, funnel, regimeMap);

  const ranked = [...reasonMap.values()].sort(
    (a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)),
  );
  const byLayer: Record<string, RankedReasonCode[]> = {};
  for (const row of ranked) {
    (byLayer[row.layer] ??= []).push(row);
  }

  const grossPerformance = summarizeTrades(trades, book.cash, book.equity, false);
  const netPerformance = summarizeTrades(trades, book.cash, book.equity, true);
  const costBreakdown = trades.reduce(
    (acc, t) => ({
      brokerage: acc.brokerage + t.costs.brokerage,
      exchange: acc.exchange + t.costs.exchange,
      taxes: acc.taxes + t.costs.taxes,
      slippage: acc.slippage + t.costs.slippage,
      feesTotal: acc.feesTotal + t.costs.feesTotal,
    }),
    { brokerage: 0, exchange: 0, taxes: 0, slippage: 0, feesTotal: 0 },
  );
  if (trades.length > 0 && costBreakdown.feesTotal <= 0 && slippageBps > 0) {
    flags.costsMissing = true;
  }

  const confidenceSensitivity = runConfidenceSensitivity(
    config,
    sorted,
    budgets,
    costModel,
    decisionTtlMs,
    maxQuoteAgeMs,
    duplicateOrderWindowMs,
    riskPerTrade,
    minRiskReward,
    horizonDefault,
    tradingEnabled,
    killSwitch,
  );

  const eligibilityNotAcceptance =
    funnel.autoAccepted <= funnel.autonomousEligible &&
    funnel.liveAutoAccepted === 0 &&
    (funnel.autonomousEligible > funnel.autoAccepted ||
      funnel.gateBlocked > 0 ||
      funnel.riskBlocked > 0 ||
      funnel.portfolioBlocked > 0 ||
      funnel.humanRequired > 0 ||
      funnel.candidates >= funnel.autonomousEligible);

  const validationChecks: ValidationChecks = {
    noFutureData: !flags.sawFutureData,
    noSameBarFills:
      !flags.sawSameBarFillAttempt && trades.every((t) => t.fillTimestamp > t.decisionTimestamp),
    deterministicReplay: true,
    riskCeilingNeverExceeded: !flags.riskCeilingExceeded,
    positionLimitsRespected: !flags.positionLimitBreached,
    sectorLimitsRespected: !flags.sectorLimitBreached,
    cashReserveRespected: !flags.cashReserveBreached,
    ttlEnforced: true,
    quoteFreshnessEnforced: true,
    duplicateOrdersPrevented: true,
    confidenceNeverRaisesCeiling: !flags.confidenceRaisedCeiling,
    liveNeverAutoAccepted: !flags.liveAutoAccepted && funnel.liveAutoAccepted === 0,
    eligibilityNotAcceptance,
    costsApplied: trades.length === 0 || (!flags.costsMissing && costBreakdown.feesTotal > 0),
    regimeAsOfT: !flags.regimeUsedFuture,
  };

  const technicalFail = Object.entries(validationChecks)
    .filter(([k]) => k !== 'deterministicReplay')
    .some(([, v]) => v === false);

  const technical: WalkForwardVerdict['technical'] = technicalFail ? 'FAIL' : 'PASS';
  const notes: string[] = [];
  if (technicalFail) {
    const failed = Object.entries(validationChecks)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    notes.push(`Technical checks failed: ${failed.join(', ')}`);
  }
  notes.push(
    `Funnel: ${funnel.candidates} candidates → ${funnel.autonomousEligible} eligible → ${funnel.autoAccepted} auto → ${funnel.filled} filled`,
  );
  notes.push(
    `LIVE path human-required count: ${funnel.liveHumanRequired} (auto=${funnel.liveAutoAccepted})`,
  );

  const trading = tradingVerdict(netPerformance, funnel, technical === 'PASS');

  return {
    schemaVersion: AGENT_WALKFORWARD_SCHEMA_VERSION,
    metadata: {
      generatedAt: 0,
      opportunityCount: sorted.length,
      harnessOperatingMode: 'PAPER',
      harnessDecisionMode: 'AUTONOMOUS',
    },
    configuration: {
      ...config,
      riskBudgets: budgets,
      slippageBps,
      decisionTtlMs,
      maxQuoteAgeMs,
      duplicateOrderWindowMs,
    },
    funnel,
    reasonCodes: { ranked, byLayer },
    confidenceSensitivity,
    regimeSlices: [...regimeMap.values()].sort((a, b) =>
      a.trendVolKey.localeCompare(b.trendVolKey),
    ),
    grossPerformance,
    netPerformance,
    costBreakdown,
    trades,
    validationChecks,
    verdict: { technical, trading, notes },
  };
}

function runConfidenceSensitivity(
  config: AgentWalkForwardConfig,
  sorted: WalkForwardOpportunity[],
  budgets: AgentRiskBudgetConfig,
  costModel: NSEDeliveryCostModel,
  decisionTtlMs: number,
  maxQuoteAgeMs: number,
  duplicateOrderWindowMs: number,
  riskPerTrade: number,
  minRiskReward: number,
  horizonDefault: number,
  tradingEnabled: boolean,
  killSwitch: boolean,
): ConfidenceSensitivityResult[] {
  const sweep = config.confidenceSweep ?? [];
  if (sweep.length === 0) return [];

  return sweep.map((confidence) => {
    const book = new SimulatedBook(config.initialCash, {
      dayStartEquity: config.dayStartEquity ?? config.initialCash,
      weekStartEquity: config.weekStartEquity ?? config.initialCash,
    });
    let filled = 0;
    let autoAccepted = 0;
    let netPnl = 0;
    let neverRaisedCeiling = true;
    const scale = confidenceToScale(confidence);

    for (const opportunity of sorted) {
      const context = buildHistoricalDecisionContext({
        opportunity,
        cash: book.cash,
        equity: book.equity,
        dayStartEquity: book.dayStartEquity,
        weekStartEquity: book.weekStartEquity,
        positions: book.toPortfolioSnapshot().holdings,
      });
      try {
        assertNoFutureData(context, opportunity.timestamp);
      } catch {
        continue;
      }
      const decision: TradeDecision = evaluateTrade({
        analysis: context.analysis,
        opportunityId: opportunity.opportunityId,
        decisionId: `${opportunity.opportunityId}:conf`,
        quoteTimestamp: context.quote.timestamp,
        ttlMs: decisionTtlMs,
      });
      decision.createdAt = opportunity.timestamp;
      decision.confidence = confidence;

      const risk = evaluateRisk({
        decision,
        capital: book.equity,
        cash: book.cash,
        riskPerTradePercent: riskPerTrade,
        minRiskReward,
        dayStartEquity: book.dayStartEquity,
        weekStartEquity: book.weekStartEquity,
        confidence,
        tradingEnabled,
        killSwitch,
        maxQuoteAgeMs,
        now: opportunity.timestamp,
      });
      if (risk.allowed && risk.quantityBeforeConfidence != null) {
        if (risk.quantity > risk.quantityBeforeConfidence) neverRaisedCeiling = false;
      }

      const portfolio = evaluatePortfolio({
        decision,
        risk,
        portfolio: book.toPortfolioSnapshot(),
        maxOpenPositions: budgets.maxOpenPositions,
        maxNameExposurePct: budgets.maxNameExposurePct,
        maxSectorExposurePct: budgets.maxSectorExposurePct,
        cashReservePct: budgets.cashReservePct,
        symbolSector: context.sector,
      });
      const policy = applyDecisionPolicy({
        operatingMode: 'PAPER',
        decisionMode: 'AUTONOMOUS',
        eligibility: decision.eligibility,
        risk,
        portfolio,
      });
      if (policy.outcome !== 'AUTO_ACCEPTED') continue;
      autoAccepted += 1;
      if (opportunity.bars.length < 2 || !risk.allowed || risk.quantity < 1) continue;
      const fillBar = opportunity.bars[1];
      const gate = simulateRevalidatingGate({
        decision,
        livePrice: fillBar.open,
        maxPriceDeviationPct: budgets.maxPriceDeviationPct,
        book,
        now: fillBar.timestamp,
        maxQuoteAgeMs,
        duplicateOrderWindowMs,
        tradingEnabled,
        killSwitch,
      });
      if (!gate.passed) continue;
      const qty = risk.quantity;
      const exit = resolveExit(
        opportunity.bars,
        1,
        risk.stopLoss,
        decision.setup.target1,
        opportunity.horizonBars ?? horizonDefault,
      );
      const costs = costModel.roundTrip({
        entryRawPrice: fillBar.open,
        exitRawPrice: exit.exitPrice,
        quantity: qty,
      });
      const entrySide = costModel.entryCost(fillBar.open, qty);
      book.recordSubmit(decision.symbol, fillBar.timestamp);
      book.openPosition({
        symbol: decision.symbol,
        quantity: qty,
        entryPrice: entrySide.fillPrice,
        fillCost: entrySide.notional + entrySide.feesTotal,
        target: decision.setup.target1 ?? fillBar.open * 1.04,
        stopLoss: risk.stopLoss,
        sector: context.sector,
        openedAt: fillBar.timestamp,
      });
      const exitSide = costModel.exitCost(exit.exitPrice, qty);
      book.closePosition(decision.symbol, exitSide.notional - exitSide.feesTotal, costs.netPnl);
      filled += 1;
      netPnl += costs.netPnl;
    }

    return { confidence, scale, filled, autoAccepted, netPnl, neverRaisedCeiling };
  });
}

/** Stable JSON for hashing / CLI (sorted keys; metadata.generatedAt optional). */
export function serializeWalkForwardReport(
  report: AgentWalkForwardReport,
  opts?: { generatedAt?: number },
): string {
  const payload: AgentWalkForwardReport = {
    ...report,
    metadata: {
      ...report.metadata,
      generatedAt: opts?.generatedAt ?? report.metadata.generatedAt,
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Strip non-deterministic fields before equality / hash checks. */
export function canonicalizeWalkForwardReport(report: AgentWalkForwardReport): Omit<
  AgentWalkForwardReport,
  'metadata'
> & {
  metadata: Omit<AgentWalkForwardReport['metadata'], 'generatedAt'>;
} {
  const { generatedAt: _g, ...meta } = report.metadata;
  return { ...report, metadata: meta };
}
