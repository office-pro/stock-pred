import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AGENT_DISCLAIMER,
  AgentAnalysis,
  AgentCapabilityRequest,
  AgentCapabilityStatus,
  AgentLiveArming,
  AgentManagedPosition,
  AgentMode,
  AgentRecommendation,
  AgentSuggestion,
  AltDataView,
  DEFAULT_RISK_LIMITS,
  FundamentalView,
  PortfolioSnapshot,
  StockQuote,
  TradeSide,
} from '@stockpred/shared-types';
import {
  AGENT_CAPABILITY_DEFS,
  buildCapabilityStatuses,
  capabilityRequestsFromStatuses,
  composeAgentAnalysis,
  evaluateExitPolicy,
  getEnv,
  getEnvNumber,
  isPortfolioSnapshot,
  requiredCapabilitiesMissing,
} from '@stockpred/shared-utils';
import axios from 'axios';
import { randomUUID } from 'crypto';
import {
  cursorSdkConfigured,
  cursorSdkInstalled,
  appendProgressLine,
  launchCapabilityImplement,
  writeTaskBrief,
} from './implement-runner';
import { SuggestionStore } from './suggestion-store';

@Injectable()
export class AgentService {
  /** Master gate — agent trading is off until the user enables it. */
  private tradingEnabled = false;
  private mode: AgentMode = 'PAPER';
  private killSwitch = false;
  private liveArmed = false;
  private liveUserConfirmed = false;
  private brokerConfigured = false;
  private brokerTestOk = false;
  private readonly recommendations = new Map<string, AgentRecommendation>();
  private readonly positionNotes = new Map<
    string,
    { policy: AgentManagedPosition['policy']; note: string; target2?: number }
  >();
  private readonly suggestions = new SuggestionStore();

  private readonly marketDataUrl = getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002');
  private readonly signalUrl = getEnv('SIGNAL_ENGINE_URL', 'http://localhost:3003');
  private readonly patternUrl = getEnv('PATTERN_ENGINE_URL', 'http://localhost:3004');
  private readonly autoTraderUrl = getEnv('AUTO_TRADER_URL', 'http://localhost:3006');
  private readonly mlUrl = getEnv('ML_ENGINE_URL', 'http://localhost:8000');
  private readonly riskPct = getEnvNumber(
    'RISK_PER_TRADE_PCT',
    DEFAULT_RISK_LIMITS.perTradeRiskPercent,
  );

  getMode(): {
    tradingEnabled: boolean;
    mode: AgentMode;
    killSwitch: boolean;
    liveArming: AgentLiveArming;
    disclaimer: string;
  } {
    return {
      tradingEnabled: this.tradingEnabled,
      mode: this.mode,
      killSwitch: this.killSwitch,
      liveArming: this.liveArmingStatus(),
      disclaimer: AGENT_DISCLAIMER,
    };
  }

  async setTradingEnabled(enabled: boolean): Promise<{ tradingEnabled: boolean }> {
    this.tradingEnabled = enabled;
    if (!enabled) {
      this.liveArmed = false;
      this.liveUserConfirmed = false;
      if (this.mode === 'LIVE') this.mode = 'PAPER';
    }
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
    return { mode: this.mode, liveArming: this.liveArmingStatus() };
  }

  setKillSwitch(enabled: boolean, flatten?: boolean): { killSwitch: boolean; flatten: boolean } {
    this.killSwitch = enabled;
    if (enabled && this.liveArmed) {
      this.liveArmed = false;
    }
    return { killSwitch: this.killSwitch, flatten: Boolean(flatten) };
  }

  recordBrokerConfig(ok: boolean): void {
    this.brokerConfigured = ok;
  }

