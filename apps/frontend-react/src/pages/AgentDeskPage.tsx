import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type {
  StructuredThesis,
  ExitRecommendation,
  TradeLifecycleSnapshot,
} from '@stockpred/shared-types';
import AgentTradingToggle from '../components/AgentTradingToggle';
import AgentSuggestionCards from '../components/AgentSuggestionCards';
import { authErrorMessage } from '../lib/auth-errors';
import {
  useApproveAgentRecommendationMutation,
  useWaitAgentRecommendationMutation,
  useRejectAgentRecommendationMutation,
  useGetAgentCalibrationQuery,
  useGetAgentDecisionsQuery,
  useGetAgentModeQuery,
  useGetAgentOpportunitiesQuery,
  useGetAgentOpsQuery,
  useGetAgentPositionsQuery,
  useGetAgentRiskBudgetsQuery,
  useGetAgentSoakCompareQuery,
  useGetAgentSoakQuery,
  useGetAgentSoakReportQuery,
  useGetAgentWalkForwardQuery,
  useGetAgentTransactionsQuery,
  useGetPortfolioQuery,
  useSetAgentDecisionModeMutation,
  useSetAgentKillSwitchMutation,
  useSetAgentModeMutation,
  useSetAgentLiveAutoArmMutation,
  useStartAgentSoakMutation,
  useStopAgentSoakMutation,
  useWaiveAgentSoakMutation,
} from '../store/api';

