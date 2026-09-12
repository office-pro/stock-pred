import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  AGENT_DISCLAIMER,
  AgentAnalysis,
  AgentCapabilityRequest,
  AgentCapabilityStatus,
  AgentDecisionMode,
  AgentDecisionState,
  AgentLiveArming,
  AgentManagedPosition,
  AgentMode,
  AgentRecommendation,
  AgentRecommendationAction,
  AgentRiskBudgetConfig,
  AgentSuggestion,
  AgentWalkForwardReport,
  AltDataView,
  DecisionBudgetSnapshot,
  DecisionLedgerEntry,
  DecisionPolicyResult,
  DecisionReasonCode,
  DEFAULT_AGENT_RISK_BUDGETS,
  DEFAULT_LIVE_CAPS,
  DEFAULT_RISK_LIMITS,
  FundamentalView,
  GateResultSnapshot,
  HorizonPrediction,
  HumanDecisionAction,
  HumanIntelMetrics,
  HumanReasonCode,
  MarketContext,
  MultiTimeframeCandles,
  PortfolioSnapshot,
  PortfolioVerdict,
  PredictionHorizon,
  RiskVerdict,
  StockQuote,
  Timeframe,
  TradeDecision,
  TradeSide,
  WaitRecommendation,
  StructuredThesis,
  ExitRecommendation,
  ExitIntelligenceP5Context,
  DecisionWithLifecycle,
  TradeLifecycleSnapshot,
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
  FocusUniverseBatch,
  OpportunityEvidenceProvenance,
} from '@stockpred/shared-types';
import type { P7AggregateState, P7BreakerSubState, P7Enforcement } from '@stockpred/shared-types';
import {
  AGENT_CAPABILITY_DEFS,
  applyDecisionPolicy,
  isLiveAutoEffectivelyArmed,
  readP5EvidenceUnlock,
  DEFAULT_BREAKER_CONFIG,
  emptyBreakerMetrics,
  evaluateBreakers,
  loadScaleConfig,
  mapPool,
  TenantBreakerStore,
  applyWait,
  checkLiveCaps,
  computeHumanIntelMetrics,
  computeOpenNotional,
  deriveAgentRecommendation,
  isWaitExpired,
  rankOpportunitiesForDisplay,
  assessOpportunityRanking,
  stampRankingContextFromResult,
  assignFocusCandidates,
  buildDataProvenance,
  buildOpportunityEvidenceProvenance,
  prioritizeSymbolsForLiveRefresh,
  isNseCashSessionOpen,
  classifyQuoteStatus,
  buildCapabilityStatuses,
  buildIntelligenceSnapshot,
  candidatesFromAltData,
  capabilityRequestsFromStatuses,
  composeAgentAnalysis,
  confidenceToScale,
  approximateH4ClosesFromH1,
  approximateW1ClosesFromD1,
  inferTradeHorizon,
  evaluateExitPolicy,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  buildP7BreakerMetrics,
  emptyP7RecoveryStore,
  evaluateP7BreakerSystem,
  type CycleTimingMetrics,
  getEnv,
  getEnvNumber,
  isPortfolioSnapshot,
  requiredCapabilitiesMissing,
  OhPipelineMetricsCollector,
  OhExecutionHealthCollector,
  OhSafetyEventCollector,
  OhDataQualityCollector,
  validateQuoteSample,
  validateCandleSeries,
  validateFundamentals,
  validateMarketContext,
  buildOhReconciliationReport,
  buildOhOpsReport,
  buildWaitRecommendation,
  digestFromSnapshot,
  buildThesisSnapshot,
  reassessThesis,
  buildThesisHistoryEvent,
  digestFromStructuredThesis,
  detectWeakenedChanges,
  digestThesisEvidence,
  buildExitRecommendation,
  materializeTradeLifecycle,
  type TradeLifecycleWaitContext,
  diagnosticFromExecutionError,
  priceDeviationPct,
  OH2_PRICE_DEVIATION_PCT,
  ohStage,
  timeAsync,
  timeSync,
} from '@stockpred/shared-utils';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { AgentStateStore } from './agent-state-store';
import { DecisionLedgerStore } from './decision-ledger-store';
import { OpportunityRepository } from './opportunity-repository';
import { AgentTransactionAuditor } from './transaction-auditor';
import { readFocusUniverseLatest, writeFocusUniverseBatch } from './focus-universe-store';
import {
  cursorSdkConfigured,
  cursorSdkInstalled,
  appendProgressLine,
  launchCapabilityImplement,
  writeTaskBrief,
} from './implement-runner';
import { SuggestionStore } from './suggestion-store';
import { SoakController } from './soak-controller';

const EXEC_FAIL_CIRCUIT = 3;
const DUPLICATE_ORDER_WINDOW_MS = 60_000;

@Injectable()
export class AgentService implements OnModuleInit {
  /** Master gate — agent trading is off until the user enables it (persisted). */
  private tradingEnabled = false;
  private mode: AgentMode = 'PAPER';
  private decisionMode: AgentDecisionMode = 'APPROVAL';
  private killSwitch = false;
  private liveArmed = false;
  private liveUserConfirmed = false;
  /** Operator ARM LIVE AUTONOMOUS latch (default false). Effective only with P5 GO. */
  private liveAutoArmed = false;
  private brokerConfigured = false;
  private brokerTestOk = false;
  private execFailStreak = 0;
  /** Phase 7 breaker runtime counters (stop-only; never authorize). */
  private breakerDayKey = '';
  private dailyAutoAcceptCount = 0;
  private consecutiveVetoCount = 0;
  private autoPnlDrawdownPct = 0;
  private lastQuoteAgeMs: number | null = 0;
  private lastScoreAbsZ: number | null = null;
  private lastSlippageAbsBps: number | null = null;
  private readonly p7RecoveryStore = emptyP7RecoveryStore();
  private lastP7AggregateState: P7AggregateState = 'INSUFFICIENT';
  private lastP7Enforcement: P7Enforcement = 'NONE';
  private lastP7SubStates: Partial<Record<string, P7BreakerSubState>> = {};
  private lastBreakerTripAt: number | null = null;
  private lastBreakerReasonCodes: DecisionReasonCode[] = [];
  private lastBreakerReasons: string[] = [];

  /** Phase 8 throughput knobs (analysis parallel; accept sequential). */
  private readonly scaleConfig = loadScaleConfig();
  private readonly tenantBreakers = new TenantBreakerStore();
  private lastCycleMetrics: CycleTimingMetrics | null = null;
  private riskBudgets: AgentRiskBudgetConfig = { ...DEFAULT_AGENT_RISK_BUDGETS };
  /** Cached portfolio anchors for soak baselines (updated on portfolio fetch). */
  private lastPortfolioEquity = 0;
  private lastPortfolioCash = 0;
  private lastOpenPositions = 0;
  private lastDayStartEquity = 0;
  private lastWeekStartEquity = 0;
  private soakController: SoakController | null = null;
  /** OH-1 observe-only pipeline timings (never authorizes). */
  private readonly ohMetrics = new OhPipelineMetricsCollector();
  /** OH-2 observe-only execution health (never authorizes). */
  private readonly ohExecution = new OhExecutionHealthCollector();
  /** OH-4 observe-only kill/disarm safety events (never authorizes). */
  private readonly ohSafety = new OhSafetyEventCollector();
  /** OH-5 observe-only data quality (never authorizes; never writes lastQuoteAgeMs). */
  private readonly ohDataQuality = new OhDataQualityCollector();
  /** Symbol → last order-submit attempt (DUPLICATE_ORDER gate). */
  private readonly recentSubmits = new Map<string, number>();
  private readonly recommendations = new Map<string, AgentRecommendation>();
  private readonly positionNotes = new Map<
    string,
    { policy: AgentManagedPosition['policy']; note: string; target2?: number }
  >();
  private readonly suggestions = new SuggestionStore();
  private readonly stateStore = new AgentStateStore();
  private readonly ledger = new DecisionLedgerStore();
  /** Frozen T1.8 ranking batch from the latest getOpportunities call — never re-ranked at decision time. */
  private lastOpportunityRanking: ReturnType<typeof assessOpportunityRanking> | null = null;
  /** Latest FocusUniverseBatch (optimization-only; never authorization). */
  private lastFocusBatch: FocusUniverseBatch | null = null;
  /** Provenance stamped per opportunity id at getOpportunities / offline→live handoff. */
  private readonly opportunityProvenance = new Map<string, OpportunityEvidenceProvenance>();
  private readonly opportunitiesDb = new OpportunityRepository();
  private readonly transactionAuditor = new AgentTransactionAuditor();

  private readonly marketDataUrl = getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002');
  private readonly signalUrl = getEnv('SIGNAL_ENGINE_URL', 'http://localhost:3003');
  private readonly patternUrl = getEnv('PATTERN_ENGINE_URL', 'http://localhost:3004');
  private readonly autoTraderUrl = getEnv('AUTO_TRADER_URL', 'http://localhost:3006');
  private readonly mlUrl = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
  private readonly riskPct = getEnvNumber(
    'RISK_PER_TRADE_PCT',
    DEFAULT_RISK_LIMITS.perTradeRiskPercent,
  );

  async onModuleInit(): Promise<void> {
    const saved = this.stateStore.load();
    this.tradingEnabled = saved.tradingEnabled;
    this.mode = saved.mode === 'LIVE' ? 'PAPER' : saved.mode; // never auto-arm LIVE on boot
    this.decisionMode = saved.decisionMode === 'AUTONOMOUS' ? 'AUTONOMOUS' : 'APPROVAL';
    this.killSwitch = saved.killSwitch;
    this.riskBudgets = { ...saved.riskBudgets };
    this.liveArmed = false;
    this.liveUserConfirmed = false;
    // Never restore effective LIVE auto on boot — require re-ARM after evidence check.
    this.liveAutoArmed = false;
    this.soakController = new SoakController();
    this.soakController.bindAgent(this);
    console.log(
      `[trader-agent] restored tradingEnabled=${this.tradingEnabled} mode=${this.mode} decisionMode=${this.decisionMode} killSwitch=${this.killSwitch}`,
    );
    await this.syncAutoTraderAgentGate(this.tradingEnabled);
  }

  getSoakController(): SoakController {
    if (!this.soakController) {
      this.soakController = new SoakController();
      this.soakController.bindAgent(this);
    }
    return this.soakController;
  }

  private persistState(): void {
    this.stateStore.save({
      tradingEnabled: this.tradingEnabled,
      mode: this.mode,
      decisionMode: this.decisionMode,
      killSwitch: this.killSwitch,
      liveAutoArmed: this.liveAutoArmed,
      riskBudgets: this.riskBudgets,
    });
  }

  private evidencePath(): string {
    return (
      process.env.P5_EVIDENCE_REVIEW_PATH ||
      resolve(__dirname, '../../data/p5-evidence-review-latest.json')
    );
  }

  /** Operator latch AND P5 evidence GO. */
  private liveAutoEffective(): boolean {
    return isLiveAutoEffectivelyArmed(this.liveAutoArmed, this.evidencePath());
  }

  getP5EvidenceUnlock(): ReturnType<typeof readP5EvidenceUnlock> {
    return readP5EvidenceUnlock(this.evidencePath());
  }

  /** OH-1: observe-only pipeline latency snapshot. */
  getOhPipelineMetrics(): import('@stockpred/shared-types').OhPipelineMetricsSnapshot {
    this.ohMetrics.noteQuoteAge(this.lastQuoteAgeMs);
    return this.ohMetrics.snapshot();
  }

  /** OH-2: observe-only execution health snapshot. */
  getOhExecutionHealth(): import('@stockpred/shared-types').OhExecutionHealthSnapshot {
    const connected = this.mode === 'LIVE' ? this.brokerTestOk : true;
    this.ohExecution.setBrokerConnected(connected);
    this.ohExecution.noteFailureStreak(this.execFailStreak);
    return this.ohExecution.snapshot();
  }

  /** OH-4: observe-only kill/disarm safety event snapshot. */
  getOhSafetyEvents(): import('@stockpred/shared-types').OhSafetyEventsSnapshot {
    return this.ohSafety.snapshot();
  }

  /** OH-5: observe-only data quality snapshot. */
  getOhDataQuality(): import('@stockpred/shared-types').OhDataQualitySnapshot {
    return this.ohDataQuality.snapshot();
  }

  /**
   * OH-6: unified operational report (OH-1…OH-5 aggregate).
   * Observe-only — never authorizes or mutates trading path.
   */
  async getOhOpsReport(
    userId?: string,
    brandId?: string,
  ): Promise<import('@stockpred/shared-types').OhOpsReportSnapshot> {
    try {
      const pipeline = this.getOhPipelineMetrics();
      const execution = this.getOhExecutionHealth();
      const safety = this.getOhSafetyEvents();
      const dataQuality = this.getOhDataQuality();
      let reconciliation: import('@stockpred/shared-types').OhReconciliationReport | null = null;
      try {
        reconciliation = await this.runOhReconciliation(userId, brandId);
      } catch {
        /* observe-only */
      }
      return buildOhOpsReport({
        pipeline,
        execution,
        reconciliation,
        safety,
        dataQuality,
      });
    } catch {
      return buildOhOpsReport({
        pipeline: this.ohMetrics.snapshot(),
        execution: this.ohExecution.snapshot(),
        reconciliation: null,
        safety: this.ohSafety.snapshot(),
        dataQuality: this.ohDataQuality.snapshot(),
      });
    }
  }