  recordBrokerTest(ok: boolean): void {
    this.brokerTestOk = ok;
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
          status: 'open',
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
      if (existing.status === 'open' || existing.status === 'acknowledged') {
        this.suggestions.patch(request.id, {
          title: request.title,
          whyNeeded: request.whyNeeded,
          suggestedOwner: request.suggestedOwner,
          priority: request.priority,
        });
      }
    }
  }

  async getOpportunities(limit = 20): Promise<{
    mode: AgentMode;
    opportunities: AgentAnalysis[];
    capabilityRequests: AgentCapabilityRequest[];
    disclaimer: string;
  }> {
    const statuses = await this.probeCapabilities();
    const requests = capabilityRequestsFromStatuses(statuses);
    const portfolio = await this.fetchPortfolio();
    const held = new Set((portfolio?.holdings ?? []).map((lot) => lot.symbol.toUpperCase()));
    const cash = portfolio?.cash ?? 0;
    const quotes = await this.fetchActionableQuotes();
    const opportunities: AgentAnalysis[] = [];

    for (const quote of quotes.slice(0, Math.min(80, Math.max(limit * 3, 20)))) {
      if (held.has(quote.symbol.toUpperCase())) continue;

      const analysis = await this.analyzeSymbol(quote.symbol, {
        quote,
        portfolio,
        statuses,
        requests,
      });

      // Don't re-list buys we already executed this session (or that cash cannot fund).
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
        this.recommendations.set(id, {
          id,
          analysis,
          status: 'PENDING',
          expiresAt: Date.now() + 30 * 60_000,
        });
        opportunities.push(analysis);
      }
    }

    opportunities.sort((a, b) => b.scores.overall - a.scores.overall);
    return {
      mode: this.mode,
      opportunities: opportunities.slice(0, limit),
      capabilityRequests: requests.filter(
        (row) => this.suggestions.get(row.id)?.status !== 'acknowledged',
      ),
      disclaimer: AGENT_DISCLAIMER,
    };
  }

  async getAnalysis(symbol: string): Promise<AgentAnalysis> {
    const upper = symbol.toUpperCase();
    const statuses = await this.probeCapabilities();
    const requests = capabilityRequestsFromStatuses(statuses);
    const portfolio = await this.fetchPortfolio();
    const analysis = await this.analyzeSymbol(upper, { portfolio, statuses, requests });
    const id = randomUUID();
    analysis.recommendationId = id;
    this.recommendations.set(id, {
      id,
      analysis,
      status: 'PENDING',
      expiresAt: Date.now() + 30 * 60_000,
    });
    return analysis;
  }

  async getPortfolio(): Promise<PortfolioSnapshot> {
    const portfolio = await this.fetchPortfolio();
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

  async getPositions(): Promise<{ positions: AgentManagedPosition[]; killSwitch: boolean }> {
    const portfolio = await this.fetchPortfolio();
    const positions: AgentManagedPosition[] = (portfolio?.holdings ?? []).map((lot) => {
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
        policyNote: note?.note ?? policyEval.note,
        openedAt: lot.openedAt ?? Date.now(),
      };
    });
    return { positions, killSwitch: this.killSwitch };
  }

  async approveRecommendation(
    id: string,
    userId?: string,
    quantityOverride?: number,
  ): Promise<{ recommendation: AgentRecommendation; trade: unknown }> {
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
    const rec = this.recommendations.get(id);
    if (!rec) throw new NotFoundException('Recommendation not found');
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

    const quantityRaw =
      quantityOverride != null && quantityOverride >= 1
        ? Math.round(quantityOverride)
        : setup.positionSize;

    // Honor quantity override even when risk sizing floored to 0 at scan time.
    if (
      !setup.entry ||
      setup.entry <= 0 ||
      !setup.stopLoss ||
      setup.stopLoss <= 0 ||
      quantityRaw < 1
    ) {
      throw new BadRequestException(
        `Setup missing entry/stop/size for ${symbol} (entry=${setup.entry ?? '—'}, stop=${setup.stopLoss ?? '—'}, qty=${quantityRaw})`,
      );
    }

    const portfolio = await this.fetchPortfolio();
    const cash = portfolio?.cash ?? 0;
    const maxAffordable = Math.floor(cash / setup.entry);
    if (maxAffordable < 1) {
      throw new BadRequestException(
        `Insufficient paper cash to buy ${symbol} (cash ₹${cash.toFixed(2)}, entry ₹${setup.entry})`,
      );
    }
    const quantity = Math.min(quantityRaw, maxAffordable);

    try {
      const trade = await axios.post(
        `${this.autoTraderUrl}/trade/execute`,
        {
          symbol: setup.instrument || symbol,
          side: TradeSide.BUY,
          quantity,
          price: setup.entry,
          target: setup.target1 ?? undefined,
          stopLoss: setup.stopLoss,
        },
        {
          headers: userId ? { 'x-user-id': userId } : undefined,
          timeout: 30_000,
        },
      );

      rec.status = 'EXECUTED';
      const tradedSymbol = (setup.instrument || symbol).toUpperCase();
      this.positionNotes.set(tradedSymbol, {
        policy: 'HOLD',
        note: 'Agent-approved lot — monitoring stop/target with exit policy.',
        target2: setup.target2 ?? undefined,
      });
      // Drop any other pending recs for this symbol so they cannot be re-approved as ghosts.
      for (const [recId, pending] of this.recommendations) {
        if (
          recId !== id &&
          pending.status === 'PENDING' &&
          pending.analysis.symbol.toUpperCase() === tradedSymbol
        ) {
          pending.status = 'REJECTED';
        }
      }
      return { recommendation: rec, trade: trade.data };
    } catch (error) {
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
            case 'alt-news':
            case 'alt-social':
            case 'alt-macro': {
              // Optional: availability probed per-symbol during analyze.
              return { id: def.id, available: true, detail: 'probed per symbol' };
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
            case 'broker-orders':
              return { id: def.id, available: true, detail: 'BrokerRouter path in auto-trader' };
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
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  private async fetchQuote(symbol: string): Promise<StockQuote | null> {
    try {
      const { data } = await axios.get<StockQuote>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}`,
        { timeout: 10_000 },
      );
      return data;
    } catch {
      return null;
    }
  }

  private async fetchFundamentals(symbol: string): Promise<FundamentalView | null> {
    try {
      const { data } = await axios.get<FundamentalView>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/fundamentals`,
        { timeout: 10_000 },
      );
      return data;
    } catch {
      return null;
    }
  }

  private async fetchAltData(symbol: string): Promise<AltDataView | null> {
    try {
      const { data } = await axios.get<AltDataView>(
        `${this.marketDataUrl}/stocks/${encodeURIComponent(symbol)}/alt-data`,
        { timeout: 10_000 },
      );
      return data;
    } catch {
      return null;
    }
  }

  private async fetchPortfolio(): Promise<PortfolioSnapshot | null> {
    try {
      const { data } = await axios.get<PortfolioSnapshot>(`${this.autoTraderUrl}/portfolio`, {
        timeout: 10_000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return isPortfolioSnapshot(data) ? data : null;
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
}
