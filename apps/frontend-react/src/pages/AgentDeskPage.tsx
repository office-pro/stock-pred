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
  LinearProgress,
  Paper,
  Stack,
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
import AgentTradingToggle from '../components/AgentTradingToggle';
import AgentSuggestionCards from '../components/AgentSuggestionCards';
import { authErrorMessage } from '../lib/auth-errors';
import {
  useApproveAgentRecommendationMutation,
  useGetAgentModeQuery,
  useGetAgentOpportunitiesQuery,
  useGetAgentPositionsQuery,
  useGetPortfolioQuery,
  useSetAgentKillSwitchMutation,
  useSetAgentModeMutation,
} from '../store/api';

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

export default function AgentDeskPage(): JSX.Element {
  const [symbol, setSymbol] = useState('');
  const { data: modeData, refetch: refetchMode } = useGetAgentModeQuery(undefined, {
    pollingInterval: 15_000,
  });
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
  const { data: portfolio, refetch: refetchPortfolio } = useGetPortfolioQuery(undefined, {
    pollingInterval: 10_000,
  });
  const [setMode] = useSetAgentModeMutation();
  const [setKill] = useSetAgentKillSwitchMutation();
  const [approve, approveState] = useApproveAgentRecommendationMutation();
  const [toast, setToast] = useState<string | null>(null);
  const [toastSeverity, setToastSeverity] = useState<'info' | 'success' | 'error'>('info');
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null);
  const [approveQty, setApproveQty] = useState('1');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTargets, setBulkTargets] = useState<ApproveTarget[] | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const tradingOn = Boolean(modeData?.tradingEnabled);
  const mode = modeData?.mode ?? 'PAPER';
  const parsedApproveQty = Math.max(1, Math.round(Number(approveQty) || 0));
  const approveQtyValid = Number.isFinite(Number(approveQty)) && Number(approveQty) >= 1;

  const opportunities = (opps?.opportunities ?? []) as OpportunityRow[];
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
    await Promise.all([refetchOpps(), refetchPositions(), refetchPortfolio()]);
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
        <Button size="small" variant="outlined" onClick={() => refetchOpps()} disabled={isFetching}>
          Refresh opportunities
        </Button>
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
          {approveBlockReason && (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.25 }}>
              Approve disabled — {approveBlockReason}.
            </Typography>
          )}
          {!approveBlockReason && cashTooLow && (
            <Typography variant="caption" color="error.main" display="block" sx={{ mt: 0.25 }}>
              Cash is too low to buy any listed name (need ≥ ₹
              {cheapestEntry.toLocaleString('en-IN')}
              ). Sell lots or reset paper capital first.
            </Typography>
          )}
        </Box>
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
      </Stack>

      {bulkProgress && (
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
                  </TableCell>
                  <TableCell align="center">
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
                  </TableCell>
                </TableRow>
              );
            })}
            {opportunities.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No opportunities yet. Ensure market-data and models are up, then refresh.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Managed positions ({positions?.positions?.length ?? 0})
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Entry</TableCell>
              <TableCell align="right">Last</TableCell>
              <TableCell align="right">Stop</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell>Policy</TableCell>
              <TableCell align="right">uPnL</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(positions?.positions ?? []).map((lot) => (
              <TableRow key={lot.symbol}>
                <TableCell>{lot.symbol}</TableCell>
                <TableCell align="right">{lot.quantity}</TableCell>
                <TableCell align="right">{lot.entryPrice}</TableCell>
                <TableCell align="right">{lot.currentPrice}</TableCell>
                <TableCell align="right">{lot.stopLoss}</TableCell>
                <TableCell align="right">{lot.target}</TableCell>
                <TableCell>
                  <Chip size="small" label={lot.policy} />
                  <Typography variant="caption" display="block">
                    {lot.policyNote}
                  </Typography>
                </TableCell>
                <TableCell align="right">{lot.unrealizedPnl}</TableCell>
              </TableRow>
            ))}
            {(positions?.positions ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Box sx={{ py: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      No open agent-managed lots. Approve a BUY or open from Paper book.
                    </Typography>
                  </Box>
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
                await Promise.all([refetchOpps(), refetchPositions()]);
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
    </>
  );
}