function TradeLifecyclePanel({ lifecycle }: { lifecycle: TradeLifecycleSnapshot }) {
  const recentEvents = lifecycle.events.slice(-4);
  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.selected' }}>
      <Typography variant="caption" fontWeight={700} display="block">
        Trade lifecycle: {lifecycle.currentStage} — measurement only
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
        {lifecycle.metrics.realizedR != null
          ? `Realized R ${lifecycle.metrics.realizedR.toFixed(2)}`
          : 'Realized R —'}
        {lifecycle.metrics.thesisEvolutionCount != null
          ? ` · thesis evolutions ${lifecycle.metrics.thesisEvolutionCount}`
          : ''}
        {lifecycle.metrics.plannedWaitDurationMs != null
          ? ` · planned wait ${Math.round(lifecycle.metrics.plannedWaitDurationMs / 60_000)}m`
          : ''}
        {lifecycle.metrics.waitDurationMs != null
          ? ` · observed wait ${Math.round(lifecycle.metrics.waitDurationMs / 60_000)}m`
          : ''}
      </Typography>
      {recentEvents.length > 0 ? (
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
          {recentEvents
            .map((e) =>
              e.kind === 'STAGE' && e.stage
                ? `${e.stage} (${e.source})`
                : `${e.detail ?? e.source} [context]`,
            )
            .join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

function ExitIntelligencePanel({ exit }: { exit: ExitRecommendation }) {
  return (
    <Box sx={{ mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="caption" fontWeight={700} display="block">
        Exit recommendation: {exit.action} — advisory
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
        {exit.summary}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Codes: {exit.reasonCodes.join(', ') || '—'}
      </Typography>
      {exit.evidence.length > 0 ? (
        <Typography variant="caption" display="block" color="text.secondary">
          Evidence: {exit.evidence.map((e) => e.message).join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

function ThesisIntelligencePanel({ thesis }: { thesis: StructuredThesis }) {
  const weakened = thesis.supportingEvidence.filter((e) => e.polarity === 'NEGATIVE');
  const supporting = thesis.supportingEvidence.filter((e) => e.polarity !== 'NEGATIVE');
  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="caption" fontWeight={700} display="block">
        Thesis Intelligence
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
        {thesis.primaryThesis}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Status: {thesis.state}
      </Typography>
      {supporting.length > 0 ? (
        <Typography variant="caption" display="block" color="text.secondary">
          Supporting: {supporting.map((e) => e.message).join(' · ')}
        </Typography>
      ) : null}
      {weakened.length > 0 ? (
        <Typography variant="caption" display="block" color="warning.main">
          Weakened: {weakened.map((e) => e.message).join(' · ')}
        </Typography>
      ) : null}
      {thesis.invalidationConditions.length > 0 ? (
        <Typography variant="caption" display="block" color="text.secondary">
          Invalidation: {thesis.invalidationConditions.join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

function WaitIntelligencePanel({
  wait,
}: {
  wait: {
    decision: 'WAIT';
    summary: string;
    reasonCodes: string[];
    reevaluateWhen: {
      trigger: string;
      priceLevel?: number;
      timeAt?: number;
      eventRef?: string;
      unavailableReason?: string;
    };
    invalidation: { conditions: string[] };
    evidenceDelta?: string[];
  };
}) {
  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="caption" fontWeight={700} display="block">
        WAIT Intelligence
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
        Why? {wait.summary}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Codes: {wait.reasonCodes.join(', ') || '—'}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Reassess: {wait.reevaluateWhen.trigger}
        {wait.reevaluateWhen.priceLevel != null ? ` @ ₹${wait.reevaluateWhen.priceLevel}` : ''}
        {wait.reevaluateWhen.timeAt != null
          ? ` · ${new Date(wait.reevaluateWhen.timeAt).toLocaleString()}`
          : ''}
        {wait.reevaluateWhen.eventRef ? ` · ${wait.reevaluateWhen.eventRef}` : ''}
        {wait.reevaluateWhen.unavailableReason ? ` · ${wait.reevaluateWhen.unavailableReason}` : ''}
      </Typography>
      {wait.invalidation.conditions.length > 0 ? (
        <Typography variant="caption" display="block" color="text.secondary">
          Invalidated by: {wait.invalidation.conditions.join(' · ')}
        </Typography>
      ) : null}
      {wait.evidenceDelta?.length ? (
        <Typography variant="caption" display="block" color="text.secondary">
          Evidence changed: {wait.evidenceDelta.join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

type ApproveTarget = {
  id: string;
  symbol: string;
  suggestedQty: number;
  entry: number;
};

type OpportunityRow = {
  symbol: string;
  decision: string;
  recommendationId?: string;
  setup: {
    positionSize: number;
    entry?: number | null;
    stopLoss?: number | null;
  };
  scores: { overall: number };
  thesis: string;
  missingCapabilities?: string[];
};

type AddedRow = OpportunityRow & {
  executedAt: number;
  quantity: number;
  status: 'APPROVED' | 'EXECUTED';
};

function isApprovable(row: OpportunityRow): boolean {
  if (!row.recommendationId || !row.decision.includes('BUY')) return false;
  const entry = row.setup?.entry;
  const stop = row.setup?.stopLoss;
  // Size may be 0 from risk floor — approve still works with qty override / min lot.
  return entry != null && entry > 0 && stop != null && stop > 0;
}

function suggestedQty(row: OpportunityRow): number {
  const sized = Math.round(row.setup.positionSize || 0);
  return sized >= 1 ? sized : 1;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function AgentDeskPage(): JSX.Element {
  const [symbol, setSymbol] = useState('');
  const { data: modeData, refetch: refetchMode } = useGetAgentModeQuery(undefined, {
    pollingInterval: 15_000,
  });
  const { data: riskBudgetsData } = useGetAgentRiskBudgetsQuery(undefined, {
    pollingInterval: 60_000,
  });
  const { data: walkForwardData } = useGetAgentWalkForwardQuery(undefined, {
    pollingInterval: 120_000,
  });
  const { data: soakData, refetch: refetchSoak } = useGetAgentSoakQuery(undefined, {
    pollingInterval: 10_000,
  });
  const soakRunId = soakData?.soak?.soakRunId;
  const { data: opsData } = useGetAgentOpsQuery(soakRunId ? { soakRunId } : undefined, {
    pollingInterval: 15_000,
  });
  const { data: calibrationData } = useGetAgentCalibrationQuery(
    soakRunId ? { soakRunId } : undefined,
    { pollingInterval: 30_000 },
  );
  const { data: compareData } = useGetAgentSoakCompareQuery(soakRunId ? { soakRunId } : undefined, {
    pollingInterval: 60_000,
  });
  const { data: soakReport } = useGetAgentSoakReportQuery(undefined, {
    pollingInterval: 30_000,
    skip: !soakData?.soak || soakData.soak.state === 'RUNNING' || soakData.soak.state === 'IDLE',
  });
  const [startSoak, startSoakState] = useStartAgentSoakMutation();
  const [stopSoak, stopSoakState] = useStopAgentSoakMutation();
  const [waiveSoak, waiveSoakState] = useWaiveAgentSoakMutation();
  const {
    data: opps,
    refetch: refetchOpps,
    isFetching,
  } = useGetAgentOpportunitiesQuery({
    limit: 25,
  });
  const { data: positions, refetch: refetchPositions } = useGetAgentPositionsQuery(undefined, {
    pollingInterval: 10_000,
  });
  const { data: txAudit, refetch: refetchTx } = useGetAgentTransactionsQuery(
    { limit: 40 },
    { pollingInterval: 15_000 },
  );
  const { data: portfolio, refetch: refetchPortfolio } = useGetPortfolioQuery(undefined, {
    pollingInterval: 10_000,
  });
  const [setMode] = useSetAgentModeMutation();
  const [setLiveAutoArm] = useSetAgentLiveAutoArmMutation();
  const [setDecisionMode] = useSetAgentDecisionModeMutation();
  const [setKill] = useSetAgentKillSwitchMutation();
  const [approve, approveState] = useApproveAgentRecommendationMutation();
  const [wait, waitState] = useWaitAgentRecommendationMutation();
  const [reject, rejectState] = useRejectAgentRecommendationMutation();
  const [toast, setToast] = useState<string | null>(null);
  const [toastSeverity, setToastSeverity] = useState<'info' | 'success' | 'error'>('info');
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null);
  const [approveQty, setApproveQty] = useState('1');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTargets, setBulkTargets] = useState<ApproveTarget[] | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [oppsTab, setOppsTab] = useState<'new' | 'added'>('new');
  const [decisionDrawerOpen, setDecisionDrawerOpen] = useState(false);
  const [decisionLookupId, setDecisionLookupId] = useState<string | undefined>(undefined);

  const { data: decisionsData, refetch: refetchDecisions } = useGetAgentDecisionsQuery(
    { limit: 30, decisionId: decisionLookupId },
    { skip: !decisionDrawerOpen, pollingInterval: decisionDrawerOpen ? 15_000 : 0 },
  );

  const tradingOn = Boolean(modeData?.tradingEnabled);
  const mode = modeData?.mode ?? 'PAPER';
  const decisionMode = modeData?.decisionMode ?? 'APPROVAL';
  const riskBudgets = riskBudgetsData?.riskBudgets ?? modeData?.riskBudgets;
  const parsedApproveQty = Math.max(1, Math.round(Number(approveQty) || 0));
  const approveQtyValid = Number.isFinite(Number(approveQty)) && Number(approveQty) >= 1;

  const opportunities = (opps?.opportunities ?? []) as OpportunityRow[];
  const added = (opps?.added ?? []) as AddedRow[];
  const opportunityRanking = opps?.opportunityRanking;
  const rankingBySymbol = useMemo(() => {
    const map = new Map<string, NonNullable<typeof opportunityRanking>['rankings'][number]>();
    for (const row of opportunityRanking?.rankings ?? []) {
      map.set(row.symbol, row);
    }
    return map;
  }, [opportunityRanking]);
  const waitByOpportunityId = opps?.waitIntelligenceById ?? {};
  const thesisByOpportunityId = opps?.thesisIntelligenceById ?? {};
  const approvable = useMemo(() => opportunities.filter(isApprovable), [opportunities]);
  const approvableIds = useMemo(
    () => approvable.map((row) => row.recommendationId!).filter(Boolean),
    [approvable],
  );

  const selectedApprovable = useMemo(
    () =>
      approvable.filter(
        (row) => row.recommendationId != null && selectedIds.has(row.recommendationId),
      ),
    [approvable, selectedIds],
  );

  const allSelected = approvableIds.length > 0 && approvableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedApprovable.length > 0 && !allSelected;

  const approvalsBlocked =
    !tradingOn || mode === 'RESEARCH' || Boolean(modeData?.killSwitch) || bulkBusy;

  const approveBlockReason = !tradingOn
    ? 'Turn on Enable AI agent trading above'
    : mode === 'RESEARCH'
      ? 'Switch mode from Research to Paper (or Live)'
      : modeData?.killSwitch
        ? 'Clear the kill switch first'
        : bulkBusy
          ? 'Bulk approve in progress…'
          : null;

  const cash = Number(portfolio?.cash ?? 0);
  const cheapestEntry = Math.min(
    ...approvable.map((row) => Number(row.setup.entry) || Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );
  const cashTooLow =
    approvable.length > 0 && Number.isFinite(cheapestEntry) && cash < cheapestEntry;

  const toTargets = (rows: OpportunityRow[]): ApproveTarget[] =>
    rows.filter(isApprovable).map((row) => ({
      id: row.recommendationId!,
      symbol: row.symbol,
      suggestedQty: suggestedQty(row),
      entry: Number(row.setup.entry),
    }));

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (approvableIds.length === 0) return prev;
      if (approvableIds.every((id) => prev.has(id))) return new Set();
      return new Set(approvableIds);
    });
  };

  const runBulkApprove = async (targets: ApproveTarget[]) => {
    if (targets.length === 0) return;
    if (!tradingOn) {
      setToastSeverity('error');
      setToast('Enable AI agent trading first, then approve.');
      return;
    }
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: targets.length });
    let ok = 0;
    let skippedCash = 0;
    const failures: string[] = [];
    // Split remaining cash across the batch so the first name cannot take the whole book.
    let cashLeft = portfolio?.cash ?? 0;
    const { data: freshPortfolio } = await refetchPortfolio();
    if (freshPortfolio?.cash != null) cashLeft = freshPortfolio.cash;

    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      const remainingNames = targets.length - i;
      const budget = cashLeft / Math.max(remainingNames, 1);
      const maxByBudget = target.entry > 0 ? Math.floor(budget / target.entry) : 0;
      const maxByCash = target.entry > 0 ? Math.floor(cashLeft / target.entry) : 0;
      const quantity = Math.max(0, Math.min(target.suggestedQty, maxByBudget, maxByCash));
      if (quantity < 1) {
        skippedCash += 1;
        failures.push(`${target.symbol}: insufficient cash (₹${cashLeft.toFixed(0)} left)`);
        setBulkProgress({ done: i + 1, total: targets.length });
        continue;
      }
      try {
        await approve({ id: target.id, quantity }).unwrap();
        ok += 1;
        cashLeft = Math.max(0, cashLeft - quantity * target.entry);
      } catch (error) {
        failures.push(`${target.symbol}: ${authErrorMessage(error, 'approve failed')}`);
      }
      setBulkProgress({ done: i + 1, total: targets.length });
    }
    setBulkBusy(false);
    setBulkProgress(null);
    setBulkTargets(null);
    setSelectedIds(new Set());
    await Promise.all([refetchOpps(), refetchPositions(), refetchPortfolio(), refetchTx()]);
    if (ok > 0) setOppsTab('added');
    if (failures.length === 0) {
      setToastSeverity('success');
      setToast(`Filled ${ok}/${targets.length} buys — lots refreshed`);
    } else {
      setToastSeverity(ok > 0 ? 'info' : 'error');
      setToast(
        `Filled ${ok}/${targets.length}${skippedCash ? ` (${skippedCash} skipped — no cash)` : ''}. ${failures.slice(0, 2).join(' · ')}${
          failures.length > 2 ? '…' : ''
        }`,
      );
    }
  };

  return (
    <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        Trader Agent
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Professional trading desk — investigates existing app data, proposes setups, manages paper
        exits. LIVE uses the same path after explicit arming. {modeData?.disclaimer}
      </Typography>

      <AgentTradingToggle />

      {riskBudgets && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 2 }}
          alignItems="center"
        >
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            Risk budgets (read-only)
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={`Per-trade ${riskBudgets.perTradeRiskPercent}%`}
          />
          <Chip size="small" variant="outlined" label={`Max pos ${riskBudgets.maxOpenPositions}`} />
          <Chip size="small" variant="outlined" label={`Name ${riskBudgets.maxNameExposurePct}%`} />
          <Chip
            size="small"
            variant="outlined"
            label={`Sector ${riskBudgets.maxSectorExposurePct}%`}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`Cash reserve ${riskBudgets.cashReservePct}%`}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`Max price Δ ${riskBudgets.maxPriceDeviationPct}%`}
          />
        </Stack>
      )}

      {walkForwardData?.report && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Agent walk-forward (read-only)
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Chip
              size="small"
              color={walkForwardData.report.verdict.technical === 'PASS' ? 'success' : 'error'}
              label={`Technical ${walkForwardData.report.verdict.technical}`}
            />
            <Chip
              size="small"
              color={
                walkForwardData.report.verdict.trading === 'FAIL'
                  ? 'error'
                  : walkForwardData.report.verdict.trading === 'STRONG'
                    ? 'success'
                    : 'default'
              }
              label={`Trading ${walkForwardData.report.verdict.trading}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Gross ₹${Math.round(walkForwardData.report.grossPerformance.grossPnl).toLocaleString('en-IN')}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Net ₹${Math.round(walkForwardData.report.netPerformance.netPnl).toLocaleString('en-IN')}`}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            Funnel: {walkForwardData.report.funnel.candidates} candidates →{' '}
            {walkForwardData.report.funnel.autonomousEligible} eligible →{' '}
            {walkForwardData.report.funnel.autoAccepted} auto →{' '}
            {walkForwardData.report.funnel.filled} filled
            {walkForwardData.report.funnel.gateBlocked > 0
              ? ` · ${walkForwardData.report.funnel.gateBlocked} gate-blocked`
              : ''}
          </Typography>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            PAPER soak
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="contained"
              disabled={
                mode !== 'PAPER' ||
                soakData?.soak?.state === 'RUNNING' ||
                startSoakState.isLoading ||
                !tradingOn
              }
              onClick={async () => {
                try {
                  await startSoak({ targetDurationMs: 24 * 60 * 60 * 1000 }).unwrap();
                  await refetchSoak();
                  setToastSeverity('success');
                  setToast('Soak started (PAPER)');
                } catch (error) {
                  setToastSeverity('error');
                  setToast(authErrorMessage(error, 'Could not start soak'));
                }
              }}
            >
              Start
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={soakData?.soak?.state !== 'RUNNING' || stopSoakState.isLoading}
              onClick={async () => {
                try {
                  await stopSoak().unwrap();
                  await refetchSoak();
                  setToastSeverity('info');
                  setToast('Soak stopped');
                } catch (error) {
                  setToastSeverity('error');
                  setToast(authErrorMessage(error, 'Could not stop soak'));
                }
              }}
            >
              Stop
            </Button>
            <Button
              size="small"
              color="warning"
              variant="outlined"
              disabled={soakData?.soak?.state !== 'RUNNING' || waiveSoakState.isLoading}
              onClick={async () => {
                try {
                  await waiveSoak({ reason: 'Operator waive from desk' }).unwrap();
                  await refetchSoak();
                  setToastSeverity('info');
                  setToast('Soak waived');
                } catch (error) {
                  setToastSeverity('error');
                  setToast(authErrorMessage(error, 'Could not waive soak'));
                }
              }}
            >
              Waive
            </Button>
          </Stack>
        </Stack>
        {soakData?.soak ? (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Chip
                size="small"
                color={
                  soakData.soak.state === 'RUNNING'
                    ? 'info'
                    : soakData.soak.state === 'PASSED'
                      ? 'success'
                      : soakData.soak.state === 'KILLED'
                        ? 'error'
                        : 'default'
                }
                label={soakData.soak.state}
              />
              <Chip size="small" variant="outlined" label={soakData.soak.soakRunId} />
              <Chip
                size="small"
                variant="outlined"
                label={
                  soakData.soak.state === 'RUNNING'
                    ? `${fmtDuration(Date.now() - soakData.soak.startedAt)} / ${fmtDuration(soakData.soak.targetDurationMs)}`
                    : `Ended · target ${fmtDuration(soakData.soak.targetDurationMs)}`
                }
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Baseline ₹${Math.round(soakData.soak.baseline.equity).toLocaleString('en-IN')}`}
              />
            </Stack>
            {soakData.soak.killCode ? (
              <Alert severity="error" sx={{ mb: 1 }}>
                Kill {soakData.soak.killClass}/{soakData.soak.killCode}:{' '}
                {soakData.soak.killReason || '—'}
              </Alert>
            ) : null}
            {soakData.soak.waiveReason ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Waive: {soakData.soak.waiveReason}
              </Typography>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No active soak. Start only in PAPER with trading enabled. Soak can stop autonomy; it
            never authorizes trades.
          </Typography>
        )}
        {soakReport ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            PHASE_4_STATUS={soakReport.phase4Status} · net ₹
            {Math.round(soakReport.performance.netPnl).toLocaleString('en-IN')} · outcomes{' '}
            {soakReport.technicalChecklist.outcomesComplete ? 'complete' : 'incomplete'}
          </Alert>
        ) : null}

        {opsData ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Ops
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Chip size="small" label={`${fmtNum(opsData.acceptsPerDay, 1)} accepts/day`} />
              <Chip
                size="small"
                label={`Veto ${
                  opsData.candidates > 0
                    ? fmtPct(
                        (opsData.riskVeto + opsData.portfolioVeto + opsData.gateVeto) /
                          opsData.candidates,
                      )
                    : '—'
                }`}
              />
              <Chip size="small" label={`Circuits ${opsData.circuitTrips}`} />
              <Chip size="small" label={`Avg hold ${fmtMs(opsData.avgHoldMs)}`} />
              <Chip
                size="small"
                label={`AUTO gross ₹${Math.round(opsData.autoGrossPnl).toLocaleString('en-IN')}`}
              />
              <Chip
                size="small"
                label={`AUTO net ₹${Math.round(opsData.autoNetPnl).toLocaleString('en-IN')}`}
              />
              <Chip size="small" label={`Avg R ${fmtNum(opsData.avgR)}`} />
              <Chip size="small" label={`Median R ${fmtNum(opsData.medianR)}`} />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Funnel
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {opsData.candidates} candidates → {opsData.eligible} eligible → {opsData.riskVeto}{' '}
              risk blocked → {opsData.portfolioVeto} portfolio blocked → {opsData.gateVeto} gate
              blocked → {opsData.accepted} accepted → {opsData.filled} filled
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Latency
            </Typography>
            <Typography variant="body2">
              signal→decision {fmtMs(opsData.latency.signalToDecisionMs)} · decision→submit{' '}
              {fmtMs(opsData.latency.decisionToSubmitMs)} · submit→fill{' '}
              {fmtMs(opsData.latency.submitToFillMs)}
            </Typography>
          </Box>
        ) : null}

        {calibrationData ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Calibration by score
            </Typography>
            <Alert severity="warning" sx={{ mb: 1, py: 0.5 }}>
              Confidence ≠ calibrated probability. {calibrationData.disclaimer}
            </Alert>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Band</TableCell>
                    <TableCell align="right">N</TableCell>
                    <TableCell align="right">Hit</TableCell>
                    <TableCell align="right">Avg R</TableCell>
                    <TableCell align="right">Med R</TableCell>
                    <TableCell align="right">PF</TableCell>
                    <TableCell align="right">Avg P&L%</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(calibrationData.byScore ?? []).map((row) => (
                    <TableRow key={row.band}>
                      <TableCell>{row.band}</TableCell>
                      <TableCell align="right">{row.n}</TableCell>
                      <TableCell align="right">{fmtPct(row.hitRate)}</TableCell>
                      <TableCell align="right">{fmtNum(row.avgR)}</TableCell>
                      <TableCell align="right">{fmtNum(row.medianR)}</TableCell>
                      <TableCell align="right">{fmtNum(row.profitFactor)}</TableCell>
                      <TableCell align="right">{fmtNum(row.avgPnlPercent)}</TableCell>
                    </TableRow>
                  ))}
                  {(calibrationData.byScore?.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography variant="caption" color="text.secondary">
                          No closed outcomes in this soak yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ) : null}

        {compareData?.rows?.length ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              P3 walk-forward vs P4 soak
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Metric</TableCell>
                    <TableCell align="right">Walk-forward</TableCell>
                    <TableCell align="right">Paper soak</TableCell>
                    <TableCell align="right">Δ</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {compareData.rows.map((row) => (
                    <TableRow key={row.metric}>
                      <TableCell>{row.metric}</TableCell>
                      <TableCell align="right">{fmtNum(row.walkForward, 3)}</TableCell>
                      <TableCell align="right">{fmtNum(row.paperSoak, 3)}</TableCell>
                      <TableCell align="right">{fmtNum(row.delta, 3)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ) : null}
      </Paper>

      <AgentSuggestionCards
        onToast={(message) => {
          setToastSeverity('info');
          setToast(message);
        }}
      />

      {!tradingOn && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Turn on <b>Enable AI agent trading</b> first. Approvals stay blocked until that switch is
          on.
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ mb: 2, opacity: tradingOn ? 1 : 0.45 }}
        flexWrap="wrap"
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          disabled={!tradingOn}
          value={mode}
          onChange={async (_e, value: 'RESEARCH' | 'PAPER' | 'LIVE' | null) => {
            if (!value) return;
            try {
              if (value === 'LIVE') {
                await setMode({ mode: 'LIVE', confirmLive: 'ARM LIVE' }).unwrap();
              } else {
                await setMode({ mode: value }).unwrap();
              }
              await refetchMode();
              setToastSeverity('info');
              setToast(`Mode set to ${value}`);
            } catch (error) {
              setToastSeverity('error');
              setToast(authErrorMessage(error, 'Could not change mode'));
            }
          }}
        >
          <ToggleButton value="RESEARCH">Research</ToggleButton>
          <ToggleButton value="PAPER">Paper</ToggleButton>
          <ToggleButton value="LIVE" color="error">
            Live
          </ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup
          exclusive
          size="small"
          disabled={!tradingOn}
          value={decisionMode}
          onChange={async (_e, value: 'APPROVAL' | 'AUTONOMOUS' | null) => {
            if (!value) return;
            try {
              await setDecisionMode({ decisionMode: value }).unwrap();
              await refetchMode();
              setToastSeverity('info');
              setToast(
                value === 'AUTONOMOUS'
                  ? 'Autonomous on (PAPER only) — risk + portfolio + policy must still pass'
                  : 'Approval required for each trade',
              );
            } catch (error) {
              setToastSeverity('error');
              setToast(authErrorMessage(error, 'Could not change decision mode'));
            }
          }}
        >
          <ToggleButton value="APPROVAL">Approval</ToggleButton>
          <ToggleButton value="AUTONOMOUS" color="warning">
            Autonomous
          </ToggleButton>
        </ToggleButtonGroup>
        <Button
          size="small"
          color={modeData?.killSwitch ? 'success' : 'error'}
          variant="outlined"
          disabled={!tradingOn}
          onClick={async () => {
            try {
              await setKill({ enabled: !modeData?.killSwitch }).unwrap();
              await refetchMode();
            } catch (error) {
              setToastSeverity('error');
              setToast(authErrorMessage(error, 'Could not update kill switch'));
            }
          }}
        >
          {modeData?.killSwitch ? 'Clear kill switch' : 'Kill switch'}
        </Button>
        <Button
          size="small"
          color={modeData?.liveAutoEffective ? 'warning' : 'inherit'}
          variant={modeData?.liveAutoArmed ? 'contained' : 'outlined'}
          disabled={!tradingOn || modeData?.killSwitch}
          onClick={async () => {
            try {
              if (modeData?.liveAutoArmed) {
                await setLiveAutoArm({ armed: false }).unwrap();
                setToastSeverity('info');
                setToast('LIVE AUTONOMOUS disarmed — LIVE stays HUMAN_REQUIRED');
              } else {
                await setLiveAutoArm({
                  armed: true,
                  confirmLiveAuto: 'ARM LIVE AUTONOMOUS',
                }).unwrap();
                setToastSeverity('info');
                setToast('LIVE AUTONOMOUS armed (requires P5 Evidence GO to be effective)');
              }
              await refetchMode();
            } catch (error) {
              setToastSeverity('error');
              setToast(
                authErrorMessage(
                  error,
                  'Could not ARM/DISARM LIVE AUTONOMOUS (evidence GO required to arm)',
                ),
              );
            }
          }}
        >
          {modeData?.liveAutoArmed ? 'DISARM LIVE AUTONOMOUS' : 'ARM LIVE AUTONOMOUS'}
        </Button>
        {modeData?.evidenceUnlock && !modeData.evidenceUnlock.unlocked ? (
          <Chip
            size="small"
            color="default"
            label={`P5 evidence ${modeData.evidenceUnlock.overallDecision} — auto ARM blocked`}
          />
        ) : null}
        {modeData?.liveAutoEffective ? (
          <Chip size="small" color="warning" label="LIVE AUTONOMOUS effective" />
        ) : null}
        {modeData?.breakers?.tripped ? (
          <Chip
            size="small"
            color="error"
            label={`Breakers tripped: ${(modeData.breakers.reasonCodes ?? []).slice(0, 3).join(', ') || 'STOP'}`}
            title={(modeData.breakers.reasons ?? []).join(' · ')}
          />
        ) : (
          <Chip size="small" color="default" variant="outlined" label="Breakers clear" />
        )}
        {modeData?.scale ? (
          <Chip
            size="small"
            variant="outlined"
            label={`Scale scan ${modeData.scale.maxSymbolsScanned} / auto ${modeData.scale.maxAutonomousAcceptsPerCycle} / workers ${modeData.scale.analysisConcurrency}`}
          />
        ) : null}
        <Button size="small" variant="outlined" onClick={() => refetchOpps()} disabled={isFetching}>
          Refresh opportunities
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            setDecisionLookupId(undefined);
            setDecisionDrawerOpen(true);
            void refetchDecisions();
          }}
        >
          View decisions
        </Button>
        {decisionMode === 'AUTONOMOUS' && mode === 'PAPER' && tradingOn ? (
          <Chip size="small" color="warning" label="PAPER autonomous — eligibility ≠ auto-buy" />
        ) : null}
        {modeData?.liveArming?.blockers?.length ? (
          <Chip
            size="small"
            color="warning"
            label={`LIVE blockers: ${modeData.liveArming.blockers.join(' · ')}`}
          />
        ) : null}
      </Stack>

      {toast && (
        <Alert severity={toastSeverity} sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Analyze symbol…"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <Button
          component={RouterLink}
          to={symbol ? `/stocks/${symbol}` : '/'}
          variant="outlined"
          disabled={!symbol}
        >
          Open chart
        </Button>
      </Stack>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Opportunities
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Paper cash ₹{cash.toLocaleString('en-IN')} ·{' '}
            {positions?.positions?.length ?? portfolio?.openPositions ?? 0} open lot(s). Approve-all
            splits cash across the batch (max ~5% per name).
          </Typography>
          {approveBlockReason && oppsTab === 'new' && (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.25 }}>
              Approve disabled — {approveBlockReason}.
            </Typography>
          )}
          {!approveBlockReason && cashTooLow && oppsTab === 'new' && (
            <Typography variant="caption" color="error.main" display="block" sx={{ mt: 0.25 }}>
              Cash is too low to buy any listed name (need ≥ ₹
              {cheapestEntry.toLocaleString('en-IN')}
              ). Sell lots or reset paper capital first.
            </Typography>
          )}
        </Box>
        {oppsTab === 'new' && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="outlined"
              disabled={approvalsBlocked || selectedApprovable.length === 0}
              title={approveBlockReason ?? undefined}
              onClick={() => setBulkTargets(toTargets(selectedApprovable))}
            >
              Approve selected ({selectedApprovable.length})
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={approvalsBlocked || approvable.length === 0}
              title={approveBlockReason ?? undefined}
              onClick={() => setBulkTargets(toTargets(approvable))}
            >
              Approve all ({approvable.length})
            </Button>
          </Stack>
        )}
      </Stack>

      <Tabs
        value={oppsTab}
        onChange={(_, value: 'new' | 'added') => setOppsTab(value)}
        sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="new" label={`New (${opportunities.length})`} />
        <Tab value="added" label={`Added (${added.length})`} />
      </Tabs>

      {bulkProgress && oppsTab === 'new' && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Approving {bulkProgress.done}/{bulkProgress.total}…
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100}
            sx={{ mt: 0.5 }}
          />
        </Box>
      )}

      {oppsTab === 'new' && opportunityRanking ? (
        <Paper variant="outlined" sx={{ mb: 2, p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Attention shortlist
            {opportunityRanking.noClearWinner ? ' — no clear winner under current context' : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {opportunityRanking.context.tradeHorizon}
            {opportunityRanking.context.strategyTag
              ? ` · ${opportunityRanking.context.strategyTag}`
              : ''}{' '}
            · lexicographic precedence (not a RankingScore) · advisory only
          </Typography>
          <Stack spacing={1}>
            {opportunityRanking.rankings.slice(0, 5).map((r) => {
              const above = r.pairwiseReasons.find((p) => p.polarity === 'ABOVE');
              const whyAbove = above?.evidence[0]?.message;
              const concern = r.weaknesses[0]?.message;
              return (
                <Box key={r.opportunityId}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      #{r.rank} {r.symbol}
                    </Typography>
                    <Chip size="small" label={r.dominance} variant="outlined" />
                    {r.stale ? <Chip size="small" color="warning" label="STALE" /> : null}
                    {r.dataCompleteness !== 'COMPLETE' ? (
                      <Chip size="small" color="warning" label={r.dataCompleteness} />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {whyAbove
                      ? `vs ${above!.peerSymbol}: ${whyAbove}`
                      : (r.strengths[0]?.message ?? 'Context-scoped attention only')}
                    {concern ? ` · concern: ${concern}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      ) : null}

      {oppsTab === 'new' ? (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={someSelected}
                    checked={allSelected}
                    disabled={approvableIds.length === 0 || bulkBusy}
                    onChange={toggleSelectAll}
                    inputProps={{ 'aria-label': 'Select all approvable buys' }}
                  />
                </TableCell>
                <TableCell>Symbol</TableCell>
                <TableCell>Decision</TableCell>
                <TableCell>Attention</TableCell>
                <TableCell align="right">Score</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Thesis</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {opportunities.map((row) => {
                const canApprove = isApprovable(row);
                const id = row.recommendationId;
                const rankRow = rankingBySymbol.get(row.symbol);
                return (
                  <TableRow key={`${row.symbol}-${row.recommendationId ?? row.symbol}`}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        disabled={!canApprove || bulkBusy}
                        checked={Boolean(id && selectedIds.has(id))}
                        onChange={() => id && toggleSelected(id)}
                        inputProps={{ 'aria-label': `Select ${row.symbol}` }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        component={RouterLink}
                        to={`/stocks/${row.symbol}`}
                        sx={{ fontWeight: 700, textDecoration: 'none' }}
                      >
                        {row.symbol}
                      </Typography>
                      {row.missingCapabilities?.length ? (
                        <Typography variant="caption" display="block" color="warning.main">
                          missing {row.missingCapabilities.join(', ')}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={row.decision.replaceAll('_', ' ')} />
                    </TableCell>
                    <TableCell>
                      {rankRow ? (
                        <Typography variant="caption" display="block">
                          #{rankRow.rank} · {rankRow.dominance}
                          {rankRow.stale ? ' · STALE' : ''}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{row.scores.overall}</TableCell>
                    <TableCell align="right">
                      {row.setup.positionSize > 0
                        ? row.setup.positionSize
                        : isApprovable(row)
                          ? '1*'
                          : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{row.thesis}</Typography>
                      {row.recommendationId && waitByOpportunityId[row.recommendationId] ? (
                        <WaitIntelligencePanel wait={waitByOpportunityId[row.recommendationId]} />
                      ) : null}
                      {row.recommendationId && thesisByOpportunityId[row.recommendationId] ? (
                        <ThesisIntelligencePanel
                          thesis={thesisByOpportunityId[row.recommendationId]}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Button
                          size="small"
                          variant="contained"
                          disabled={approvalsBlocked || !canApprove || approveState.isLoading}
                          title={approveBlockReason ?? undefined}
                          onClick={() => {
                            if (!tradingOn) {
                              setToastSeverity('error');
                              setToast('Enable AI agent trading first, then approve.');
                              return;
                            }
                            if (!row.recommendationId) return;
                            const suggested = suggestedQty(row);
                            setApproveTarget({
                              id: row.recommendationId,
                              symbol: row.symbol,
                              suggestedQty: suggested,
                              entry: Number(row.setup.entry),
                            });
                            setApproveQty(String(suggested));
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!row.recommendationId || waitState.isLoading}
                          onClick={() => {
                            if (!row.recommendationId) return;
                            void wait({
                              id: row.recommendationId,
                              reason: 'WAIT_FOR_CONFIRMATION',
                            })
                              .unwrap()
                              .then(() => {
                                setToastSeverity('success');
                                setToast(`Waiting on ${row.symbol}`);
                              })
                              .catch((error: unknown) => {
                                setToastSeverity('error');
                                setToast(authErrorMessage(error, 'Wait failed'));
                              });
                          }}
                        >
                          Wait
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={!row.recommendationId || rejectState.isLoading}
                          onClick={() => {
                            if (!row.recommendationId) return;
                            void reject({
                              id: row.recommendationId,
                              reason: 'HUMAN_REJECT',
                            })
                              .unwrap()
                              .then(() => {
                                setToastSeverity('success');
                                setToast(`Rejected ${row.symbol}`);
                              })
                              .catch((error: unknown) => {
                                setToastSeverity('error');
                                setToast(authErrorMessage(error, 'Reject failed'));
                              });
                          }}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {opportunities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No new opportunities. Approved names move to Added; refresh after market data
                      is up.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>Decision</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Entry</TableCell>
                <TableCell align="right">Score</TableCell>
                <TableCell>Approved</TableCell>
                <TableCell>Thesis</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {added.map((row) => (
                <TableRow key={`${row.symbol}-${row.recommendationId ?? row.executedAt}`}>
                  <TableCell>
                    <Typography
                      component={RouterLink}
                      to={`/stocks/${row.symbol}`}
                      sx={{ fontWeight: 700, textDecoration: 'none' }}
                    >
                      {row.symbol}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color="success" label="APPROVED" />
                  </TableCell>
                  <TableCell align="right">{row.quantity}</TableCell>
                  <TableCell align="right">
                    {row.setup.entry != null
                      ? `₹${Number(row.setup.entry).toLocaleString('en-IN')}`
                      : '—'}
                  </TableCell>
                  <TableCell align="right">{row.scores.overall}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(row.executedAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{row.thesis}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {added.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      Nothing added yet. Approve a suggestion under New to see it here.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Stack
        direction="row"
        alignItems="baseline"
        spacing={1}
        sx={{ mb: 1 }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="subtitle1" fontWeight={600}>
          Monitored paper lots ({positions?.positions?.length ?? 0})
        </Typography>
        <Chip
          size="small"
          color={positions?.agentTradingEnabled || tradingOn ? 'success' : 'default'}
          label={
            positions?.agentTradingEnabled || tradingOn
              ? 'Exit mode: agent policy'
              : 'Exit mode: classic stop/target'
          }
        />
        {positions?.killSwitch && <Chip size="small" color="error" label="Kill switch" />}
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Every open paper lot auto-trader is watching on market ticks (all user books + system book).
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell>Book</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Entry</TableCell>
              <TableCell align="right">Last</TableCell>
              <TableCell align="right">Stop</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell>Monitoring</TableCell>
              <TableCell align="right">uPnL</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(positions?.positions ?? []).map((lot) => (
              <TableRow key={`${lot.bookKey ?? 'sys'}-${lot.symbol}`}>
                <TableCell>
                  <Typography
                    component={RouterLink}
                    to={`/stocks/${lot.symbol}`}
                    variant="body2"
                    fontWeight={600}
                    sx={{ color: 'primary.main', textDecoration: 'none' }}
                  >
                    {lot.symbol}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {lot.userId ? `user ${lot.userId.slice(0, 8)}…` : 'system'}
                  </Typography>
                </TableCell>
                <TableCell align="right">{lot.quantity}</TableCell>
                <TableCell align="right">{lot.entryPrice}</TableCell>
                <TableCell align="right">{lot.currentPrice}</TableCell>
                <TableCell align="right">{lot.stopLoss}</TableCell>
                <TableCell align="right">{lot.target}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={lot.exitMode === 'AGENT_POLICY' ? 'success' : 'default'}
                    label={lot.exitMode === 'AGENT_POLICY' ? 'Agent policy' : 'Stop/target'}
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    {lot.policyNote}
                  </Typography>
                  {lot.exitIntelligence ? (
                    <ExitIntelligencePanel exit={lot.exitIntelligence} />
                  ) : null}
                </TableCell>
                <TableCell align="right">{lot.unrealizedPnl}</TableCell>
              </TableRow>
            ))}
            {(positions?.positions ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Box sx={{ py: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      No open paper lots to monitor. Approve a BUY here or open lots from Paper
                      book.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 3, mb: 0.5 }}>
        Transaction audit ({txAudit?.transactions?.length ?? 0})
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Your agent buys and sells with fill price and why each side was taken (thesis on buy, exit
        policy on sell).
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Symbol</TableCell>
              <TableCell>Side</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">PnL</TableCell>
              <TableCell>Why</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(txAudit?.transactions ?? []).map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(tx.timestamp).toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography
                    component={RouterLink}
                    to={`/stocks/${tx.symbol}`}
                    variant="body2"
                    fontWeight={700}
                    sx={{ textDecoration: 'none' }}
                  >
                    {tx.symbol}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={tx.side === 'BUY' ? 'success' : 'warning'}
                    label={tx.side}
                  />
                </TableCell>
                <TableCell align="right">{tx.quantity}</TableCell>
                <TableCell align="right">
                  ₹{Number(tx.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell align="right">
                  {tx.pnl == null
                    ? '—'
                    : `${tx.pnl >= 0 ? '+' : ''}₹${Number(tx.pnl).toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}`}
                </TableCell>
                <TableCell sx={{ maxWidth: 420 }}>
                  <Typography variant="caption" fontWeight={600} display="block">
                    {tx.reason}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {tx.explanation}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
            {(txAudit?.transactions ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No agent transactions yet for this user. Approve a suggestion to open the audit
                    trail.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={Boolean(approveTarget)}
        onClose={() => !approveState.isLoading && setApproveTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Approve buy {approveTarget?.symbol}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Suggested size is {approveTarget?.suggestedQty ?? 1} shares. Edit quantity before
              confirming.
            </Typography>
            <TextField
              autoFocus
              label="Quantity"
              type="number"
              size="small"
              value={approveQty}
              onChange={(e) => setApproveQty(e.target.value)}
              inputProps={{ min: 1, step: 1 }}
              error={!approveQtyValid}
              helperText={!approveQtyValid ? 'Enter at least 1 share' : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveTarget(null)} disabled={approveState.isLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={approveState.isLoading || !approveQtyValid || !approveTarget || !tradingOn}
            onClick={async () => {
              if (!approveTarget) return;
              if (!tradingOn) {
                setToastSeverity('error');
                setToast('Enable AI agent trading first, then approve.');
                return;
              }
              try {
                await approve({ id: approveTarget.id, quantity: parsedApproveQty }).unwrap();
                setToastSeverity('success');
                setToast(`Approved buy ${parsedApproveQty} ${approveTarget.symbol}`);
                setApproveTarget(null);
                setOppsTab('added');
                await Promise.all([refetchOpps(), refetchPositions(), refetchTx()]);
              } catch (error) {
                setToastSeverity('error');
                setToast(authErrorMessage(error, 'Approve failed'));
              }
            }}
          >
            {approveState.isLoading ? 'Buying…' : `Buy ${parsedApproveQty}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(bulkTargets)}
        onClose={() => !bulkBusy && setBulkTargets(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Approve {bulkTargets?.length ?? 0} buy{(bulkTargets?.length ?? 0) === 1 ? '' : 's'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Qty is capped so remaining cash is shared across this batch (first names cannot take the
            whole book). Current cash ≈ ₹{Number(portfolio?.cash ?? 0).toLocaleString('en-IN')}.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell align="right">Entry</TableCell>
                <TableCell align="right">Suggested qty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(bulkTargets ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.symbol}</TableCell>
                  <TableCell align="right">{row.entry}</TableCell>
                  <TableCell align="right">{row.suggestedQty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {bulkProgress && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress
                variant="determinate"
                value={(bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkTargets(null)} disabled={bulkBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={bulkBusy || !bulkTargets?.length || !tradingOn}
            onClick={() => bulkTargets && void runBulkApprove(bulkTargets)}
          >
            {bulkBusy ? 'Approving…' : `Confirm ${bulkTargets?.length ?? 0}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={decisionDrawerOpen}
        onClose={() => setDecisionDrawerOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Decision ledger
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            What was seen, thought, allowed, and what happened. Score ≥ 75 means eligible only —
            never auto-buy by itself.
          </Typography>
          <Stack spacing={1.5}>
            {(decisionsData?.decisions ?? []).map(({ decision: row, lifecycleSnapshot }) => (
              <Paper key={`${row.decisionId}-${row.timestamp}`} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography fontWeight={700}>{row.symbol}</Typography>
                  <Chip size="small" label={row.decision} />
                  <Chip size="small" variant="outlined" label={row.state} />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block">
                  {new Date(row.timestamp).toLocaleString()} · {row.decisionMode} · score{' '}
                  {row.analysisSnapshot?.score ?? '—'} · {row.analysisSnapshot?.eligibility ?? '—'}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.75 }}>
                  {row.analysisSnapshot?.thesis || row.decisionReasons?.[0] || '—'}
                </Typography>
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                  Reasons: {(row.reasonCodes ?? []).slice(0, 6).join(', ') || '—'}
                </Typography>
                {row.budgetSnapshot ? (
                  <Typography
                    variant="caption"
                    display="block"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Budget: day ₹
                    {Math.round(row.budgetSnapshot.dayStartEquity).toLocaleString('en-IN')} · week ₹
                    {Math.round(row.budgetSnapshot.weekStartEquity).toLocaleString('en-IN')} · risk{' '}
                    {row.budgetSnapshot.perTradeRiskPercent}% · qty{' '}
                    {row.budgetSnapshot.quantityBeforeConfidence}→
                    {row.budgetSnapshot.quantityAfterConfidence}
                    {row.budgetSnapshot.symbolSector ? ` · ${row.budgetSnapshot.symbolSector}` : ''}
                  </Typography>
                ) : null}
                {row.execution ? (
                  <Typography variant="caption" display="block" color="success.main">
                    Executed qty {row.execution.quantity}
                    {row.execution.entryPrice != null ? ` @ ₹${row.execution.entryPrice}` : ''}
                  </Typography>
                ) : null}
                {row.outcome ? (
                  <Typography
                    variant="caption"
                    display="block"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Outcome: R {fmtNum(row.outcome.realizedR)} · P&L ₹
                    {Math.round(row.outcome.pnl).toLocaleString('en-IN')} (
                    {fmtNum(row.outcome.pnlPercent)}%) · {row.outcome.exitReason} @ ₹
                    {row.outcome.exitPrice}
                  </Typography>
                ) : null}
                {row.intelligenceSnapshot ? (
                  <Box
                    sx={{
                      mt: 1,
                      p: 1,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                    }}
                  >
                    <Typography variant="caption" fontWeight={700} display="block">
                      Intelligence (human-validate)
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Informs Approve / Reject / Wait — never auto-fires LIVE. Not an input to Risk
                      / Portfolio / Policy / Gate.
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      {row.intelligenceSnapshot.strategyTag ?? 'UNKNOWN'}
                      {row.intelligenceSnapshot.marketContext?.regimeCombo
                        ? ` · ${row.intelligenceSnapshot.marketContext.regimeCombo}`
                        : ''}
                      {row.intelligenceSnapshot.tradeQuality?.overallScore != null
                        ? ` · quality ${fmtNum(row.intelligenceSnapshot.tradeQuality.overallScore, 1)}`
                        : ''}
                      {row.intelligenceSnapshot.expectedValue?.expectedValueR != null
                        ? ` · EV ${fmtNum(row.intelligenceSnapshot.expectedValue.expectedValueR)} R`
                        : ''}
                      {row.intelligenceSnapshot.expectedValue?.probabilitySource
                        ? ` · ${row.intelligenceSnapshot.expectedValue.probabilitySource}`
                        : ''}
                      {row.intelligenceSnapshot.expectedValue?.expectedValueMethod
                        ? ` · ${row.intelligenceSnapshot.expectedValue.expectedValueMethod}`
                        : ''}
                      {row.intelligenceSnapshot.crossSectionalRs?.rsBucket
                        ? ` · RS ${row.intelligenceSnapshot.crossSectionalRs.rsBucket}`
                        : ''}
                      {row.intelligenceSnapshot.sectorIntelligence?.sectorFit
                        ? ` · sector ${row.intelligenceSnapshot.sectorIntelligence.sectorFit}`
                        : ''}
                      {row.intelligenceSnapshot.marketContext?.sectorTrend &&
                      row.intelligenceSnapshot.marketContext.sectorTrend !== 'UNKNOWN'
                        ? ` · ${row.intelligenceSnapshot.marketContext.sectorTrend}`
                        : ''}
                      {row.intelligenceSnapshot.multiHorizonAgreement
                        ? ` · MH ${row.intelligenceSnapshot.multiHorizonAgreement.tradeHorizon} ${row.intelligenceSnapshot.multiHorizonAgreement.agreement}`
                        : ''}
                      {row.intelligenceSnapshot.regimeCompatibility
                        ? ` · regime ${row.intelligenceSnapshot.regimeCompatibility.compatibility}`
                        : ''}
                      {row.intelligenceSnapshot.catalystContext
                        ? ` · eventRisk ${row.intelligenceSnapshot.catalystContext.eventRisk}`
                        : ''}
                    </Typography>
                    {row.intelligenceSnapshot.catalystContext?.events?.length ? (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {row.intelligenceSnapshot.catalystContext.events
                          .slice(0, 3)
                          .map((e) => {
                            const prox =
                              e.sessionsUntil != null && e.proximity !== 'PAST'
                                ? ` in ${e.sessionsUntil}s`
                                : e.proximity === 'PAST'
                                  ? ' (past)'
                                  : '';
                            return `${e.type}${prox} · ${e.direction}`;
                          })
                          .join(' · ')}
                        {` · thesis ${row.intelligenceSnapshot.catalystContext.thesisInteraction}`}
                      </Typography>
                    ) : null}
                    {row.intelligenceSnapshot.regimeCompatibility?.dimensions ? (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {`trend ${row.intelligenceSnapshot.regimeCompatibility.dimensions.trend}`}
                        {` · vol ${row.intelligenceSnapshot.regimeCompatibility.dimensions.volatility}`}
                        {` · breadth ${row.intelligenceSnapshot.regimeCompatibility.dimensions.breadth}`}
                        {` · liq ${row.intelligenceSnapshot.regimeCompatibility.dimensions.liquidity}`}
                        {row.intelligenceSnapshot.regimeCompatibility.dimensions.indexStructure !==
                        'UNKNOWN'
                          ? ` · idx ${row.intelligenceSnapshot.regimeCompatibility.dimensions.indexStructure}`
                          : ''}
                      </Typography>
                    ) : null}
                    {row.intelligenceSnapshot.multiHorizonAgreement?.horizons?.length ? (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {row.intelligenceSnapshot.multiHorizonAgreement.horizons
                          .filter((h) => h.role !== 'CONTEXT' || h.bias !== 'UNKNOWN')
                          .map((h) => `${h.horizon}:${h.bias}`)
                          .join(' · ')}
                        {row.intelligenceSnapshot.multiHorizonAgreement.higherTimeframeAlignment !==
                        'UNKNOWN'
                          ? ` · HTF ${row.intelligenceSnapshot.multiHorizonAgreement.higherTimeframeAlignment}`
                          : ''}
                      </Typography>
                    ) : null}
                    {row.intelligenceSnapshot.thesis?.setup ? (
                      <Typography variant="caption" display="block">
                        {row.intelligenceSnapshot.thesis.direction ?? ''}{' '}
                        {row.intelligenceSnapshot.thesis.setup}
                      </Typography>
                    ) : null}
                    {(row.intelligenceSnapshot.conflicts ?? []).slice(0, 3).map((c) => (
                      <Typography
                        key={`${c.code}-${c.message}`}
                        variant="caption"
                        display="block"
                        color={c.severity === 'BLOCK' ? 'error.main' : 'text.secondary'}
                      >
                        {c.severity}: {c.message}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
                {row.waitIntelligence ? (
                  <WaitIntelligencePanel wait={row.waitIntelligence} />
                ) : null}
                {row.thesisReassessment ? (
                  <ThesisIntelligencePanel thesis={row.thesisReassessment} />
                ) : row.thesisSnapshot?.initialThesis ? (
                  <ThesisIntelligencePanel thesis={row.thesisSnapshot.initialThesis} />
                ) : null}
                <TradeLifecyclePanel lifecycle={lifecycleSnapshot} />
              </Paper>
            ))}
            {(decisionsData?.decisions?.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No ledger rows yet. Approve or run PAPER autonomous to record decisions.
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </Drawer>
    </>
  );
}