  /**
   * OH-3: observe-only ledger ↔ holdings ↔ positions reconciliation.
   * Never authorizes, resizes, or cancels — detect/report only.
   */
  async runOhReconciliation(
    userId?: string,
    brandId?: string,
  ): Promise<import('@stockpred/shared-types').OhReconciliationReport> {
    const ledgerRows = this.ledger.list(200);
    const portfolio = await this.fetchPortfolio(userId, brandId);
    const positions = await this.getPositions();
    return buildOhReconciliationReport({
      ledger: ledgerRows.map((row) => ({
        decisionId: row.decisionId,
        symbol: row.symbol,
        decision: row.decision,
        timestamp: row.timestamp,
        orderId: row.orderId,
        executionOrderId: row.execution?.orderId,
        executionQty: row.execution?.quantity,
        executionStatus: row.execution?.status,
        hasOutcome: row.outcome != null,
      })),
      holdings: (portfolio?.holdings ?? []).map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        entryPrice: h.entryPrice,
      })),
      positions: (positions.positions ?? []).map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
      })),
    });
  }

  /**
   * ARM / DISARM LIVE AUTONOMOUS (authorization latch).
   * ARM requires confirmLiveAuto === 'ARM LIVE AUTONOMOUS' and P5 evidence OVERALL=GO.
   * Evidence GO never auto-arms; DISARM always clears the latch.
   */
  setLiveAutoArmed(
    armed: boolean,
    confirmLiveAuto?: string,
  ): {
    liveAutoArmed: boolean;
    liveAutoEffective: boolean;
    evidence: ReturnType<typeof readP5EvidenceUnlock>;
  } {
    if (!armed) {
      try {
        this.ohSafety.record({ code: 'DISARM_REQUESTED', message: 'operator DISARM' });
      } catch {
        /* observe-only */
      }
      this.liveAutoArmed = false;
      this.persistState();
      try {
        this.ohSafety.record({ code: 'DISARM_CONFIRMED', message: 'liveAutoArmed=false' });
      } catch {
        /* observe-only */
      }
      console.log('[trader-agent] LIVE AUTONOMOUS disarmed');
      const evidence = this.getP5EvidenceUnlock();
      return {
        liveAutoArmed: false,
        liveAutoEffective: false,
        evidence,
      };
    }

    if (!this.tradingEnabled) {
      throw new ForbiddenException('Enable AI agent trading first');
    }
    if (this.killSwitch) {
      throw new ForbiddenException('Kill switch is active — cannot ARM LIVE AUTONOMOUS');
    }
    if (confirmLiveAuto !== 'ARM LIVE AUTONOMOUS') {
      throw new ForbiddenException(
        'LIVE autonomous requires confirmLiveAuto exactly equal to "ARM LIVE AUTONOMOUS"',
      );
    }
    const evidence = this.getP5EvidenceUnlock();
    if (!evidence.unlocked) {
      throw new ForbiddenException({
        message: evidence.reason,
        reasonCode: evidence.reasonCode ?? 'P5_EVIDENCE_GATE_NOT_PASSED',
        evidence,
      });
    }
    this.liveAutoArmed = true;
    this.persistState();
    console.log('[trader-agent] LIVE AUTONOMOUS armed (evidence unlock GO)');
    return {
      liveAutoArmed: true,
      liveAutoEffective: this.liveAutoEffective(),
      evidence,
    };
  }

  getMode(
    userId?: string,
    brandId?: string | null,
  ): {
    tradingEnabled: boolean;
    mode: AgentMode;
    decisionMode: AgentDecisionMode;
    killSwitch: boolean;
    liveArming: AgentLiveArming;
    /** Operator latch (may be true while still ineffective if evidence NO-GO). */
    liveAutoArmed: boolean;
    /** Effective LIVE auto authorization (armed AND evidence GO). */
    liveAutoEffective: boolean;
    evidenceUnlock: ReturnType<typeof readP5EvidenceUnlock>;
    breakers: ReturnType<AgentService['getBreakerStatus']>;
    scale: ReturnType<typeof loadScaleConfig>;
    lastCycleMetrics: AgentService['lastCycleMetrics'];
    disclaimer: string;
    riskBudgets: AgentRiskBudgetConfig;
  } {
    const evidenceUnlock = this.getP5EvidenceUnlock();
    return {
      tradingEnabled: this.tradingEnabled,
      mode: this.mode,
      decisionMode: this.decisionMode,
      killSwitch: this.killSwitch,
      liveArming: this.liveArmingStatus(),
      liveAutoArmed: this.liveAutoArmed,
      liveAutoEffective: this.liveAutoEffective(),
      evidenceUnlock,
      breakers: this.getBreakerStatus(userId, brandId),
      scale: this.scaleConfig,
      lastCycleMetrics: this.lastCycleMetrics,
      disclaimer: AGENT_DISCLAIMER,
      riskBudgets: { ...this.riskBudgets },
    };
  }

  /** Phase 5 multi-signal human-intelligence metrics (not LIVE P&L alone). */
  getHumanIntelMetrics(limit = 500): { metrics: HumanIntelMetrics } {
    const entries = this.ledger.list(limit);
    return { metrics: computeHumanIntelMetrics(entries) };
  }

  /**
   * Phase 5 WAIT — records human WAIT evidence; never submits to Gate.
   * PENDING/WAITING → WAITING with TTL.
   */
  async waitRecommendation(
    id: string,
    userId?: string,
    reason?: string,
  ): Promise<{ recommendation: AgentRecommendation; decision: DecisionLedgerEntry }> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required');
    }
    const persisted = await this.opportunitiesDb.findForUser(id, userId);
    const rec =
      persisted != null
        ? this.opportunitiesDb.toRecommendation(persisted)
        : this.recommendations.get(id);
    if (!rec) throw new NotFoundException('Recommendation not found');
    if (rec.status !== 'PENDING' && rec.status !== 'WAITING') {
      throw new BadRequestException(`Recommendation is ${rec.status}`);
    }
    if (rec.wait && isWaitExpired(rec.wait, Date.now())) {
      rec.status = 'EXPIRED';
      this.recommendations.set(id, rec);
      throw new BadRequestException('WAIT TTL expired');
    }

    const wait = applyWait({
      now: Date.now(),
      reason,
      previous: rec.wait ?? null,
    });
    rec.status = 'WAITING';

    const portfolio = await this.fetchPortfolio(userId);
    if (!portfolio) {
      throw new BadRequestException('Portfolio unavailable — cannot record WAIT');
    }
    const pipeline = await this.runDecisionPipeline(rec.analysis, portfolio, {
      opportunityId: id,
      decisionId: id,
    });

    const now = Date.now();
    const waitIntel = buildWaitRecommendation({
      now,
      analysis: rec.analysis,
      snapshot: pipeline.intelligenceSnapshot,
      previousWait: { ...wait, priorDigest: rec.wait?.priorDigest },
    });
    rec.wait = {
      ...wait,
      waitIntelligence: waitIntel,
      lastWaitRecommendationAt: now,
      priorDigest: digestFromSnapshot(pipeline.intelligenceSnapshot),
    };
    this.recommendations.set(id, rec);

    const decision = this.recordLedger(
      pipeline,
      'WAITING',
      'WAIT',
      undefined,
      [],
      reason ? [`Human WAIT: ${reason}`] : ['Human WAIT'],
      {
        agentRecommendation: deriveAgentRecommendation({ decision: String(rec.analysis.decision) }),
        humanDecision: 'HUMAN_WAIT',
        humanReasonCode: reason,
        waitIntelligence: waitIntel,
        analysis: rec.analysis,
      },
    );

    return { recommendation: rec, decision };
  }

  /**
   * Phase 5 REJECT — records human REJECT evidence; never submits to Gate.
   * PENDING/WAITING → REJECTED.
   */
  async rejectRecommendation(
    id: string,
    userId?: string,
    reason?: string,
  ): Promise<{ recommendation: AgentRecommendation; decision: DecisionLedgerEntry }> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required');
    }
    const persisted = await this.opportunitiesDb.findForUser(id, userId);
    const rec =
      persisted != null
        ? this.opportunitiesDb.toRecommendation(persisted)
        : this.recommendations.get(id);
    if (!rec) throw new NotFoundException('Recommendation not found');
    if (rec.status !== 'PENDING' && rec.status !== 'WAITING') {
      throw new BadRequestException(`Recommendation is ${rec.status}`);
    }

    rec.status = 'REJECTED';
    this.recommendations.set(id, rec);
    try {
      await this.opportunitiesDb.markRejected(id, userId);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to persist REJECT',
      );
    }

    const portfolio = await this.fetchPortfolio(userId);
    if (!portfolio) {
      throw new BadRequestException('Portfolio unavailable — cannot record REJECT');
    }
    const pipeline = await this.runDecisionPipeline(rec.analysis, portfolio, {
      opportunityId: id,
      decisionId: id,
    });

    const decision = this.recordLedger(
      pipeline,
      'REJECTED',
      'REJECT',
      undefined,
      [],
      reason ? [`Human REJECT: ${reason}`] : ['Human REJECT'],
      {
        agentRecommendation: deriveAgentRecommendation({
          decision: String(rec.analysis.decision),
        }),
        humanDecision: 'HUMAN_REJECT',
        humanReasonCode: reason,
        analysis: rec.analysis,
      },
    );

    return { recommendation: rec, decision };
  }

  /** Read-only Phase 2 risk/portfolio budgets. */
  getRiskBudgets(): { riskBudgets: AgentRiskBudgetConfig } {
    return { riskBudgets: { ...this.riskBudgets } };
  }

  /** Read-only Phase 3 walk-forward report if present on disk. */
  getWalkForwardReport(): {
    report: AgentWalkForwardReport | null;
    path: string | null;
  } {
    const candidates = [
      resolve(__dirname, '../../data/agent-walkforward.json'),
      resolve(process.cwd(), 'data/agent-walkforward.json'),
      resolve(process.cwd(), 'apps/trader-agent/data/agent-walkforward.json'),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as AgentWalkForwardReport;
        if (raw?.schemaVersion !== 'agent-walkforward.v1') continue;
        return { report: raw, path };
      } catch {
        continue;
      }
    }
    return { report: null, path: null };
  }

  setDecisionMode(decisionMode: AgentDecisionMode): {
    decisionMode: AgentDecisionMode;
    note: string;
  } {
    if (!this.tradingEnabled) {
      throw new ForbiddenException('Enable AI agent trading first');
    }
    this.decisionMode = decisionMode;
    if (decisionMode === 'APPROVAL') {
      this.execFailStreak = 0;
    }
    this.persistState();
    return {
      decisionMode: this.decisionMode,
      note:
        decisionMode === 'AUTONOMOUS'
          ? 'PAPER only in Phase 1: AUTO_ACCEPTED after risk + portfolio + policy. LIVE stays human-required.'
          : 'Human must approve each trade (pipeline still revalidates).',
    };
  }

  getDecisions(
    limit = 50,
    decisionId?: string,
  ): {
    decisions: DecisionWithLifecycle[];
    decisionMode: AgentDecisionMode;
  } {
    const rows = decisionId
      ? (() => {
          const one = this.ledger.get(decisionId) ?? this.ledger.getByOpportunity(decisionId);
          return one ? [one] : [];
        })()
      : this.ledger.list(limit);
    return {
      decisions: rows.map((decision) => ({
        decision,
        lifecycleSnapshot: this.buildLifecycleForDecision(decision),
      })),
      decisionMode: this.decisionMode,
    };
  }

  async getDecisionLifecycle(decisionId: string): Promise<TradeLifecycleSnapshot | null> {
    const decision = this.ledger.get(decisionId) ?? this.ledger.getByOpportunity(decisionId);
    if (!decision) return null;
    let exitAdvisory: ExitRecommendation | null = null;
    if (decision.execution && !decision.outcome) {
      exitAdvisory = await this.getExitIntelligence(decision.symbol);
    }
    return this.materializeLifecycleSnapshot(decision, exitAdvisory);
  }

  private buildLifecycleForDecision(decision: DecisionLedgerEntry): TradeLifecycleSnapshot {
    return this.materializeLifecycleSnapshot(decision, null);
  }

  private materializeLifecycleSnapshot(
    decision: DecisionLedgerEntry,
    exitAdvisory: ExitRecommendation | null,
  ): TradeLifecycleSnapshot {
    const now = Date.now();
    const thesisEvents = this.ledger.listThesisEvents(decision.decisionId);
    const outcomeRecords = this.listOutcomeRecordsForDecision(decision.decisionId);
    return materializeTradeLifecycle({
      now,
      decision,
      thesisEvents,
      outcomeRecords,
      exitAdvisory,
      waitContext: this.buildWaitContextForDecision(decision),
    });
  }

  private listOutcomeRecordsForDecision(
    decisionId: string,
  ): import('@stockpred/shared-types').DecisionOutcomeRecord[] {
    return this.ledger
      .listRaw(5_000)
      .filter(
        (row): row is import('@stockpred/shared-types').DecisionOutcomeRecord =>
          isDecisionOutcomeRecord(row) && row.decisionId === decisionId,
      );
  }

  private buildWaitContextForDecision(
    decision: DecisionLedgerEntry,
  ): TradeLifecycleWaitContext | null {
    if (decision.decision !== 'WAIT' && !decision.waitIntelligence) return null;
    const waitStartMs = decision.timestamp;
    const waitExpiresAtMs = decision.waitIntelligence?.expiryAt ?? null;
    let waitEndMs: number | null = null;
    if (decision.opportunityId) {
      const entries = this.ledger.listRaw(5_000);
      const selfIdx = entries.findIndex(
        (row) => isDecisionLedgerEntry(row) && row.decisionId === decision.decisionId,
      );
      if (selfIdx >= 0) {
        for (let i = selfIdx + 1; i < entries.length; i += 1) {
          const row = entries[i];
          if (
            isDecisionLedgerEntry(row) &&
            row.opportunityId === decision.opportunityId &&
            row.decisionId !== decision.decisionId &&
            row.decision !== 'WAIT'
          ) {
            waitEndMs = row.timestamp;
            break;
          }
        }
      }
    }
    return { waitStartMs, waitExpiresAtMs, waitEndMs };
  }

  /** Raw ledger stream for soak metrics (decisions + outcome events). */
  listLedgerRecords(limit = 5_000): import('@stockpred/shared-types').DecisionLedgerRecord[] {
    return this.ledger.listRaw(limit);
  }

  async setTradingEnabled(enabled: boolean): Promise<{ tradingEnabled: boolean }> {
    this.tradingEnabled = enabled;
    if (!enabled) {
      this.liveArmed = false;
      this.liveUserConfirmed = false;
      this.liveAutoArmed = false;
      if (this.mode === 'LIVE') this.mode = 'PAPER';
      try {
        this.ohSafety.record({
          code: 'TRADING_DISABLED',
          message: 'tradingEnabled=false; LIVE latch cleared',
        });
      } catch {
        /* observe-only */
      }
    }
    this.persistState();
    await this.syncAutoTraderAgentGate(enabled);
    return { tradingEnabled: this.tradingEnabled };
  }

  setMode(
    mode: AgentMode,
    confirmLive?: string,
  ): {
    mode: AgentMode;
    liveArming: AgentLiveArming;
  } {
    if (!this.tradingEnabled) {
      throw new ForbiddenException('Enable AI agent trading first');
    }
    if (mode === 'LIVE') {
      if (confirmLive !== 'ARM LIVE') {
        throw new ForbiddenException('LIVE requires confirmLive exactly equal to "ARM LIVE"');
      }
      const arming = this.liveArmingStatus();
      if (arming.blockers.length > 0) {
        throw new ForbiddenException(`LIVE blocked: ${arming.blockers.join('; ')}`);
      }
      this.liveUserConfirmed = true;
      this.liveArmed = true;
      this.mode = 'LIVE';
    } else {
      this.mode = mode;
      this.liveArmed = false;
      this.liveUserConfirmed = false;
    }
    this.persistState();
    return { mode: this.mode, liveArming: this.liveArmingStatus() };
  }

  setKillSwitch(enabled: boolean, flatten?: boolean): { killSwitch: boolean; flatten: boolean } {
    this.killSwitch = enabled;
    if (enabled) {
      try {
        this.ohSafety.record({
          code: 'KILL_SWITCH_TRIGGERED',
          message: flatten ? 'kill + flatten requested' : 'kill switch on',
        });
      } catch {
        /* observe-only */
      }
      if (this.liveArmed) this.liveArmed = false;
      if (this.liveAutoArmed) {
        this.liveAutoArmed = false;
        try {
          this.ohSafety.record({
            code: 'DISARM_CONFIRMED',
            message: 'liveAutoArmed cleared by kill switch',
          });
        } catch {
          /* observe-only */
        }
        console.log('[trader-agent] LIVE AUTONOMOUS disarmed (kill switch)');
      }
    }
    this.persistState();
    return { killSwitch: this.killSwitch, flatten: Boolean(flatten) };
  }

  recordBrokerConfig(ok: boolean): void {
    this.brokerConfigured = ok;
  }

  recordBrokerTest(ok: boolean): void {
    this.brokerTestOk = ok;
    this.ohExecution.setBrokerConnected(ok);
  }

  async listCapabilities(): Promise<{
    capabilities: AgentCapabilityStatus[];
    requests: AgentCapabilityRequest[];
  }> {
    const statuses = await this.probeCapabilities();
    await this.syncSuggestionsFromStatuses(statuses);
    const requests = capabilityRequestsFromStatuses(statuses).map((row) => ({
      ...row,
      acknowledged: this.suggestions.get(row.id)?.status === 'acknowledged',
    }));
    return { capabilities: statuses, requests };
  }

  acknowledgeCapability(id: string): { id: string; acknowledged: boolean } {
    if (!AGENT_CAPABILITY_DEFS.some((row) => row.id === id)) {
      throw new NotFoundException(`Unknown capability ${id}`);
    }
    const now = Date.now();
    const existing = this.suggestions.get(id);
    if (existing) {
      this.suggestions.patch(id, { status: 'acknowledged', acknowledgedAt: now });
    } else {
      const def = AGENT_CAPABILITY_DEFS.find((row) => row.id === id)!;
      this.suggestions.upsert({
        id,
        title: def.title,
        whyNeeded: def.description,
        suggestedOwner: def.owner,
        priority: def.required ? 'blocker' : 'medium',
        status: 'acknowledged',
        createdAt: now,
        updatedAt: now,
        acknowledgedAt: now,
      });
    }
    return { id, acknowledged: true };
  }

  reopenSuggestion(id: string): { id: string; status: 'open' } {
    if (!AGENT_CAPABILITY_DEFS.some((row) => row.id === id)) {
      throw new NotFoundException(`Unknown capability ${id}`);
    }
    const existing = this.suggestions.get(id);
    if (!existing) {
      throw new NotFoundException(`Suggestion ${id} not found`);
    }
    if (existing.status === 'implementing') {
      throw new BadRequestException('Cannot reopen while implementation is in progress');
    }
    this.suggestions.patch(id, {
      status: 'open',
      acknowledgedAt: undefined,
      lastError: undefined,
      resultSummary: existing.status === 'failed' ? undefined : existing.resultSummary,
    });
    return { id, status: 'open' };
  }

  async listSuggestions(): Promise<{
    suggestions: AgentSuggestion[];
    cursorSdk: { configured: boolean; installed: boolean };
  }> {
    const statuses = await this.probeCapabilities();
    await this.syncSuggestionsFromStatuses(statuses);
    return {
      suggestions: this.suggestions.list(),
      cursorSdk: {
        configured: cursorSdkConfigured(),
        installed: cursorSdkInstalled(),
      },
    };
  }

  async implementSuggestion(id: string): Promise<AgentSuggestion> {
    const statuses = await this.probeCapabilities();
    await this.syncSuggestionsFromStatuses(statuses);
    const suggestion = this.suggestions.get(id);
    if (!suggestion) throw new NotFoundException(`Suggestion ${id} not found`);
    if (suggestion.status === 'implementing') {
      return suggestion;
    }

    this.suggestions.patch(id, {
      status: 'implementing',
      lastError: undefined,
      resultSummary: 'Launching implementation…',
    });

    const launch = await launchCapabilityImplement(suggestion);
    const started = this.suggestions.patch(id, {
      status: 'implementing',
      taskBriefPath: launch.taskBriefPath,
      cursorAgentId: launch.agentId,
      cursorRunId: launch.runId,
      resultSummary: launch.summary,
      progressLog: appendProgressLine(
        [`[${new Date().toLocaleTimeString()}] ${launch.summary}`],
        launch.agentId
          ? `[${new Date().toLocaleTimeString()}] agent ${launch.agentId}`
          : `[${new Date().toLocaleTimeString()}] waiting for Cursor…`,
      ),
    });

    if (launch.mode === 'task-brief' || !launch.followProgress) {
      return (
        this.suggestions.patch(id, {
          status: 'brief_ready',
          taskBriefPath: launch.taskBriefPath,
          resultSummary: launch.summary,
          progressLog: appendProgressLine(started?.progressLog, launch.summary),
        }) ?? started!
      );
    }

    void launch
      .followProgress((line) => {
        const current = this.suggestions.get(id);
        const progressLog = appendProgressLine(current?.progressLog, line);
        const patched = this.suggestions.patch(id, {
          status: 'implementing',
          resultSummary: line,
          progressLog,
        });
        if (patched) {
          try {
            writeTaskBrief(patched);
          } catch {
            /* brief refresh is best-effort */
          }
        }
      })
      .then((result) => {
        const ok =
          result.status === 'finished' ||
          result.status === 'completed' ||
          result.status === 'success';
        this.suggestions.patch(id, {
          status: ok ? 'completed' : 'failed',
          resultSummary:
            typeof result.result === 'string' && result.result.trim()
              ? result.result.slice(0, 2000)
              : ok
                ? 'Cursor agent finished implementing the capability.'
                : `Cursor agent ended with status ${result.status}`,
          lastError: ok ? undefined : `Run status: ${result.status}`,
        });
      })
      .catch((error: unknown) => {
        this.suggestions.patch(id, {
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          resultSummary: 'Cursor agent run failed',
        });
      });

    return started!;
  }

  private async syncSuggestionsFromStatuses(statuses: AgentCapabilityStatus[]): Promise<void> {
    const now = Date.now();
    const requests = capabilityRequestsFromStatuses(statuses, now);
    const missingIds = new Set(requests.map((row) => row.id));

    for (const status of statuses) {
      if (!status.available || status.stale || missingIds.has(status.id)) continue;
      const existing = this.suggestions.get(status.id);
      if (!existing || existing.status === 'completed') continue;
      this.suggestions.patch(status.id, {
        status: 'completed',
        resultSummary: existing.resultSummary ?? `${status.title} is now available`,
        lastError: undefined,
      });
    }

    for (const request of requests) {
      const existing = this.suggestions.get(request.id);
      if (!existing) {
        this.suggestions.upsert({
          id: request.id,
          title: request.title,
          whyNeeded: request.whyNeeded,
          suggestedOwner: request.suggestedOwner,
          priority: request.priority,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
      // Refresh copy while keeping user progress (ack / implement).
      if (
        existing.status === 'open' ||
        existing.status === 'brief_ready' ||
        existing.status === 'acknowledged'
      ) {
        this.suggestions.patch(request.id, {
          title: request.title,
          whyNeeded: request.whyNeeded,
          suggestedOwner: request.suggestedOwner,
          priority: request.priority,
        });
      }
    }
  }

  /**
   * Read latest FocusUniverseBatch artifact (optimization-only).
   */
  getFocusUniverseLatest(): FocusUniverseBatch | null {
    const batch = readFocusUniverseLatest();
    this.lastFocusBatch = batch;
    return batch;
  }

  /**
   * Offline intelligence batch — STRICTLY READ-ONLY.
   * EOD/cached quotes → analyze → RankingContext lex order → FocusUniverseBatch artifact.
   * MUST NOT: ledger, human decisions, evaluateTrade auth chain, Risk/Portfolio/Policy/Gate,
   * orders, fills, outcomes, or syncPending opportunities.
   */
  async runOfflineFocusBatch(limit = 80): Promise<FocusUniverseBatch> {
    const generatedAt = Date.now();
    const quotes = await this.fetchCachedUniverseQuotes(limit);
    const scanCap = Math.min(this.scaleConfig.maxSymbolsScanned, Math.max(limit, 20));
    const candidates = quotes.slice(0, scanCap);

    const analyzed = await mapPool(
      candidates,
      this.scaleConfig.analysisConcurrency,
      async (quote) =>
        this.analyzeSymbol(quote.symbol, {
          quote,
          portfolio: null,
          statuses: [],
          requests: [],
        }),
    );

    const rankingCandidates = analyzed.map((analysis, i) => {
      // Read-only: do NOT call evaluateTrade / Risk / Portfolio / Policy / Gate.
      const stubDecision: TradeDecision = {
        decisionId: `offline-${analysis.symbol}-${i}`,
        symbol: analysis.symbol,
        intent: 'BUY',
        eligibility: 'HUMAN_ONLY',
        signalScore: analysis.scores.overall,
        confidence: analysis.setup.confidence,
        scores: analysis.scores,
        strategy: analysis.setup.instrument || 'COMPOSITE',
        marketRegime: analysis.marketRegime,
        thesis: analysis.thesis,
        counterThesis: analysis.counterThesis,
        invalidation: analysis.invalidation,
        reasons: [],
        reasonCodes: [],
        setup: {
          entry: analysis.setup.entry,
          stopLoss: analysis.setup.stopLoss,
          target1: analysis.setup.target1,
          target2: analysis.setup.target2,
          target3: analysis.setup.target3,
          riskReward: analysis.setup.riskReward,
          recommendedQty: analysis.setup.positionSize,
        },
        quoteTimestamp: analysis.generatedAt,
        createdAt: generatedAt,
        ttlMs: 30 * 60_000,
      };
      const snap = buildIntelligenceSnapshot({
        analysis,
        decision: stubDecision,
        sourceDataTimestamp: analysis.generatedAt,
      });
      return {
        opportunityId: stubDecision.decisionId,
        symbol: analysis.symbol,
        snapshot: snap,
        portfolioFit: 'GOOD' as const,
        analysis,
        quote: candidates.find((q) => q.symbol.toUpperCase() === analysis.symbol.toUpperCase()),
      };
    });

    const opportunityRanking = assessOpportunityRanking({
      context: {
        tradeHorizon: 'SWING_TRADE',
        strategyTag: 'BREAKOUT',
        timestamp: new Date(generatedAt).toISOString(),
      },
      candidates: rankingCandidates.map((c) => ({
        opportunityId: c.opportunityId,
        symbol: c.symbol,
        snapshot: c.snapshot,
        portfolioFit: c.portfolioFit,
      })),
    });

    const dataAsOf = candidates.reduce((max, q) => {
      const t = q.updatedAt;
      return t != null && Number.isFinite(t) && t > max ? t : max;
    }, 0);
    const dataStatus = classifyQuoteStatus(dataAsOf > 0 ? dataAsOf : null, generatedAt);

    const batch = assignFocusCandidates({
      batchId: `FOCUS-${generatedAt}`,
      generatedAt,
      dataAsOf: dataAsOf > 0 ? dataAsOf : generatedAt,
      source: 'EOD_CACHED',
      dataStatus,
      universeSize: candidates.length,
      ranked: opportunityRanking.rankings.map((r) => {
        const row = rankingCandidates.find((c) => c.opportunityId === r.opportunityId);
        return {
          symbol: r.symbol,
          rank: r.rank,
          opportunityId: r.opportunityId,
          rankingEngineVersion: opportunityRanking.engineVersion,
          calculationVersion: opportunityRanking.calculationVersion,
          tradeHorizon: opportunityRanking.context.tradeHorizon,
          strategyTag: opportunityRanking.context.strategyTag,
          thesis: row?.analysis.thesis,
          decision: row?.analysis.decision,
          overallScore: row?.analysis.scores.overall,
          dataAsOf: row?.quote?.updatedAt ?? dataAsOf,
        };
      }),
    });

    writeFocusUniverseBatch(batch);
    this.lastFocusBatch = batch;
    return batch;
  }

  private stampLiveProvenanceForOpportunity(
    opportunityId: string,
    symbol: string,
    quote: StockQuote | null | undefined,
  ): void {
    const now = Date.now();
    const dataProvenance = buildDataProvenance({
      dataAsOf: quote?.updatedAt,
      receivedAt: now,
      analysisAt: now,
      now,
    });
    const liveReady =
      isNseCashSessionOpen(now) &&
      (dataProvenance.dataStatus === 'LIVE' || dataProvenance.dataStatus === 'DELAYED');
    const prev = this.opportunityProvenance.get(opportunityId);
    const prov = buildOpportunityEvidenceProvenance({
      batch: this.lastFocusBatch ?? readFocusUniverseLatest(),
      symbol,
      dataProvenance,
      liveReady,
    });
    this.opportunityProvenance.set(opportunityId, {
      ...prov,
      discoverySource: prev?.discoverySource ?? prov.discoverySource,
      batchId: prev?.batchId ?? prov.batchId,
      focusTier: prev?.focusTier ?? prov.focusTier,
    });
  }

  /** Cached/EOD universe for offline batch — does not force ACTIONABLE live filter. */
  private async fetchCachedUniverseQuotes(limit: number): Promise<StockQuote[]> {
    try {
      const { data } = await axios.get<{ data: StockQuote[] }>(`${this.marketDataUrl}/stocks`, {
        params: { page: 1, limit: Math.min(limit, 200), sort: 'symbol' },
        timeout: 30_000,
      });
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Offline → live handoff: prioritize MDS refresh Tier1→2→3.
   * OFFLINE_PRESELECTED ≠ LIVE_READY until refresh + recalculation.
   */
  private async runFocusLiveHandoff(batch: FocusUniverseBatch): Promise<void> {
    if (!isNseCashSessionOpen()) return;
    const symbols = prioritizeSymbolsForLiveRefresh(batch).slice(0, 50);
    if (symbols.length === 0) return;
    try {
      await axios.post(
        `${this.marketDataUrl}/market/focus-refresh`,
        { symbols },
        { timeout: 120_000 },
      );
    } catch {
      // Best-effort: per-symbol GET still marks watched + refreshes.
      for (const symbol of symbols.slice(0, 15)) {
        try {
          await axios.get(`${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}`, {
            timeout: 8_000,
          });
        } catch {
          /* continue */
        }
      }
    }
  }

  async getOpportunities(
    limit = 20,
    userId?: string,
    brandId?: string,
  ): Promise<{
    mode: AgentMode;
    decisionMode: AgentDecisionMode;
    opportunities: AgentAnalysis[];
    ranked: ReturnType<typeof rankOpportunitiesForDisplay>;
    opportunityRanking: ReturnType<typeof assessOpportunityRanking>;
    added: Array<AgentAnalysis & { executedAt: number; quantity: number; status: 'APPROVED' }>;
    capabilityRequests: AgentCapabilityRequest[];
    disclaimer: string;
    autonomous?: { attempted: number; accepted: number; skipped: number };
    /** T2.1 advisory wait intelligence by opportunity id (display only). */
    waitIntelligenceById?: Record<string, WaitRecommendation>;
    /** T2.2 advisory thesis reassessment by opportunity id (display only). */
    thesisIntelligenceById?: Record<string, StructuredThesis>;
    focusBatchId?: string | null;
    opportunityProvenanceById?: Record<string, OpportunityEvidenceProvenance>;
  }> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required for per-user opportunities');
    }

    await this.opportunitiesDb.expireStale(userId);
    const statuses = await this.probeCapabilities();
    const requests = capabilityRequestsFromStatuses(statuses);
    const portfolio = await this.fetchPortfolio(userId, brandId);
    const held = new Set((portfolio?.holdings ?? []).map((lot) => lot.symbol.toUpperCase()));
    const alreadyAdded = await this.opportunitiesDb.addedSymbols(userId);
    const cash = portfolio?.cash ?? 0;

    // Offline → live handoff: refresh Focus tiers before building opportunities for humans.
    const focusBatch = readFocusUniverseLatest();
    this.lastFocusBatch = focusBatch;
    if (focusBatch && isNseCashSessionOpen()) {
      await this.runFocusLiveHandoff(focusBatch);
    }

    const quotes = await this.fetchActionableQuotes();
    const focusOrder = focusBatch ? prioritizeSymbolsForLiveRefresh(focusBatch) : [];
    const focusRank = new Map(focusOrder.map((s, i) => [s, i]));
    quotes.sort((a, b) => {
      const ai = focusRank.get(a.symbol.toUpperCase());
      const bi = focusRank.get(b.symbol.toUpperCase());
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return 0;
    });
    const pendingBatch: Array<{ id: string; analysis: AgentAnalysis; expiresAt: Date }> = [];
    const cycleStarted = Date.now();
    const scanCap = Math.min(this.scaleConfig.maxSymbolsScanned, Math.max(limit * 3, 20));
    const candidates = quotes.slice(0, scanCap).filter((quote) => {
      const sym = quote.symbol.toUpperCase();
      // Hide names already approved or already held for this user.
      return !held.has(sym) && !alreadyAdded.has(sym);
    });

    // P8: parallel ANALYSIS / opportunity prep only — never parallel authorize/execute.
    const analysisStarted = Date.now();
    const analyzed = await mapPool(
      candidates,
      this.scaleConfig.analysisConcurrency,
      async (quote) => {
        const analysis = await this.analyzeSymbol(quote.symbol, {
          quote,
          portfolio,
          statuses,
          requests,
        });
        if (this.scaleConfig.strategyTags.length > 0) {
          (analysis as AgentAnalysis & { strategyTags?: string[] }).strategyTags = [
            ...this.scaleConfig.strategyTags,
          ];
        }
        return analysis;
      },
    );
    const analysisMs = Date.now() - analysisStarted;

    for (const analysis of analyzed) {
      if (analysis.decision.includes('BUY')) {
        const entry = analysis.setup.entry ?? 0;
        const affordable = entry > 0 ? Math.floor(cash / entry) : 0;
        if (affordable < 1) continue;
        if (analysis.setup.positionSize <= 0) {
          analysis.setup.positionSize = Math.min(1, affordable);
          analysis.action = `Propose LONG ${analysis.setup.positionSize} shares with stop ${analysis.setup.stopLoss ?? '—'} and T1 ${analysis.setup.target1 ?? '—'}. Requires approval.`;
        }
      }

      if (
        analysis.decision.includes('BUY') ||
        analysis.decision === 'WAIT' ||
        analysis.decision === 'STRONG_SELL'
      ) {
        const id = randomUUID();
        analysis.recommendationId = id;
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        pendingBatch.push({ id, analysis, expiresAt });
      }
    }

    pendingBatch.sort((a, b) => b.analysis.scores.overall - a.analysis.scores.overall);
    const limited = pendingBatch.slice(0, Math.min(limit, this.scaleConfig.maxOpportunities));
    const scanMs = Date.now() - cycleStarted;
    const acceptStarted = Date.now();
    const synced = await this.opportunitiesDb.syncPending(userId, brandId, limited);
    for (const row of synced) {
      this.recommendations.set(row.id, {
        id: row.id,
        analysis: row.analysis,
        status: 'PENDING',
        expiresAt: Date.now() + 30 * 60_000,
      });
    }

    const addedRows = await this.opportunitiesDb.listAdded(userId);
    const added = addedRows.map((row) => ({
      ...row.analysis,
      recommendationId: row.id,
      executedAt: row.executedAt?.getTime() ?? Date.now(),
      quantity: row.quantity ?? row.analysis.setup.positionSize ?? 0,
      status: 'APPROVED' as const,
    }));

    let autonomous: { attempted: number; accepted: number; skipped: number } | undefined;
    if (
      this.decisionMode === 'AUTONOMOUS' &&
      this.mode === 'PAPER' &&
      this.tradingEnabled &&
      !this.killSwitch &&
      !this.enforceBreakers('autonomous-cycle', userId, brandId)
    ) {
      autonomous = await this.runAutonomousCycle(
        userId,
        brandId,
        synced.map((row) => row.id),
      );
    }

    this.lastCycleMetrics = {
      scanMs,
      analysisMs,
      acceptMs: Date.now() - acceptStarted,
      symbolsScanned: candidates.length,
      opportunitiesBuilt: limited.length,
      autonomousAttempted: autonomous?.attempted ?? 0,
      autonomousAccepted: autonomous?.accepted ?? 0,
    };

    const marketContextForRank = await this.fetchTiMarketContext();

    const rankingCandidates = await Promise.all(
      synced.map(async (row) => {
        const [ml, crossSectional, multiHorizon, catalyst] = await Promise.all([
          this.fetchTiMlPrediction(row.analysis.symbol),
          this.fetchTiCrossSectional(row.analysis.symbol),
          this.fetchTiMultiHorizon(row.analysis.symbol, row.analysis.setup?.expectedHoldingPeriod),
          this.fetchTiCatalyst(row.analysis.symbol),
        ]);
        const decision = evaluateTrade({ analysis: row.analysis });
        const snap = buildIntelligenceSnapshot({
          analysis: row.analysis,
          decision,
          sourceDataTimestamp: row.analysis.generatedAt,
          marketContext: marketContextForRank ?? undefined,
          mlPrediction: ml,
          crossSectional: crossSectional ?? undefined,
          multiHorizon: multiHorizon ?? undefined,
          catalyst: catalyst ?? undefined,
        });
        return {
          opportunityId: row.id,
          symbol: row.analysis.symbol,
          snapshot: snap,
          portfolioFit: 'GOOD' as const,
          quality: row.analysis.scores.overall ?? 0,
          expectedValueR: snap.expectedValue?.expectedValueR ?? 0,
          signalScore: row.analysis.scores.overall ?? 0,
          quantity: row.analysis.setup.positionSize ?? 0,
        };
      }),
    );

    const opportunityRanking = assessOpportunityRanking({
      context: {
        tradeHorizon: 'SWING_TRADE',
        strategyTag: 'BREAKOUT',
        timestamp: new Date().toISOString(),
      },
      candidates: rankingCandidates.map((c) => ({
        opportunityId: c.opportunityId,
        symbol: c.symbol,
        snapshot: c.snapshot,
        portfolioFit: c.portfolioFit,
      })),
    });
    // Freeze cohort for subsequent human decisions — do not re-run ranking later.
    this.lastOpportunityRanking = opportunityRanking;
    this.opportunityProvenance.clear();

    const now = Date.now();
    const sessionOpen = isNseCashSessionOpen(now);
    const opportunityProvenanceById: Record<string, OpportunityEvidenceProvenance> = {};
    for (const row of synced) {
      const quote = quotes.find(
        (q) => q.symbol.toUpperCase() === row.analysis.symbol.toUpperCase(),
      );
      const dataProvenance = buildDataProvenance({
        dataAsOf: quote?.updatedAt ?? row.analysis.generatedAt,
        receivedAt: now,
        analysisAt: row.analysis.generatedAt,
        now,
      });
      const liveReady =
        sessionOpen &&
        (dataProvenance.dataStatus === 'LIVE' || dataProvenance.dataStatus === 'DELAYED');
      const prov = buildOpportunityEvidenceProvenance({
        batch: focusBatch,
        symbol: row.analysis.symbol,
        dataProvenance,
        liveReady,
      });
      this.opportunityProvenance.set(row.id, prov);
      opportunityProvenanceById[row.id] = prov;
    }

    const waitIntelligenceById: Record<string, WaitRecommendation> = {};
    const thesisIntelligenceById: Record<string, StructuredThesis> = {};
    for (const c of rankingCandidates) {
      const row = synced.find((s) => s.id === c.opportunityId);
      if (!row) continue;
      const existing = this.recommendations.get(c.opportunityId);
      const previousWait = existing?.wait ?? null;
      waitIntelligenceById[c.opportunityId] = buildWaitRecommendation({
        now,
        analysis: row.analysis,
        snapshot: c.snapshot,
        previousWait,
      });
      if (existing?.status === 'WAITING' && existing.wait) {
        existing.wait = {
          ...existing.wait,
          waitIntelligence: waitIntelligenceById[c.opportunityId],
          lastWaitRecommendationAt: now,
          priorDigest: digestFromSnapshot(c.snapshot),
        };
        this.recommendations.set(c.opportunityId, existing);
      }

      const ledgerEntry = this.ledger.getByOpportunity(c.opportunityId);
      if (ledgerEntry?.thesisSnapshot) {
        const reassessed = this.reassessAndAppendThesis({
          now,
          decisionId: ledgerEntry.decisionId,
          initial: ledgerEntry.thesisSnapshot.initialThesis,
          analysis: row.analysis,
          snapshot: c.snapshot,
          priorReassessment: ledgerEntry.thesisReassessment,
        });
        thesisIntelligenceById[c.opportunityId] = reassessed;
      }
    }

    return {
      mode: this.mode,
      decisionMode: this.decisionMode,
      opportunities: synced.map((row) => row.analysis),
      ranked: rankOpportunitiesForDisplay(
        rankingCandidates.map((c) => ({
          opportunityId: c.opportunityId,
          symbol: c.symbol,
          quality: c.quality,
          expectedValueR: c.expectedValueR,
          signalScore: c.signalScore,
          quantity: c.quantity,
          portfolioFit: c.portfolioFit,
        })),
      ),
      opportunityRanking,
      added,
      capabilityRequests: requests.filter(
        (row) => this.suggestions.get(row.id)?.status !== 'acknowledged',
      ),
      disclaimer: AGENT_DISCLAIMER,
      autonomous,
      waitIntelligenceById,
      thesisIntelligenceById,
      focusBatchId: focusBatch?.batchId ?? null,
      opportunityProvenanceById,
    };
  }

  async getThesisIntelligence(id: string, userId?: string): Promise<StructuredThesis | null> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required');
    }
    const ledgerEntry = this.ledger.getByOpportunity(id);
    if (!ledgerEntry?.thesisSnapshot) return null;

    let rec = this.recommendations.get(id);
    if (!rec) {
      const persisted = await this.opportunitiesDb.findForUser(id, userId);
      rec = persisted != null ? this.opportunitiesDb.toRecommendation(persisted) : undefined;
    }
    if (!rec) {
      return ledgerEntry.thesisReassessment ?? ledgerEntry.thesisSnapshot.initialThesis;
    }

    const portfolio = await this.fetchPortfolio(userId);
    if (!portfolio) {
      return ledgerEntry.thesisReassessment ?? ledgerEntry.thesisSnapshot.initialThesis;
    }
    const pipeline = await this.runDecisionPipeline(rec.analysis, portfolio, {
      opportunityId: id,
      decisionId: id,
    });
    return this.reassessAndAppendThesis({
      now: Date.now(),
      decisionId: ledgerEntry.decisionId,
      initial: ledgerEntry.thesisSnapshot.initialThesis,
      analysis: rec.analysis,
      snapshot: pipeline.intelligenceSnapshot,
      priorReassessment: ledgerEntry.thesisReassessment,
    });
  }

  async getWaitIntelligence(id: string, userId?: string): Promise<WaitRecommendation | null> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required');
    }
    let rec = this.recommendations.get(id);
    if (!rec) {
      const persisted = await this.opportunitiesDb.findForUser(id, userId);
      rec = persisted != null ? this.opportunitiesDb.toRecommendation(persisted) : undefined;
    }
    if (!rec) return null;
    return rec.wait?.waitIntelligence ?? null;
  }

  async getAnalysis(symbol: string, userId?: string, brandId?: string): Promise<AgentAnalysis> {
    const upper = symbol.toUpperCase();
    const statuses = await this.probeCapabilities();
    const requests = capabilityRequestsFromStatuses(statuses);
    const portfolio = await this.fetchPortfolio(userId, brandId);
    const analysis = await this.analyzeSymbol(upper, { portfolio, statuses, requests });
    const id = randomUUID();
    analysis.recommendationId = id;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    this.recommendations.set(id, {
      id,
      analysis,
      status: 'PENDING',
      expiresAt: expiresAt.getTime(),
    });
    if (userId) {
      await this.opportunitiesDb.upsertPending(userId, brandId, id, analysis, expiresAt);
    }
    return analysis;
  }

  async getPortfolio(userId?: string, brandId?: string): Promise<PortfolioSnapshot> {
    const portfolio = await this.fetchPortfolio(userId, brandId);
    if (!portfolio || !isPortfolioSnapshot(portfolio)) {
      throw new HttpException(
        {
          message:
            'Portfolio unavailable — auto-trader GET /portfolio failed or returned invalid data',
        },
        503,
      );
    }
    return portfolio;
  }

  async getPositions(): Promise<{
    positions: AgentManagedPosition[];
    killSwitch: boolean;
    agentTradingEnabled: boolean;
  }> {
    const monitored = await this.fetchMonitoredPositions();
    const now = Date.now();
    const positions: AgentManagedPosition[] = (monitored?.positions ?? []).map((lot) => {
      const note = this.positionNotes.get(lot.symbol);
      const policyEval = evaluateExitPolicy(
        {
          symbol: lot.symbol,
          entryPrice: lot.entryPrice,
          quantity: lot.quantity,
          target: lot.target,
          target2: note?.target2,
          stopLoss: lot.stopLoss,
        },
        { price: lot.currentPrice, thesisIntact: true },
      );
      const exitMode =
        lot.exitMode ?? (this.tradingEnabled ? 'AGENT_POLICY' : 'CLASSIC_STOP_TARGET');
      return {
        symbol: lot.symbol,
        quantity: lot.quantity,
        entryPrice: lot.entryPrice,
        currentPrice: lot.currentPrice,
        target: policyEval.target,
        target2: note?.target2,
        stopLoss: policyEval.stopLoss,
        unrealizedPnl: lot.unrealizedPnl,
        policy: note?.policy ?? policyEval.policy,
        policyNote:
          note?.note ??
          (exitMode === 'AGENT_POLICY'
            ? policyEval.note
            : 'Classic stop/target monitoring (enable AI agent trading for exit policy).'),
        openedAt: lot.openedAt ?? Date.now(),
        bookKey: lot.bookKey,
        userId: lot.userId,
        brandId: lot.brandId,
        exitMode,
        monitored: lot.monitored ?? true,
        exitIntelligence: this.buildExitIntelligenceForLot(lot, now),
      };
    });
    return {
      positions,
      killSwitch: this.killSwitch,
      agentTradingEnabled: monitored?.agentTradingEnabled ?? this.tradingEnabled,
    };
  }

  async getExitIntelligence(symbol: string): Promise<ExitRecommendation | null> {
    const monitored = await this.fetchMonitoredPositions();
    const lot = (monitored?.positions ?? []).find(
      (row) => row.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (!lot) return null;
    return this.buildExitIntelligenceForLot(lot, Date.now());
  }

  private buildExitIntelligenceForLot(
    lot: {
      symbol: string;
      entryPrice: number;
      currentPrice: number;
      stopLoss: number;
      target: number;
      quantity: number;
      openedAt?: number;
    },
    now: number,
  ): ExitRecommendation {
    const ledgerEntry = this.ledger.getLatestBySymbol(lot.symbol);
    const thesis =
      ledgerEntry?.thesisReassessment ?? ledgerEntry?.thesisSnapshot?.initialThesis ?? null;
    const p5Context = this.p5ContextForLedgerEntry(ledgerEntry, now);
    return buildExitRecommendation({
      now,
      position: {
        symbol: lot.symbol,
        entryPrice: lot.entryPrice,
        currentPrice: lot.currentPrice,
        stopLoss: lot.stopLoss,
        target: lot.target,
        quantity: lot.quantity,
        openedAt: lot.openedAt ?? now,
      },
      thesis,
      p5Context,
    });
  }

  private p5ContextForLedgerEntry(
    entry: import('@stockpred/shared-types').DecisionLedgerEntry | null,
    now: number,
  ): ExitIntelligenceP5Context | null {
    if (!entry?.outcome) return null;
    const asOf = entry.outcome.closedAt ?? entry.timestamp;
    if (!Number.isFinite(asOf) || asOf > now) return null;
    if (entry.outcome.maeR == null && entry.outcome.mfeR == null) return null;
    return {
      decisionId: entry.decisionId,
      maeR: entry.outcome.maeR,
      mfeR: entry.outcome.mfeR,
      asOf,
    };
  }

  async getTransactions(
    limit = 50,
    userId?: string,
    brandId?: string,
  ): Promise<{
    transactions: import('./transaction-auditor').AgentTransactionAudit[];
    disclaimer: string;
  }> {
    if (!userId) {
      throw new BadRequestException('x-user-id is required for transaction audit');
    }
    const transactions = await this.transactionAuditor.listForUser(
      userId,
      brandId,
      Math.min(limit, 100),
    );
    return { transactions, disclaimer: AGENT_DISCLAIMER };
  }

  async getMonitoringLogs(
    limit = 80,
    symbol?: string,
  ): Promise<{
    events: Array<{
      id: string;
      ts: number;
      symbol: string;
      bookKey: string;
      userId: string | null;
      mode: string;
      action: string;
      policy: string;
      note: string;
      price: number;
      stopLoss: number;
      target: number;
      quantity?: number;
      reason?: string;
    }>;
    meta: {
      agentTradingEnabled: boolean;
      tickSource: string;
      expectedTickIntervalMs: number;
      holdSampleIntervalMs: number;
      lastTickAt: number | null;
      ticksReceived: number;
      ticksLastMinute: number;
      checksLogged: number;
      openLotsHint: number;
    };
    disclaimer: string;
  }> {
    try {
      const { data } = await axios.get(`${this.autoTraderUrl}/monitoring-logs`, {
        params: { limit: Math.min(limit, 200), ...(symbol ? { symbol } : {}) },
        timeout: 8_000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return {
        events: Array.isArray(data?.events) ? data.events : [],
        meta: data?.meta ?? {
          agentTradingEnabled: this.tradingEnabled,
          tickSource: 'Kafka market.ticks',
          expectedTickIntervalMs: 1000,
          holdSampleIntervalMs: 15_000,
          lastTickAt: null,
          ticksReceived: 0,
          ticksLastMinute: 0,
          checksLogged: 0,
          openLotsHint: 0,
        },
        disclaimer: AGENT_DISCLAIMER,
      };
    } catch {
      return {
        events: [],
        meta: {
          agentTradingEnabled: this.tradingEnabled,
          tickSource: 'Kafka market.ticks (auto-trader unreachable)',
          expectedTickIntervalMs: 1000,
          holdSampleIntervalMs: 15_000,
          lastTickAt: null,
          ticksReceived: 0,
          ticksLastMinute: 0,
          checksLogged: 0,
          openLotsHint: 0,
        },
        disclaimer: AGENT_DISCLAIMER,
      };
    }
  }

  private async fetchMonitoredPositions(): Promise<{
    agentTradingEnabled: boolean;
    positions: Array<{
      symbol: string;
      quantity: number;
      entryPrice: number;
      currentPrice: number;
      target: number;
      stopLoss: number;
      unrealizedPnl: number;
      openedAt: number;
      bookKey: string;
      userId: string | null;
      brandId: string | null;
      exitMode: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
      monitored: boolean;
    }>;
  } | null> {
    try {
      const { data } = await axios.get(`${this.autoTraderUrl}/monitored-positions`, {
        timeout: 10_000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return data as {
        agentTradingEnabled: boolean;
        positions: Array<{
          symbol: string;
          quantity: number;
          entryPrice: number;
          currentPrice: number;
          target: number;
          stopLoss: number;
          unrealizedPnl: number;
          openedAt: number;
          bookKey: string;
          userId: string | null;
          brandId: string | null;
          exitMode: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
          monitored: boolean;
        }>;
      };
    } catch {
      return null;
    }
  }

  async approveRecommendation(
    id: string,
    userId?: string,
    quantityOverride?: number,
    brandId?: string,
    opts?: { autonomous?: boolean },
  ): Promise<{
    recommendation: AgentRecommendation;
    trade: unknown;
    decision?: DecisionLedgerEntry;
  }> {
    if (!this.tradingEnabled) {
      throw new ForbiddenException('AI agent trading is disabled — turn it on first');
    }
    if (this.mode === 'RESEARCH') {
      throw new ForbiddenException('RESEARCH mode cannot execute orders');
    }
    if (this.killSwitch) {
      throw new ForbiddenException('Kill switch is on — new entries blocked');
    }
    if (this.mode === 'LIVE' && !this.liveArmed) {
      throw new ForbiddenException('LIVE is not armed');
    }
    if (!userId) {
      throw new BadRequestException('x-user-id is required to approve a suggestion');
    }

    const persisted = await this.opportunitiesDb.findForUser(id, userId);
    const rec =
      persisted != null
        ? this.opportunitiesDb.toRecommendation(persisted)
        : this.recommendations.get(id);
    if (!rec) throw new NotFoundException('Recommendation not found');
    if (persisted && persisted.status !== 'PENDING') {
      throw new BadRequestException(`Recommendation is ${persisted.status}`);
    }
    if (rec.expiresAt < Date.now()) {
      rec.status = 'EXPIRED';
      throw new BadRequestException('Recommendation expired');
    }
    if (!rec.analysis.decision.includes('BUY')) {
      throw new BadRequestException(`Decision ${rec.analysis.decision} is not an approvable buy`);
    }
    const setup = { ...rec.analysis.setup };
    const symbol = setup.instrument || rec.analysis.symbol;

    // Refresh missing levels from live quote so bulk approve is not blocked by stale/empty setup.
    if (!setup.entry || setup.entry <= 0 || !setup.stopLoss || setup.stopLoss <= 0) {
      const quote = await this.fetchQuote(symbol);
      const price = quote?.price && quote.price > 0 ? quote.price : null;
      const entry =
        setup.entry && setup.entry > 0
          ? setup.entry
          : quote?.entry && quote.entry > 0
            ? quote.entry
            : price;
      if (entry && entry > 0) {
        setup.entry = entry;
        setup.instrument = symbol;
        if (!setup.stopLoss || setup.stopLoss <= 0) {
          setup.stopLoss =
            quote?.stopLoss && quote.stopLoss > 0
              ? quote.stopLoss
              : Math.round(entry * 0.97 * 100) / 100;
        }
        if (!setup.target1 || setup.target1 <= 0) {
          setup.target1 =
            quote?.target && quote.target > 0 ? quote.target : Math.round(entry * 1.04 * 100) / 100;
        }
      }
    }

    const analysis: AgentAnalysis = {
      ...rec.analysis,
      setup: { ...setup },
      recommendationId: id,
    };

    const portfolio = await this.fetchPortfolio(userId, brandId);
    if (!portfolio) {
      throw new BadRequestException('Portfolio unavailable — cannot revalidate');
    }

    const quote = await this.fetchQuote(symbol);
    // Correction 4: live refresh before human APPROVE — offline snapshot is never the decision snapshot.
    this.stampLiveProvenanceForOpportunity(id, symbol, quote);
    let fundamentals: FundamentalView | null = null;
    const symbolSectorHint =
      (typeof quote?.sector === 'string' && quote.sector.trim() ? quote.sector.trim() : null) ??
      portfolio.holdings.find((h) => h.symbol.toUpperCase() === symbol.toUpperCase())?.sector ??
      null;
    if (!symbolSectorHint) {
      fundamentals = await this.fetchFundamentals(symbol);
    }
    const symbolSector = this.resolveSymbolSector(symbol, portfolio, quote, fundamentals);

    const pipeline = await this.runDecisionPipeline(analysis, portfolio, {
      opportunityId: id,
      decisionId: id,
      quoteTimestamp: quote?.updatedAt,
      quantityOverride,
      symbolSector,
    });

    const policyOutcome = pipeline.policy.outcome;
    if (opts?.autonomous) {
      if (policyOutcome !== 'AUTO_ACCEPTED') {
        try {
          this.ohSafety.record({
            code: 'AUTONOMOUS_AUTHORIZATION_BLOCKED',
            decisionId: id,
            symbol: (setup.instrument || symbol)?.toUpperCase?.() ?? symbol,
            message: `policy=${policyOutcome}`,
            details: { reasonCodes: pipeline.policy.reasonCodes },
          });
        } catch {
          /* observe-only */
        }
        this.recordLedger(
          pipeline,
          'HUMAN_REQUIRED',
          policyOutcome === 'REJECT' ? 'REJECT' : 'HUMAN_REQUIRED',
        );
        throw new ForbiddenException(
          `Autonomous skipped: policy=${policyOutcome} (${pipeline.policy.reasons.join('; ')})`,
        );
      }
    } else if (policyOutcome === 'REJECT') {
      this.recordLedger(pipeline, 'REJECTED', 'REJECT');
      throw new BadRequestException(
        `Decision rejected by policy: ${pipeline.policy.reasons.join('; ')}`,
      );
    }

    const quantity = pipeline.risk.allowed ? pipeline.risk.quantity : 0;
    if (quantity < 1) {
      this.recordLedger(pipeline, 'RISK_BLOCKED', 'BLOCKED');
      throw new BadRequestException('Risk engine sized 0 quantity');
    }

    const tradedSymbol = (setup.instrument || symbol).toUpperCase();
    const entryPrice = setup.entry ?? 0;
    const tradeNotional = entryPrice * quantity;
    const openNotional = computeOpenNotional(portfolio.holdings ?? []);
    const openPositions = portfolio.openPositions ?? portfolio.holdings?.length ?? 0;
    const earlyCaps = checkLiveCaps({
      mode: this.mode,
      tradeNotional,
      openNotional,
      openPositions,
      caps: DEFAULT_LIVE_CAPS,
    });
    if (!earlyCaps.passed) {
      this.recordLedger(
        pipeline,
        'RISK_BLOCKED',
        'BLOCKED',
        undefined,
        earlyCaps.reasonCodes,
        earlyCaps.reasons,
        {
          agentRecommendation: deriveAgentRecommendation({ decision: analysis.decision }),
          humanDecision: opts?.autonomous ? undefined : 'HUMAN_APPROVE',
        },
      );
      throw new BadRequestException(earlyCaps.reasons.join('; ') || 'LIVE caps blocked');
    }

    const livePrice = quote?.price != null && quote.price > 0 ? quote.price : null;
    if (entryPrice > 0 && livePrice != null) {
      const deviationPct = (Math.abs(livePrice - entryPrice) / entryPrice) * 100;
      if (deviationPct > this.riskBudgets.maxPriceDeviationPct) {
        this.ohExecution.record({
          phase: 'ERROR',
          decisionId: pipeline.decision.decisionId,
          symbol: tradedSymbol,
          expectedPrice: entryPrice,
          fillPrice: livePrice,
          priceDeviationPct: deviationPct,
          ok: false,
          diagnostic: 'PRICE_DEVIATION',
          message: `Pre-submit price deviation ${deviationPct.toFixed(2)}%`,
        });
        this.recordLedger(
          pipeline,
          'RISK_BLOCKED',
          'BLOCKED',
          undefined,
          ['PRICE_DEVIATION'],
          [
            `Live ₹${livePrice} vs entry ₹${entryPrice} deviation ${deviationPct.toFixed(2)}% exceeds max ${this.riskBudgets.maxPriceDeviationPct}%`,
          ],
        );
        throw new BadRequestException(
          `Price deviation ${deviationPct.toFixed(2)}% exceeds max ${this.riskBudgets.maxPriceDeviationPct}%`,
        );
      }
    }

    const lastSubmit = this.recentSubmits.get(tradedSymbol);
    if (lastSubmit != null && Date.now() - lastSubmit < DUPLICATE_ORDER_WINDOW_MS) {
      this.ohExecution.record({
        phase: 'ERROR',
        decisionId: pipeline.decision.decisionId,
        symbol: tradedSymbol,
        ok: false,
        diagnostic: 'DUPLICATE_ATTEMPT',
        message: `Duplicate submit window ${DUPLICATE_ORDER_WINDOW_MS}ms`,
      });
      this.recordLedger(
        pipeline,
        'RISK_BLOCKED',
        'BLOCKED',
        undefined,
        ['DUPLICATE_ORDER'],
        [`Recent submit for ${tradedSymbol} within ${DUPLICATE_ORDER_WINDOW_MS / 1000}s`],
      );
      throw new BadRequestException(
        `Duplicate order: ${tradedSymbol} was submitted within the last ${DUPLICATE_ORDER_WINDOW_MS / 1000}s`,
      );
    }

    this.recentSubmits.set(tradedSymbol, Date.now());

    // Final Gate revalidation (incl. LIVE caps against fresh portfolio).
    const freshPortfolio = await this.fetchPortfolio(userId, brandId);
    if (!freshPortfolio) {
      throw new BadRequestException('Portfolio unavailable — cannot revalidate at Gate');
    }
    const gateOpenNotional = computeOpenNotional(freshPortfolio.holdings ?? []);
    const gateOpenPositions = freshPortfolio.openPositions ?? freshPortfolio.holdings?.length ?? 0;
    const gateCaps = checkLiveCaps({
      mode: this.mode,
      tradeNotional,
      openNotional: gateOpenNotional,
      openPositions: gateOpenPositions,
      caps: DEFAULT_LIVE_CAPS,
    });
    const gateResult: GateResultSnapshot = {
      passed: gateCaps.passed,
      reasonCodes: gateCaps.reasonCodes,
      reasons: gateCaps.reasons,
      checkedAt: Date.now(),
    };
    if (!gateCaps.passed) {
      this.recordLedger(
        pipeline,
        'RISK_BLOCKED',
        'BLOCKED',
        undefined,
        gateCaps.reasonCodes,
        gateCaps.reasons,
        {
          agentRecommendation: deriveAgentRecommendation({ decision: analysis.decision }),
          humanDecision: opts?.autonomous ? undefined : 'HUMAN_APPROVE',
          gateResult,
        },
      );
      throw new BadRequestException(
        gateCaps.reasons.join('; ') || 'Gate LIVE caps blocked (stale portfolio)',
      );
    }

    try {
      const decisionId = pipeline.decision.decisionId;
      const plannedRiskAmount =
        pipeline.risk.allowed === true
          ? pipeline.risk.riskAmount
          : Math.abs((setup.entry ?? 0) - (setup.stopLoss ?? 0)) * quantity;
      this.ohExecution.setBrokerConnected(this.mode === 'LIVE' ? this.brokerTestOk : true);
      this.ohExecution.noteSubmitStarted({
        decisionId,
        symbol: tradedSymbol,
        expectedQty: quantity,
        expectedPrice: entryPrice > 0 ? entryPrice : undefined,
      });
      this.ohExecution.record({
        phase: 'SUBMIT',
        decisionId,
        symbol: tradedSymbol,
        expectedQty: quantity,
        expectedPrice: entryPrice > 0 ? entryPrice : undefined,
        ok: true,
      });
      const submitStarted = Date.now();
      const trade = await axios.post(
        `${this.autoTraderUrl}/trade/execute`,
        {
          symbol: setup.instrument || symbol,
          side: TradeSide.BUY,
          quantity,
          price: setup.entry,
          target: setup.target1 ?? undefined,
          stopLoss: setup.stopLoss,
          decisionId,
          plannedRiskAmount,
          soakRunId: this.soakController?.getActiveRunId(),
        },
        {
          headers: {
            ...(userId ? { 'x-user-id': userId } : {}),
            ...(brandId ? { 'x-brand-id': brandId } : {}),
          },
          timeout: 30_000,
        },
      );
      const submitAckMs = Date.now() - submitStarted;
      const tradeData = trade.data as {
        id?: string;
        quantity?: number;
        price?: number;
        positionId?: string;
      };
      const orderId = tradeData?.id;
      const actualQty = tradeData?.quantity ?? quantity;
      const fillPrice = tradeData?.price ?? setup.entry ?? null;
      const dev =
        entryPrice > 0 && fillPrice != null ? priceDeviationPct(entryPrice, fillPrice) : null;
      const fillDiagnostic =
        actualQty !== quantity
          ? ('QTY_MISMATCH' as const)
          : dev != null && dev >= OH2_PRICE_DEVIATION_PCT
            ? ('PRICE_DEVIATION' as const)
            : undefined;
      this.ohExecution.record({
        phase: 'FILL',
        decisionId,
        orderId,
        positionId: tradeData?.positionId,
        symbol: tradedSymbol,
        submitAckMs,
        fillMs: submitAckMs,
        e2eMs: submitAckMs,
        expectedQty: quantity,
        actualQty,
        expectedPrice: entryPrice > 0 ? entryPrice : undefined,
        fillPrice: fillPrice ?? undefined,
        priceDeviationPct: dev,
        ok: fillDiagnostic == null,
        diagnostic: fillDiagnostic,
      });
      this.ohExecution.noteFailureStreak(0);

      this.execFailStreak = 0;
      rec.status = 'APPROVED';
      const executedAnalysis: AgentAnalysis = {
        ...analysis,
        setup: { ...setup, positionSize: quantity },
        recommendationId: id,
      };
      await this.opportunitiesDb.markApproved(id, userId, brandId, quantity, executedAnalysis);
      this.recommendations.set(id, { ...rec, analysis: executedAnalysis, status: 'APPROVED' });
      this.positionNotes.set(tradedSymbol, {
        policy: 'HOLD',
        note: opts?.autonomous
          ? 'Autonomous PAPER fill — monitoring stop/target with exit policy.'
          : 'Agent-approved lot — monitoring stop/target with exit policy.',
        target2: setup.target2 ?? undefined,
      });
      for (const [recId, pending] of this.recommendations) {
        if (
          recId !== id &&
          pending.status === 'PENDING' &&
          pending.analysis.symbol.toUpperCase() === tradedSymbol
        ) {
          pending.status = 'REJECTED';
        }
      }

      const ledger = this.recordLedger(
        pipeline,
        opts?.autonomous ? 'AUTO_ACCEPTED' : 'APPROVED',
        opts?.autonomous ? 'AUTO_ACCEPT' : 'APPROVED',
        {
          quantity,
          entryPrice: setup.entry ?? undefined,
          orderId,
          status: 'EXECUTED',
          plannedRiskAmount,
        },
        [],
        [],
        {
          agentRecommendation: deriveAgentRecommendation({ decision: analysis.decision }),
          humanDecision: opts?.autonomous ? undefined : 'HUMAN_APPROVE',
          gateResult,
          analysis,
        },
      );

      if (opts?.autonomous) {
        this.rollBreakerDayIfNeeded();
        this.dailyAutoAcceptCount += 1;
        this.consecutiveVetoCount = 0;
      }
      return {
        recommendation: { ...rec, analysis: executedAnalysis, status: 'APPROVED' },
        trade: trade.data,
        decision: ledger,
      };
    } catch (error) {
      this.execFailStreak += 1;
      this.ohExecution.noteFailureStreak(this.execFailStreak);
      const diagnostic = diagnosticFromExecutionError(error);
      this.ohExecution.record({
        phase: 'ERROR',
        decisionId: pipeline.decision.decisionId,
        symbol: tradedSymbol,
        expectedQty: quantity,
        expectedPrice: entryPrice > 0 ? entryPrice : undefined,
        ok: false,
        diagnostic,
        message: error instanceof Error ? error.message : 'Trade execution failed',
      });
      if (this.execFailStreak >= EXEC_FAIL_CIRCUIT && this.decisionMode === 'AUTONOMOUS') {
        this.decisionMode = 'APPROVAL';
        this.persistState();
        this.ledger.append({
          decisionId: randomUUID(),
          opportunityId: id,
          timestamp: Date.now(),
          symbol: symbol.toUpperCase(),
          direction: 'BUY',
          operatingMode: this.mode,
          decisionMode: 'APPROVAL',
          state: 'REJECTED',
          analysisSnapshot: {
            score: analysis.scores.overall,
            confidence: analysis.setup.confidence ?? analysis.scores.overall,
            scores: analysis.scores,
            regime: analysis.marketRegime,
            thesis: analysis.thesis,
            strategy: 'COMPOSITE_DESK',
            eligibility: pipeline.decision.eligibility,
          },
          riskVerdict: pipeline.risk,
          portfolioVerdict: pipeline.portfolio,
          policy: pipeline.policy,
          budgetSnapshot: pipeline.budgetSnapshot,
          decision: 'BLOCKED',
          reasonCodes: ['EXECUTION_FAILURE_CIRCUIT_BREAKER'],
          decisionReasons: [
            `${EXEC_FAIL_CIRCUIT} consecutive execution failures — forced APPROVAL mode`,
          ],
        });
      }
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const data = error.response.data as { message?: string | string[] };
        const message = Array.isArray(data?.message)
          ? data.message.join(' ')
          : data?.message || error.message;
        throw new HttpException(message, status);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Trade execution failed',
      );
    }
  }

  private async runAutonomousCycle(
    userId: string,
    brandId: string | undefined,
    recommendationIds: string[],
  ): Promise<{ attempted: number; accepted: number; skipped: number }> {
    let attempted = 0;
    let accepted = 0;
    let skipped = 0;
    // Sequential / single-flight accept loop — do not parallelize authorization.
    for (const id of recommendationIds.slice(0, this.scaleConfig.maxAutonomousAcceptsPerCycle)) {
      if (this.enforceBreakers('autonomous-accept', userId, brandId)) {
        skipped += 1;
        break;
      }
      attempted += 1;
      try {
        await this.approveRecommendation(id, userId, undefined, brandId, { autonomous: true });
        accepted += 1;
        this.tenantBreakers.recordAutoAccept(userId, brandId);
      } catch {
        skipped += 1;
        this.tenantBreakers.recordVeto(userId, brandId);
        this.consecutiveVetoCount += 1;
      }
    }
    return { attempted, accepted, skipped };
  }

  private resolveSymbolSector(
    symbol: string,
    portfolio: PortfolioSnapshot,
    quote?: StockQuote | null,
    fundamentals?: FundamentalView | null,
  ): string | null {
    const fromQuote =
      typeof quote?.sector === 'string' && quote.sector.trim() ? quote.sector.trim() : null;
    if (fromQuote) return fromQuote;
    const fromFund =
      typeof fundamentals?.sector === 'string' && fundamentals.sector.trim()
        ? fundamentals.sector.trim()
        : null;
    if (fromFund) return fromFund;
    const held = portfolio.holdings.find((h) => h.symbol.toUpperCase() === symbol.toUpperCase());
    const fromHolding =
      typeof held?.sector === 'string' && held.sector.trim() ? held.sector.trim() : null;
    return fromHolding;
  }

  private async runDecisionPipeline(
    analysis: AgentAnalysis,
    portfolio: PortfolioSnapshot,
    opts: {
      opportunityId?: string;
      decisionId?: string;
      quoteTimestamp?: number;
      quantityOverride?: number;
      symbolSector?: string | null;
    },
  ): Promise<{
    decision: TradeDecision;
    risk: RiskVerdict;
    portfolio: PortfolioVerdict;
    policy: DecisionPolicyResult;
    budgetSnapshot: DecisionBudgetSnapshot;
    /** Observe-only — never passed into Risk / Portfolio / Policy / Gate. */
    intelligenceSnapshot: import('@stockpred/shared-types').IntelligenceSnapshot;
  }> {
    const pipelineStarted = Date.now();
    const stages: import('@stockpred/shared-types').OhStageTimingMs[] = [];

    const tradeTimed = timeSync(() =>
      evaluateTrade({
        analysis,
        opportunityId: opts.opportunityId,
        decisionId: opts.decisionId,
        quoteTimestamp: opts.quoteTimestamp,
      }),
    );
    const decision = tradeTimed.value;
    stages.push(ohStage('evaluateTrade', tradeTimed.ms));

    const tiTimed = await timeAsync(() =>
      Promise.all([
        this.fetchTiMarketContext(),
        this.fetchTiMlPrediction(analysis.symbol),
        this.fetchTiCrossSectional(analysis.symbol),
        this.fetchTiMultiHorizon(analysis.symbol, analysis.setup?.expectedHoldingPeriod),
        this.fetchTiCatalyst(analysis.symbol),
      ]),
    );
    const [marketContext, mlPrediction, crossSectional, multiHorizon, catalyst] = tiTimed.value;
    stages.push(ohStage('tiFetch', tiTimed.ms));

    // P4: capture intelligence for the ledger only — not fed into engines below.
    const intelTimed = timeSync(() =>
      buildIntelligenceSnapshot({
        analysis,
        decision,
        sourceDataTimestamp: opts.quoteTimestamp ?? analysis.generatedAt,
        marketContext: marketContext ?? undefined,
        mlPrediction,
        crossSectional: crossSectional ?? undefined,
        multiHorizon: multiHorizon ?? undefined,
        catalyst: catalyst ?? undefined,
      }),
    );
    const intelligenceSnapshot = intelTimed.value;
    stages.push(ohStage('intelligenceSnapshot', intelTimed.ms));

    const currentEquity = portfolio.equity || portfolio.capital;
    const dayStartEquity = portfolio.dayStartEquity ?? portfolio.equity ?? portfolio.capital;
    const weekStartEquity = portfolio.weekStartEquity ?? portfolio.equity ?? portfolio.capital;
    const riskPerTradePercent = this.riskBudgets.perTradeRiskPercent || this.riskPct;
    const confidence = decision.confidence;
    const symbolSector = opts.symbolSector ?? null;

    const riskTimed = timeSync(() =>
      evaluateRisk({
        decision,
        capital: currentEquity,
        cash: portfolio.cash,
        riskPerTradePercent,
        confidence,
        tradingEnabled: this.tradingEnabled,
        killSwitch: this.killSwitch,
        dayStartEquity,
        weekStartEquity,
      }),
    );
    let risk = riskTimed.value;
    stages.push(ohStage('evaluateRisk', riskTimed.ms));

    if (risk.allowed && opts.quantityOverride != null && opts.quantityOverride >= 1) {
      const entry = decision.setup.entry ?? 0;
      const maxByCash = entry > 0 ? Math.floor(portfolio.cash / entry) : 0;
      const qty = Math.min(Math.round(opts.quantityOverride), risk.quantity, maxByCash);
      if (qty >= 1) {
        const perShare = Math.abs((decision.setup.entry ?? 0) - (decision.setup.stopLoss ?? 0));
        risk = {
          ...risk,
          quantity: qty,
          riskAmount: qty * perShare,
          maxLoss: qty * perShare,
        };
      }
    }

    const portTimed = timeSync(() =>
      evaluatePortfolio({
        decision,
        risk,
        portfolio,
        maxOpenPositions: this.riskBudgets.maxOpenPositions,
        maxNameExposurePct: this.riskBudgets.maxNameExposurePct,
        maxSectorExposurePct: this.riskBudgets.maxSectorExposurePct,
        cashReservePct: this.riskBudgets.cashReservePct,
        symbolSector,
      }),
    );
    const portVerdict = portTimed.value;
    stages.push(ohStage('evaluatePortfolio', portTimed.ms));

    const policyTimed = timeSync(() =>
      applyDecisionPolicy({
        operatingMode: this.mode,
        decisionMode: this.decisionMode,
        eligibility: decision.eligibility,
        risk,
        portfolio: portVerdict,
        liveAutoArmed: this.liveAutoEffective(),
      }),
    );
    const policy = policyTimed.value;
    stages.push(ohStage('applyDecisionPolicy', policyTimed.ms));

    const quantityBeforeConfidence = risk.allowed
      ? (risk.quantityBeforeConfidence ?? risk.quantity)
      : 0;
    const quantityAfterConfidence = risk.allowed ? risk.quantity : 0;
    const confidenceScale = risk.allowed
      ? (risk.confidenceScale ?? confidenceToScale(confidence))
      : confidenceToScale(confidence);
    const maxRiskAmount = currentEquity > 0 ? (currentEquity * riskPerTradePercent) / 100 : 0;

    const budgetSnapshot: DecisionBudgetSnapshot = {
      dayStartEquity,
      weekStartEquity,
      currentEquity,
      cash: portfolio.cash,
      perTradeRiskPercent: riskPerTradePercent,
      maxRiskAmount,
      confidence,
      confidenceScale,
      quantityBeforeConfidence,
      quantityAfterConfidence,
      symbolSector,
      maxNameExposurePct: this.riskBudgets.maxNameExposurePct,
      maxSectorExposurePct: this.riskBudgets.maxSectorExposurePct,
      maxOpenPositions: this.riskBudgets.maxOpenPositions,
      cashReservePct: this.riskBudgets.cashReservePct,
    };

    const totalMs = Date.now() - pipelineStarted;
    stages.push(ohStage('pipelineTotal', totalMs));
    this.ohMetrics.record({
      sampleId: randomUUID(),
      recordedAt: Date.now(),
      kind: 'PIPELINE',
      symbol: analysis.symbol,
      decisionId: decision.decisionId,
      opportunityId: opts.opportunityId,
      stages,
      totalMs,
      quoteAgeMs: this.lastQuoteAgeMs,
      ok: true,
    });

    return { decision, risk, portfolio: portVerdict, policy, budgetSnapshot, intelligenceSnapshot };
  }

  private recordLedger(
    pipeline: {
      decision: TradeDecision;
      risk: RiskVerdict;
      portfolio: PortfolioVerdict;
      policy: DecisionPolicyResult;
      budgetSnapshot: DecisionBudgetSnapshot;
      intelligenceSnapshot?: import('@stockpred/shared-types').IntelligenceSnapshot;
    },
    state: AgentDecisionState,
    decisionLabel: DecisionLedgerEntry['decision'],
    execution?: DecisionLedgerEntry['execution'],
    extraReasonCodes: DecisionReasonCode[] = [],
    extraReasons: string[] = [],
    evidence?: {
      agentRecommendation?: AgentRecommendationAction;
      humanDecision?: HumanDecisionAction;
      humanReasonCode?: HumanReasonCode | string;
      gateResult?: GateResultSnapshot;
      waitIntelligence?: WaitRecommendation;
      analysis?: AgentAnalysis;
      discoverySource?: OpportunityEvidenceProvenance['discoverySource'];
      batchId?: string;
      dataProvenance?: OpportunityEvidenceProvenance['dataProvenance'];
      focusTier?: OpportunityEvidenceProvenance['focusTier'];
    },
  ): DecisionLedgerEntry {
    const { decision, risk, portfolio, policy, budgetSnapshot, intelligenceSnapshot } = pipeline;
    const rankingContext = stampRankingContextFromResult(
      this.lastOpportunityRanking,
      decision.opportunityId ?? '',
      decision.symbol,
    );
    const freezesThesis = ['WAIT', 'REJECT', 'APPROVED', 'AUTO_ACCEPT'].includes(decisionLabel);
    const thesisSnapshot =
      freezesThesis && intelligenceSnapshot && evidence?.analysis
        ? buildThesisSnapshot({
            now: Date.now(),
            analysis: evidence.analysis,
            snapshot: intelligenceSnapshot,
            tradeHorizon: inferTradeHorizon(evidence.analysis.setup?.expectedHoldingPeriod),
            strategyTag: decision.strategy,
          })
        : undefined;

    const fromMap = decision.opportunityId
      ? this.opportunityProvenance.get(decision.opportunityId)
      : undefined;
    const discoverySource = evidence?.discoverySource ?? fromMap?.discoverySource;
    const batchId = evidence?.batchId ?? fromMap?.batchId;
    const focusTier = evidence?.focusTier ?? fromMap?.focusTier;
    const dataProvenance =
      evidence?.dataProvenance ??
      fromMap?.dataProvenance ??
      buildDataProvenance({
        dataAsOf: decision.quoteTimestamp,
        now: Date.now(),
      });

    const entry = this.ledger.append({
      decisionId: decision.decisionId,
      opportunityId: decision.opportunityId,
      timestamp: Date.now(),
      symbol: decision.symbol,
      direction: 'BUY',
      operatingMode: this.mode,
      decisionMode: this.decisionMode,
      state,
      analysisSnapshot: {
        score: decision.signalScore,
        confidence: decision.confidence,
        scores: decision.scores,
        regime: decision.marketRegime,
        thesis: decision.thesis,
        strategy: decision.strategy,
        eligibility: decision.eligibility,
        quoteTimestamp: decision.quoteTimestamp,
      },
      riskVerdict: risk,
      portfolioVerdict: portfolio,
      policy,
      budgetSnapshot,
      decision: decisionLabel,
      reasonCodes: [
        ...decision.reasonCodes,
        ...risk.reasonCodes,
        ...portfolio.reasonCodes,
        ...policy.reasonCodes,
        ...extraReasonCodes,
      ],
      decisionReasons: [
        ...decision.reasons,
        ...risk.reasons,
        ...portfolio.reasons,
        ...policy.reasons,
        ...extraReasons,
      ],
      execution,
      soakRunId: this.soakController?.getActiveRunId(),
      intelligenceSnapshot,
      agentRecommendation: evidence?.agentRecommendation,
      humanDecision: evidence?.humanDecision,
      humanReasonCode: evidence?.humanReasonCode,
      gateResult: evidence?.gateResult,
      rankingContext: rankingContext ?? undefined,
      waitIntelligence: evidence?.waitIntelligence,
      thesisSnapshot,
      discoverySource,
      batchId,
      dataProvenance,
      focusTier,
    });

    if (thesisSnapshot) {
      this.ledger.appendThesisEvent({
        decisionId: entry.decisionId,
        timestamp: entry.timestamp,
        event: buildThesisHistoryEvent({
          now: entry.timestamp,
          priorState: undefined,
          newState: thesisSnapshot.initialThesis.state,
          changes: [],
        }),
        reassessment: thesisSnapshot.initialThesis,
      });
    }

    return entry;
  }

  private reassessAndAppendThesis(input: {
    now: number;
    decisionId: string;
    initial: StructuredThesis;
    analysis: AgentAnalysis;
    snapshot: import('@stockpred/shared-types').IntelligenceSnapshot;
    priorReassessment?: StructuredThesis;
  }): StructuredThesis {
    const reassessed = reassessThesis({
      now: input.now,
      initial: input.initial,
      analysis: input.analysis,
      snapshot: input.snapshot,
    });
    const priorState = input.priorReassessment?.state ?? input.initial.state;
    const changes = detectWeakenedChanges(
      digestFromStructuredThesis(input.initial),
      digestThesisEvidence(input.snapshot),
    );
    const stateChanged = reassessed.state !== priorState;
    const hasNewChanges = changes.length > 0 && reassessed.state === 'WEAKENING';
    if (stateChanged || hasNewChanges) {
      this.ledger.appendThesisEvent({
        decisionId: input.decisionId,
        timestamp: input.now,
        event: buildThesisHistoryEvent({
          now: input.now,
          priorState,
          newState: reassessed.state,
          changes,
        }),
        reassessment: reassessed,
      });
    }
    return reassessed;
  }

  private async syncAutoTraderAgentGate(enabled: boolean): Promise<void> {
    try {
      await axios.post(
        `${this.autoTraderUrl}/agent-trading/enabled`,
        { enabled },
        { timeout: 5_000 },
      );
    } catch {
      // Auto-trader may be down; gate still applies on agent approve path.
    }
  }

  private liveArmingStatus(): AgentLiveArming {
    const blockers: string[] = [];
    if (!this.tradingEnabled) blockers.push('AI agent trading is disabled');
    if (this.killSwitch) blockers.push('Kill switch is on');
    if (!this.brokerConfigured) blockers.push('Configure a live broker first');
    if (!this.brokerTestOk) blockers.push('Broker connection test has not passed');
    if (!this.liveUserConfirmed && this.mode !== 'LIVE') {
      blockers.push('User has not confirmed ARM LIVE');
    }
    return {
      armed: this.liveArmed && this.mode === 'LIVE',
      brokerConfigured: this.brokerConfigured,
      brokerTestOk: this.brokerTestOk,
      killSwitchClear: !this.killSwitch,
      riskLimitsSet: true,
      userConfirmed: this.liveUserConfirmed,
      blockers,
    };
  }

  private async probeCapabilities(): Promise<AgentCapabilityStatus[]> {
    const probes = await Promise.all(
      AGENT_CAPABILITY_DEFS.map(async (def) => {
        try {
          switch (def.id) {
            case 'quotes': {
              const ok = await this.ping(`${this.marketDataUrl}/stocks?page=1&limit=1`);
              return { id: def.id, available: ok };
            }
            case 'signals': {
              const ok = await this.ping(`${this.signalUrl}/signals?limit=1`);
              return { id: def.id, available: ok };
            }
            case 'patterns': {
              const ok = await this.ping(`${this.patternUrl}/patterns?limit=1`);
              return { id: def.id, available: ok };
            }
            case 'predictions': {
              const ok = await this.ping(`${this.mlUrl}/health`);
              return { id: def.id, available: ok };
            }
            case 'fundamentals': {
              const ok = await this.ping(`${this.marketDataUrl}/fundamentals/panel`);
              return { id: def.id, available: ok };
            }
            case 'alt-news': {
              const ok = await this.ping(`${this.marketDataUrl}/alt-data/panel/news`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'GET /alt-data/panel/news'
                  : 'market-data news alt-data panel unreachable',
              };
            }
            case 'alt-social': {
              const ok = await this.ping(`${this.marketDataUrl}/alt-data/panel/social`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'GET /alt-data/panel/social'
                  : 'market-data social alt-data panel unreachable',
              };
            }
            case 'alt-macro': {
              const ok = await this.ping(`${this.marketDataUrl}/alt-data/panel/macro`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'GET /alt-data/panel/macro'
                  : 'market-data macro alt-data panel unreachable',
              };
            }
            case 'scanner':
            case 'manipulation': {
              const ok = await this.ping(`${this.marketDataUrl}/scanner?page=1&limit=1`);
              return { id: def.id, available: ok };
            }
            case 'portfolio': {
              const snapshot = await this.fetchPortfolio();
              const ok = snapshot != null && isPortfolioSnapshot(snapshot);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? `${snapshot.openPositions} open lot(s), cash ${snapshot.cash}`
                  : 'auto-trader GET /portfolio unreachable or invalid',
              };
            }
            case 'broker-orders': {
              // Paper + live both route through auto-trader BrokerRouter.
              const ok = await this.ping(`${this.autoTraderUrl}/portfolio`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'auto-trader BrokerRouter reachable'
                  : 'auto-trader unreachable — cannot place/cancel orders',
              };
            }
            case 'intraday-mtf': {
              const ok = await this.ping(`${this.marketDataUrl}/stocks/INFY/candles/mtf?limit=2`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'GET /stocks/:symbol/candles/mtf'
                  : 'market-data MTF candles unreachable',
              };
            }
            case 'peer-valuation': {
              const ok = await this.ping(`${this.marketDataUrl}/fundamentals/sector-medians`);
              return {
                id: def.id,
                available: ok,
                detail: ok
                  ? 'GET /fundamentals/sector-medians + /stocks/:symbol/peer-valuation'
                  : 'market-data peer valuation unreachable',
              };
            }
            default:
              return { id: def.id, available: false };
          }
        } catch {
          return { id: def.id, available: false };
        }
      }),
    );
    return buildCapabilityStatuses(probes);
  }

  private async analyzeSymbol(
    symbol: string,
    ctx: {
      quote?: StockQuote;
      portfolio: PortfolioSnapshot | null;
      statuses: AgentCapabilityStatus[];
      requests: AgentCapabilityRequest[];
    },
  ): Promise<AgentAnalysis> {
    const used: string[] = [];
    const missing: string[] = [];
    const quote = ctx.quote ?? (await this.fetchQuote(symbol));
    if (quote) used.push('quotes');
    else missing.push('quotes');

    const [fundamentals, altData] = await Promise.all([
      this.fetchFundamentals(symbol),
      this.fetchAltData(symbol),
    ]);
    if (fundamentals && !fundamentals.missing) used.push('fundamentals');
    else if (ctx.statuses.find((s) => s.id === 'fundamentals')?.available)
      missing.push('fundamentals');
    if (altData?.news) used.push('alt-news');
    if (altData?.social) used.push('alt-social');
    if (altData?.macro) used.push('alt-macro');
    if (quote?.suggestion) used.push('signals');
    if (quote?.scanner) used.push('scanner');
    if (quote?.manipulation) used.push('manipulation');
    if (ctx.portfolio) used.push('portfolio');
    else missing.push('portfolio');

    for (const req of ctx.requests) {
      if (req.priority === 'blocker' || (req.priority === 'high' && !req.id.startsWith('alt'))) {
        if (!used.includes(req.id) && !missing.includes(req.id)) missing.push(req.id);
      }
    }

    const requiredMissing = requiredCapabilitiesMissing(ctx.statuses);
    return composeAgentAnalysis({
      quote,
      fundamentals,
      altData,
      cash: ctx.portfolio?.cash ?? 0,
      riskPerTradePercent: this.riskPct,
      usedCapabilities: used,
      missingCapabilities: missing,
      capabilityRequests: ctx.requests.filter(
        (row) => this.suggestions.get(row.id)?.status !== 'acknowledged',
      ),
      requiredMissing,
    });
  }

  private async fetchActionableQuotes(): Promise<StockQuote[]> {
    try {
      const { data } = await axios.get<{ data: StockQuote[] }>(`${this.marketDataUrl}/stocks`, {
        params: { page: 1, limit: 200, suggestion: 'ACTIONABLE', sort: 'confidence' },
        timeout: 20_000,
      });
      const quotes = data.data ?? [];
      try {
        this.ohDataQuality.noteSourceReachable(true);
        for (const q of quotes.slice(0, 25)) {
          const issues = validateQuoteSample(q);
          if (q?.updatedAt != null && Number.isFinite(q.updatedAt)) {
            this.ohDataQuality.noteQuoteAge(Date.now() - q.updatedAt);
          }
          this.ohDataQuality.recordIssues('QUOTE', issues, { symbol: q?.symbol });
        }
      } catch {
        /* OH-5 observe-only */
      }
      return quotes;
    } catch {
      try {
        this.ohDataQuality.noteSourceReachable(false);
        this.ohDataQuality.recordIssues('SOURCE', validateQuoteSample(null));
      } catch {
        /* OH-5 observe-only */
      }
      return [];
    }
  }

  /** Quote RS + peer valuation for T1.4 (observe-only). */
  private async fetchTiCrossSectional(symbol: string): Promise<{
    rsVsNifty50?: number | null;
    sector?: string | null;
    peVsMedianPct?: number | null;
    pbVsMedianPct?: number | null;
    asOf?: string | number;
  } | null> {
    try {
      const [quoteRes, peerRes] = await Promise.all([
        axios.get(`${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}`, {
          timeout: 5_000,
          validateStatus: (s) => s >= 200 && s < 500,
        }),
        axios.get(`${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/peer-valuation`, {
          timeout: 5_000,
          validateStatus: (s) => s >= 200 && s < 500,
        }),
      ]);
      const quote = quoteRes.data as Record<string, unknown> | null;
      const peer = peerRes.data as Record<string, unknown> | null;
      const scanner = (quote?.scanner as Record<string, unknown> | undefined) ?? undefined;
      const rs =
        typeof quote?.relativeStrengthNifty50 === 'number'
          ? quote.relativeStrengthNifty50
          : typeof scanner?.relativeStrengthNifty50 === 'number'
            ? scanner.relativeStrengthNifty50
            : null;
      const sector =
        (typeof peer?.sector === 'string' ? peer.sector : null) ??
        (typeof quote?.sector === 'string' ? quote.sector : null);
      return {
        rsVsNifty50: rs,
        sector,
        peVsMedianPct: typeof peer?.peVsMedianPct === 'number' ? peer.peVsMedianPct : null,
        pbVsMedianPct: typeof peer?.pbVsMedianPct === 'number' ? peer.pbVsMedianPct : null,
        asOf: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /** MTF + daily closes for T1.5 multi-horizon agreement (observe-only). */
  private async fetchTiMultiHorizon(
    symbol: string,
    expectedHoldingPeriod?: string | null,
  ): Promise<{
    tradeHorizon: ReturnType<typeof inferTradeHorizon>;
    intendedSide: 'LONG';
    closesByHorizon: Partial<Record<'M5' | 'M15' | 'H1' | 'H4' | 'D1' | 'W1', number[]>>;
    sourceDataTimestamp?: string;
    asOf?: number;
  } | null> {
    try {
      const [mtfRes, dailyRes] = await Promise.all([
        axios.get<MultiTimeframeCandles>(
          `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/candles/mtf`,
          {
            params: { limit: 120 },
            timeout: 8_000,
            validateStatus: (s) => s >= 200 && s < 500,
          },
        ),
        axios.get<Array<{ close?: number; timestamp?: number }>>(
          `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/candles`,
          {
            params: { timeframe: Timeframe.ONE_DAY, limit: 120 },
            timeout: 8_000,
            validateStatus: (s) => s >= 200 && s < 500,
          },
        ),
      ]);
      const mtf = mtfRes.status < 300 ? mtfRes.data : null;
      const daily = dailyRes.status < 300 && Array.isArray(dailyRes.data) ? dailyRes.data : [];
      try {
        this.ohDataQuality.noteSourceReachable(Boolean(mtf) || daily.length > 0);
        if (mtf) {
          for (const tf of ['1m', '5m', '15m', '1h'] as const) {
            this.ohDataQuality.recordIssues('CANDLE', validateCandleSeries(mtf[tf], tf), {
              symbol,
              timeframe: tf,
            });
          }
        }
        this.ohDataQuality.recordIssues(
          'CANDLE',
          validateCandleSeries(daily as Array<{ close?: number; time?: number }>, '1d'),
          { symbol, timeframe: '1d' },
        );
      } catch {
        /* OH-5 observe-only */
      }
      if (!mtf && !daily.length) return null;

      const closes = (bars: Array<{ close?: number }> | undefined): number[] =>
        (bars ?? []).map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);

      const h1 = closes(mtf?.['1h']);
      const d1 = closes(daily);
      const lastTs =
        daily.length > 0
          ? Number((daily[daily.length - 1] as { time?: number }).time)
          : mtf?.['1h']?.length
            ? Number(mtf['1h'][mtf['1h'].length - 1]?.time)
            : undefined;

      return {
        tradeHorizon: inferTradeHorizon(expectedHoldingPeriod),
        intendedSide: 'LONG',
        closesByHorizon: {
          M5: closes(mtf?.['5m']),
          M15: closes(mtf?.['15m']),
          H1: h1,
          H4: approximateH4ClosesFromH1(h1),
          D1: d1,
          W1: approximateW1ClosesFromD1(d1),
        },
        sourceDataTimestamp:
          lastTs != null && Number.isFinite(lastTs) ? new Date(lastTs).toISOString() : undefined,
        asOf: Date.now(),
      };
    } catch {
      try {
        this.ohDataQuality.noteSourceReachable(false);
        this.ohDataQuality.recordIssues(
          'CANDLE',
          [{ diagnostic: 'SOURCE_UNAVAILABLE', message: 'mtf fetch failed' }],
          {
            symbol,
          },
        );
      } catch {
        /* OH-5 observe-only */
      }
      return null;
    }
  }

  /** MDS market context for TI regime engine (observe-only). */
  private async fetchTiMarketContext(): Promise<{
    scannerRegime?: string;
    vixLevel?: number | null;
    niftyChangePercent?: number | null;
    breadthPercentAboveEma50?: number | null;
    asOf?: string | number;
  } | null> {
    try {
      const { data } = await axios.get<MarketContext>(`${this.marketDataUrl}/market/context`, {
        timeout: 5_000,
      });
      try {
        this.ohDataQuality.recordIssues('CONTEXT', validateMarketContext(data));
      } catch {
        /* OH-5 observe-only */
      }
      if (!data?.regime) return null;
      return {
        scannerRegime: String(data.regime),
        vixLevel: data.vixLevel ?? null,
        niftyChangePercent: data.niftyChangePercent ?? null,
        breadthPercentAboveEma50: data.breadth?.percentAboveEma50 ?? null,
        asOf: data.breadth?.asOf ?? Date.now(),
      };
    } catch {
      try {
        this.ohDataQuality.recordIssues('CONTEXT', validateMarketContext(null));
      } catch {
        /* OH-5 observe-only */
      }
      return null;
    }
  }

  /** Usable ML prediction from MDS (fresh + drift-compatible). Observe-only. */
  private async fetchTiMlPrediction(symbol: string): Promise<HorizonPrediction | null> {
    try {
      const { data } = await axios.get<Record<string, unknown> | null>(
        `${this.marketDataUrl}/market/predictions/${encodeURIComponent(symbol)}`,
        { timeout: 5_000, validateStatus: (status) => status >= 200 && status < 500 },
      );
      if (!data || typeof data !== 'object') return null;
      const modelVersion = typeof data.modelVersion === 'string' ? data.modelVersion : null;
      if (!modelVersion) return null;
      const horizonRaw = String(data.horizon ?? PredictionHorizon.NEXT_DAY);
      const horizon =
        horizonRaw === PredictionHorizon.NEXT_WEEK
          ? PredictionHorizon.NEXT_WEEK
          : PredictionHorizon.NEXT_DAY;
      const predictionTimestamp =
        typeof data.predictionTimestamp === 'string' ? data.predictionTimestamp : undefined;
      return {
        symbol: String(data.symbol ?? symbol).toUpperCase(),
        direction: String(data.direction ?? 'SIDEWAYS'),
        confidence: Number(data.confidence ?? 0),
        expectedMove: Number(data.expectedMove ?? 0),
        horizon,
        modelVersion,
        modelId: typeof data.modelId === 'string' ? data.modelId : undefined,
        generatedAt: predictionTimestamp
          ? Date.parse(predictionTimestamp) || Date.now()
          : Date.now(),
        probabilities: data.probabilities as HorizonPrediction['probabilities'],
        calibratedProbabilities:
          data.calibratedProbabilities as HorizonPrediction['calibratedProbabilities'],
        predictionTimestamp,
        sourceDataTimestamp: (data.sourceDataTimestamp as string | null | undefined) ?? null,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
        featureVersion: typeof data.featureVersion === 'string' ? data.featureVersion : undefined,
        datasetVersion: typeof data.datasetVersion === 'string' ? data.datasetVersion : undefined,
        freshnessStatus: data.freshnessStatus as HorizonPrediction['freshnessStatus'],
        driftStatus: data.driftStatus as HorizonPrediction['driftStatus'],
        expectedReturn: (data.expectedReturn as number | null | undefined) ?? null,
        expectedMfe: (data.expectedMfe as number | null | undefined) ?? null,
        expectedMae: (data.expectedMae as number | null | undefined) ?? null,
      };
    } catch {
      return null;
    }
  }

  private async fetchQuote(symbol: string): Promise<StockQuote | null> {
    try {
      if (!symbol || String(symbol).trim() === '') {
        try {
          this.ohDataQuality.record({
            kind: 'QUOTE',
            ok: false,
            diagnostic: 'SYMBOL_MAPPING_FAILED',
            message: 'empty symbol',
          });
        } catch {
          /* OH-5 observe-only */
        }
      }
      const { data } = await axios.get<StockQuote>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}`,
        { timeout: 10_000 },
      );
      try {
        this.ohDataQuality.noteSourceReachable(true);
        const issues = validateQuoteSample(data);
        if (data?.updatedAt != null && Number.isFinite(data.updatedAt)) {
          this.ohDataQuality.noteQuoteAge(Date.now() - data.updatedAt);
        }
        this.ohDataQuality.recordIssues('QUOTE', issues, {
          symbol: data?.symbol ?? symbol,
        });
      } catch {
        /* OH-5 observe-only */
      }
      return data;
    } catch {
      try {
        this.ohDataQuality.noteSourceReachable(false);
        this.ohDataQuality.recordIssues('QUOTE', validateQuoteSample(null), { symbol });
      } catch {
        /* OH-5 observe-only */
      }
      return null;
    }
  }

  private async fetchFundamentals(symbol: string): Promise<FundamentalView | null> {
    try {
      const { data } = await axios.get<FundamentalView>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/fundamentals`,
        { timeout: 10_000 },
      );
      try {
        this.ohDataQuality.recordIssues('FUNDAMENTAL', validateFundamentals(data), {
          symbol,
        });
      } catch {
        /* OH-5 observe-only */
      }
      return data;
    } catch {
      try {
        this.ohDataQuality.recordIssues('FUNDAMENTAL', validateFundamentals(null), {
          symbol,
        });
      } catch {
        /* OH-5 observe-only */
      }
      return null;
    }
  }

  private async fetchAltData(symbol: string): Promise<AltDataView | null> {
    try {
      const { data } = await axios.get<AltDataView>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/alt-data`,
        { timeout: 10_000 },
      );
      try {
        if (data == null || data.missing === true) {
          this.ohDataQuality.recordIssues(
            'ALT',
            [{ diagnostic: 'CONTEXT_MISSING', message: 'alt-data missing' }],
            { symbol },
          );
        } else {
          const asOf = data.news?.asOfDate ?? data.social?.asOfDate ?? data.macro?.asOfDate;
          if (asOf == null || !Number.isFinite(asOf)) {
            this.ohDataQuality.recordIssues(
              'ALT',
              [{ diagnostic: 'CONTEXT_MISSING', message: 'alt-data asOf missing' }],
              { symbol },
            );
          } else {
            this.ohDataQuality.recordIssues('ALT', [], { symbol });
          }
        }
      } catch {
        /* OH-5 observe-only */
      }
      return data;
    } catch {
      try {
        this.ohDataQuality.recordIssues(
          'ALT',
          [{ diagnostic: 'SOURCE_UNAVAILABLE', message: 'alt-data fetch failed' }],
          { symbol },
        );
      } catch {
        /* OH-5 observe-only */
      }
      return null;
    }
  }

  /**
   * T1.7 catalyst candidates from published alt-data only (observe-only).
   * Does not invent an upcoming earnings calendar.
   */
  private async fetchTiCatalyst(symbol: string): Promise<{
    candidates: ReturnType<typeof candidatesFromAltData>;
    decisionTimestamp: number;
  } | null> {
    const alt = await this.fetchAltData(symbol);
    if (!alt || alt.missing) return null;
    const candidates = candidatesFromAltData(alt);
    if (!candidates.length) return null;
    return { candidates, decisionTimestamp: Date.now() };
  }

  private async fetchPortfolio(
    userId?: string,
    brandId?: string,
  ): Promise<PortfolioSnapshot | null> {
    try {
      const data = await axios
        .get<PortfolioSnapshot>(`${this.autoTraderUrl}/portfolio`, {
          timeout: 10_000,
          headers: {
            ...(userId ? { 'x-user-id': userId } : {}),
            ...(brandId ? { 'x-brand-id': brandId } : {}),
          },
          validateStatus: (status) => status >= 200 && status < 300,
        })
        .then((r) => r.data);
      if (isPortfolioSnapshot(data)) {
        this.lastPortfolioEquity = data.equity || data.capital || 0;
        this.lastPortfolioCash = data.cash || 0;
        this.lastOpenPositions = data.openPositions ?? data.holdings?.length ?? 0;
        this.lastDayStartEquity = data.dayStartEquity ?? this.lastPortfolioEquity;
        this.lastWeekStartEquity = data.weekStartEquity ?? this.lastPortfolioEquity;
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async ping(url: string): Promise<boolean> {
    try {
      const response = await axios.get(url, { timeout: 4_000, validateStatus: () => true });
      return response.status >= 200 && response.status < 500;
    } catch {
      return false;
    }
  }

  /** Snapshot anchors for soak baseline (best-effort; zeros if portfolio unavailable). */
  peekPortfolioAnchors(): {
    equity: number;
    cash: number;
    openPositions: number;
    dayStartEquity: number;
    weekStartEquity: number;
  } {
    return {
      equity: this.lastPortfolioEquity,
      cash: this.lastPortfolioCash,
      openPositions: this.lastOpenPositions,
      dayStartEquity: this.lastDayStartEquity || this.lastPortfolioEquity,
      weekStartEquity: this.lastWeekStartEquity || this.lastPortfolioEquity,
    };
  }

  /** Phase 7 desk/API snapshot � stop status only; never authorizes. */
  getBreakerStatus(
    userId?: string,
    brandId?: string | null,
  ): {
    tripped: boolean;
    activeBreakers: string[];
    reasonCodes: DecisionReasonCode[];
    reasons: string[];
    lastTripAt: number | null;
    lastTripReasonCodes: DecisionReasonCode[];
    lastTripReasons: string[];
    dailyAutoAcceptCount: number;
    consecutiveVetoCount: number;
    aggregateState: P7AggregateState;
    enforcement: P7Enforcement;
    subStates: Partial<Record<string, P7BreakerSubState>>;
    insufficientBreakers: string[];
  } {
    this.rollBreakerDayIfNeeded();
    const metrics = this.collectBreakerMetrics(userId, brandId);
    const evaluation = evaluateBreakers(metrics, DEFAULT_BREAKER_CONFIG);
    const tenant = userId ? this.tenantBreakers.get(userId, brandId) : null;
    return {
      tripped: evaluation.tripped || this.lastP7Enforcement !== 'NONE',
      activeBreakers: evaluation.trips.map((t) => t.breakerId),
      reasonCodes: evaluation.reasonCodes,
      reasons: evaluation.reasons,
      lastTripAt: this.lastBreakerTripAt,
      lastTripReasonCodes: this.lastBreakerReasonCodes,
      lastTripReasons: this.lastBreakerReasons,
      dailyAutoAcceptCount: tenant?.dailyAutoAcceptCount ?? this.dailyAutoAcceptCount,
      consecutiveVetoCount: tenant?.consecutiveVetoCount ?? this.consecutiveVetoCount,
      aggregateState: this.lastP7AggregateState,
      enforcement: this.lastP7Enforcement,
      subStates: this.lastP7SubStates,
      insufficientBreakers: Object.entries(this.lastP7SubStates)
        .filter(([, s]) => s === 'INSUFFICIENT')
        .map(([k]) => k),
    };
  }

  private rollBreakerDayIfNeeded(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (this.breakerDayKey !== key) {
      this.breakerDayKey = key;
      this.dailyAutoAcceptCount = 0;
    }
  }

  private collectBreakerMetrics(userId?: string, brandId?: string | null) {
    this.rollBreakerDayIfNeeded();
    const tenant = userId ? this.tenantBreakers.get(userId, brandId) : null;
    const brokerConnected = this.mode !== 'LIVE' || this.brokerTestOk;
    const base = emptyBreakerMetrics({
      dailyAutoAcceptCount: tenant?.dailyAutoAcceptCount ?? this.dailyAutoAcceptCount,
      autoPnlDrawdownPct: tenant?.autoPnlDrawdownPct ?? this.autoPnlDrawdownPct,
      consecutiveVetoCount: tenant?.consecutiveVetoCount ?? this.consecutiveVetoCount,
      quoteAgeMs: this.lastQuoteAgeMs,
      brokerConnected,
      scoreAbsZ: this.lastScoreAbsZ,
      lastSlippageAbsBps: this.lastSlippageAbsBps,
    });
    const records = this.ledger.listRaw(5_000);
    const soakRunId = this.soakController?.getActiveRunId() ?? null;
    const built = buildP7BreakerMetrics(base, { records, soakRunId }, this.p7RecoveryStore);
    Object.assign(this.p7RecoveryStore, built.recovery);

    const system = evaluateP7BreakerSystem({
      metrics: built.breakerMetrics,
      brokerConnected,
      advancedSubStates: built.advancedSubStates,
    });
    this.lastP7AggregateState = system.aggregate;
    this.lastP7Enforcement = system.enforcement;
    this.lastP7SubStates = system.subStates;

    return built.breakerMetrics;
  }

  /**
   * Phase 7 stop enforcement: if any breaker trips, force APPROVAL and ledger codes.
   * Never sets liveAutoArmed and never returns AUTO_ACCEPTED.
   */
  private enforceBreakers(context: string, userId?: string, brandId?: string | null): boolean {
    const metrics = this.collectBreakerMetrics(userId, brandId);
    const evaluation = evaluateBreakers(metrics, DEFAULT_BREAKER_CONFIG);
    const shouldEnforce =
      evaluation.tripped ||
      this.lastP7Enforcement === 'FORCE_APPROVAL' ||
      this.lastP7Enforcement === 'RESTRICT_AUTONOMOUS';
    if (!shouldEnforce) {
      return false;
    }
    this.lastBreakerTripAt = Date.now();
    this.lastBreakerReasonCodes = evaluation.reasonCodes;
    this.lastBreakerReasons = evaluation.reasons;
    if (this.decisionMode === 'AUTONOMOUS') {
      this.decisionMode = 'APPROVAL';
      this.persistState();
      console.warn(
        `[trader-agent] Phase 7 breaker trip (${context}): ${evaluation.reasonCodes.join(',')} → APPROVAL`,
      );
    }
    return true;
  }

  /** Soak kill path — force APPROVAL only; never authorizes. */
  forceApprovalFromSoak(killCode: string, killReason: string): void {
    if (this.decisionMode === 'AUTONOMOUS') {
      this.decisionMode = 'APPROVAL';
      this.persistState();
    }
    console.warn(`[trader-agent] soak kill ${killCode}: ${killReason} → APPROVAL`);
  }

  /**
   * Append-only trade outcome (idempotent). Does not mutate the original decision row.
   */
  recordTradeOutcome(input: {
    decisionId?: string;
    tradeId?: string;
    orderId?: string;
    positionId?: string;
    symbol?: string;
    exitPrice: number;
    pnl: number;
    pnlPercent?: number;
    holdingPeriodMs?: number;
    exitReason: string;
    closedAt?: number;
  }): { recorded: boolean; duplicate: boolean; decisionId?: string } {
    const decision =
      (input.decisionId ? this.ledger.get(input.decisionId) : null) ??
      (input.tradeId ? this.ledger.getByTradeId(input.tradeId) : null) ??
      (input.orderId ? this.ledger.getByTradeId(input.orderId) : null);
    if (!decision) {
      return { recorded: false, duplicate: false };
    }
    const plannedRisk =
      decision.execution?.plannedRiskAmount ??
      (decision.riskVerdict && 'riskAmount' in decision.riskVerdict
        ? decision.riskVerdict.riskAmount
        : undefined);
    const pnl = input.pnl;
    const realizedR = plannedRisk != null && plannedRisk > 0 ? pnl / plannedRisk : 0;
    const entry = decision.execution?.entryPrice;
    const qty = decision.execution?.quantity;
    const pnlPercent =
      input.pnlPercent ??
      (entry != null && entry > 0 && qty != null && qty > 0 ? (pnl / (entry * qty)) * 100 : 0);
    const { duplicate } = this.ledger.appendOutcome({
      outcomeId: randomUUID(),
      decisionId: decision.decisionId,
      soakRunId: decision.soakRunId ?? this.soakController?.getActiveRunId(),
      positionId: input.positionId,
      orderId: input.orderId ?? decision.execution?.orderId,
      tradeId: input.tradeId ?? decision.tradeId,
      symbol: input.symbol ?? decision.symbol,
      exitPrice: input.exitPrice,
      pnl,
      pnlPercent,
      holdingPeriodMs:
        input.holdingPeriodMs ?? (decision.timestamp ? Date.now() - decision.timestamp : 0),
      exitReason: input.exitReason,
      closedAt: input.closedAt ?? Date.now(),
      realizedR,
      plannedRiskAmount: plannedRisk,
      outcomeKind: 'ACTUAL',
      rankingContextId: decision.rankingContext?.rankingContextId,
      netR: realizedR,
      grossR: realizedR,
      maeR: null,
      mfeR: null,
      pathMetricsStatus: 'UNAVAILABLE',
    });
    return { recorded: !duplicate, duplicate, decisionId: decision.decisionId };
  }
}
