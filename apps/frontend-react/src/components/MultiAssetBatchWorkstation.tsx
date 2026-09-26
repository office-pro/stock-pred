import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import type { InstrumentRef, UniverseCatalogEntry } from '@stockpred/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useCancelIntelligenceBatchMutation,
  useCreateIntelligenceBatchMutation,
  useGetBatchResearchReportQuery,
  useGetCanonicalUniversesQuery,
  useGetIntelligenceBatchQuery,
  useGetIntelligenceBatchResultsQuery,
  useGetIntelligenceSectorsQuery,
  useGetMultiAssetReadinessQuery,
  useLazyGetIntelligenceBatchQuery,
  useListIntelligenceBatchesQuery,
  usePauseIntelligenceBatchMutation,
  useResumeIntelligenceBatchMutation,
  useSearchCanonicalInstrumentsQuery,
} from '../store/api';
import {
  ANALYSIS_PERIOD_LABELS,
  ANALYSIS_RESOLUTION_LABELS,
  analysisChecklist,
  buildMultiAssetBatchRequest,
  clearActiveBatchSession,
  clearWorkstationDraft,
  defaultCustomAnalysisWindow,
  DEFAULT_WORKSTATION_UNIVERSE,
  FEATURED_PREDEFINED_CARDS,
  FEATURED_UNIVERSE_IDS,
  formatBatchDuration,
  formatElapsed,
  formatTimestamp,
  isActiveBatchStatus,
  isTerminalBatchStatus,
  isValidAnalysisWindow,
  lifecycleStageCopy,
  loadWorkstationDraft,
  overviewKpis,
  persistActiveBatchId,
  pickDefaultAnalysisPeriod,
  pickDefaultAnalysisResolution,
  pickDefaultPredictionHorizon,
  pickLatestTerminalBatch,
  saveWorkstationDraft,
  wizardStageStates,
  type FrozenResultIdentity,
  type SnapshotCoverageRow,
} from '../lib/multi-asset-batch';
import {
  AnalysisConfiguration,
  ArtifactsPanel,
  BatchDetailsPanel,
  BatchHistoryTable,
  BatchProgress,
  CapabilityCoverageTable,
  CapabilityDetailsDrawer,
  CoverageDonut,
  DataQualityPanel,
  DataSourceList,
  OptionChips,
  OverviewHome,
  ResultDetailsDrawer,
  ResultsSummary,
  TaskEventsPanel,
  TerminalContextBar,
  TopOpportunities,
} from './multi-asset-batch/workstation-panels';
import { PageTitle, QueryState, WorkstationFooter } from './multi-asset-batch/workstation-chrome';

const WIZARD_STEPS = ['Select Universe', 'Configure Analysis', 'Review & Run'] as const;
const SELECTOR_TABS = ['Predefined', 'Custom', 'My Watchlists', 'Upload Symbols'] as const;
type WizardScreen = 'overview' | 'select' | 'configure' | 'review';
type SelectorTab = (typeof SELECTOR_TABS)[number];

export default function MultiAssetBatchWorkstation(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlBatchId = searchParams.get('batchId') ?? '';
  const urlView = searchParams.get('view') ?? '';

  const [wizardScreen, setWizardScreen] = useState<WizardScreen>('overview');
  const [selectorTab, setSelectorTab] = useState<SelectorTab>('Predefined');
  const [resultsTab, setResultsTab] = useState(0);
  const [resultsPage, setResultsPage] = useState(0);
  const [resultsQuery, setResultsQuery] = useState('');
  const [recommendationFilter, setRecommendationFilter] = useState('');
  const [universeId, setUniverseId] = useState(DEFAULT_WORKSTATION_UNIVERSE);
  const [analysisPeriod, setAnalysisPeriod] = useState('');
  const [analysisResolution, setAnalysisResolution] = useState('1D');
  const [customWindow, setCustomWindow] = useState(() => defaultCustomAnalysisWindow());
  const [horizon, setHorizon] = useState('');
  const [mode, setMode] = useState('');
  const [sector, setSector] = useState('');
  const [instrumentQuery, setInstrumentQuery] = useState('');
  const [instruments, setInstruments] = useState<InstrumentRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [selectedResult, setSelectedResult] = useState<FrozenResultIdentity | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<SnapshotCoverageRow | null>(null);
  const [historyUniverse, setHistoryUniverse] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const [peekBatch] = useLazyGetIntelligenceBatchQuery();

  const { data: catalogResponse, isError: catalogFailed } = useGetCanonicalUniversesQuery();
  const catalog = catalogResponse?.universes ?? [];
  const selected = catalog.find((entry) => entry.universeId === universeId);
  const moreUniverses = useMemo(
    () =>
      catalog.filter(
        (entry) =>
          !FEATURED_UNIVERSE_IDS.includes(entry.universeId) &&
          !['US_CUSTOM', 'CRYPTO_CUSTOM', 'COMMODITIES_CUSTOM', 'FUTURES_CUSTOM'].includes(
            entry.universeId,
          ),
      ),
    [catalog],
  );

  const { data: sectors } = useGetIntelligenceSectorsQuery(undefined, {
    skip: selected?.kind !== 'SECTOR',
  });
  const { data: searchResults, isFetching: searching } = useSearchCanonicalInstrumentsQuery(
    {
      q: instrumentQuery,
      assetClass:
        selected?.kind === 'CUSTOM' || selected?.kind === 'SINGLE_STOCK'
          ? selected.assetClass
          : undefined,
      venue:
        selected?.kind === 'SINGLE_STOCK' && selected.venue !== 'MULTI'
          ? selected.venue
          : undefined,
    },
    { skip: instrumentQuery.trim().length < 2 || !selected?.requiresManualInstruments },
  );
  const { data: readiness } = useGetMultiAssetReadinessQuery(universeId, {
    skip: !selected?.universeId,
    pollingInterval: 30_000,
  });
  const scopedReadiness =
    readiness?.universe?.universeId === selected?.universeId ? readiness : undefined;
  const [createBatch, createState] = useCreateIntelligenceBatchMutation();
  const [pauseBatch] = usePauseIntelligenceBatchMutation();
  const [resumeBatch] = useResumeIntelligenceBatchMutation();
  const [cancelBatch] = useCancelIntelligenceBatchMutation();
  const [batchPollMs, setBatchPollMs] = useState(0);
  const {
    data: batch,
    isLoading: batchLoading,
    isError: batchError,
    refetch: refetchBatch,
  } = useGetIntelligenceBatchQuery(urlBatchId, {
    skip: !urlBatchId,
    pollingInterval: batchPollMs,
  });
  const running = isActiveBatchStatus(batch?.status);
  const terminal = isTerminalBatchStatus(batch?.status);

  useEffect(() => {
    setBatchPollMs(urlBatchId && isActiveBatchStatus(batch?.status) ? 2_000 : 0);
  }, [urlBatchId, batch?.status]);
  const { data: reportEnvelope } = useGetBatchResearchReportQuery(urlBatchId, {
    skip: !urlBatchId || !terminal,
  });
  const {
    data: results,
    isLoading: resultsLoading,
    isError: resultsError,
    refetch: refetchResults,
  } = useGetIntelligenceBatchResultsQuery(
    {
      id: urlBatchId,
      page: resultsPage + 1,
      pageSize: 10,
      q: resultsQuery || undefined,
      recommendation: recommendationFilter || undefined,
    },
    { skip: !urlBatchId || !terminal },
  );
  const overviewActive = !urlBatchId && urlView !== 'history';
  const [historyPollMs, setHistoryPollMs] = useState(0);
  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useListIntelligenceBatchesQuery(
    { limit: 50 },
    {
      skip: Boolean(urlBatchId),
      pollingInterval: historyPollMs,
    },
  );
  const historyRows = historyData ?? [];
  const latestTerminal = pickLatestTerminalBatch(historyRows);
  const { data: latestBatchDetail } = useGetIntelligenceBatchQuery(latestTerminal?.batchId ?? '', {
    skip: !overviewActive || !latestTerminal?.batchId,
  });

  useEffect(() => {
    const rows = historyData ?? [];
    setHistoryPollMs(
      !urlBatchId && rows.some((row) => isActiveBatchStatus(row.status)) ? 2_000 : 0,
    );
  }, [urlBatchId, historyData]);

  useEffect(() => {
    if (urlBatchId) persistActiveBatchId(urlBatchId, batch?.status);
  }, [urlBatchId, batch?.status]);

  useEffect(() => {
    if (urlBatchId || urlView === 'history') return;
    const stored = sessionStorage.getItem('multiAsset.selectedBatchId');
    if (!stored) return;
    let cancelled = false;
    void peekBatch(stored)
      .unwrap()
      .then((row) => {
        if (cancelled) return;
        if (isActiveBatchStatus(row.status)) {
          setSearchParams({ batchId: stored }, { replace: true });
        } else {
          clearActiveBatchSession();
        }
      })
      .catch(() => {
        if (!cancelled) clearActiveBatchSession();
      });
    return () => {
      cancelled = true;
    };
  }, [peekBatch, setSearchParams, urlBatchId, urlView]);

  useEffect(() => {
    const draft = loadWorkstationDraft();
    const options = selected?.analysisOptions;
    const periods = options?.analysisPeriods ?? options?.timeframes ?? [];
    const useDraft = Boolean(draft && draft.universeId === selected?.universeId);
    setAnalysisPeriod(
      useDraft && draft?.analysisPeriod ? draft.analysisPeriod : pickDefaultAnalysisPeriod(periods),
    );
    setHorizon(
      useDraft && draft?.horizon ? draft.horizon : pickDefaultPredictionHorizon(options?.horizons),
    );
    setMode(useDraft && draft?.mode ? draft.mode : (options?.modes[0]?.id ?? ''));
    setAnalysisResolution(
      useDraft && draft?.analysisResolution
        ? draft.analysisResolution
        : pickDefaultAnalysisResolution(options?.analysisResolutions),
    );
    setCustomWindow(defaultCustomAnalysisWindow());
    setSector('');
    setInstruments([]);
    setInstrumentQuery('');
  }, [selected?.universeId]);

  const canRun = useMemo(() => {
    if (!selected?.supported || createState.isLoading) return false;
    if (!analysisPeriod || !horizon || !mode) return false;
    if (analysisPeriod === 'CUSTOM' && !isValidAnalysisWindow(customWindow)) return false;
    if (selected.kind === 'SECTOR') return Boolean(sector);
    if (selected.kind === 'SINGLE_STOCK') return instruments.length === 1;
    if (selected.kind === 'CUSTOM') return instruments.length > 0;
    return true;
  }, [
    analysisPeriod,
    createState.isLoading,
    customWindow,
    horizon,
    instruments.length,
    mode,
    sector,
    selected,
  ]);

  const coverage: SnapshotCoverageRow[] = (batch?.capabilityCoverage ??
    (reportEnvelope?.report as { capabilityCoverage?: SnapshotCoverageRow[] } | undefined)
      ?.capabilityCoverage ??
    []) as SnapshotCoverageRow[];
  const checklist = analysisChecklist({
    coverage,
    capability: selected?.capability
      ? {
          marketData: selected.capability.marketData,
          technical: selected.capability.historicalCandles,
          fundamentals: selected.capability.fundamentals,
          news: selected.capability.sentiment,
          macro: selected.capability.globalImpact,
          derivatives: selected.capability.derivatives,
        }
      : undefined,
  });
  const progressStages = wizardStageStates(batch?.lifecycleStage, batch?.status, coverage);

  const screen = urlBatchId
    ? running || !terminal
      ? 'progress'
      : 'results'
    : urlView === 'history'
      ? 'history'
      : wizardScreen;

  const stepperIndex =
    screen === 'configure' ? 1 : screen === 'review' ? 2 : screen === 'select' ? 0 : 0;
  const showStepper = screen === 'select' || screen === 'configure' || screen === 'review';
  const kpis = overviewKpis({
    batch: latestBatchDetail,
    hasTerminalBatch: Boolean(latestTerminal) && !historyLoading && !historyError,
  });

  const startNewBatch = (): void => {
    clearActiveBatchSession();
    clearWorkstationDraft();
    setUniverseId(DEFAULT_WORKSTATION_UNIVERSE);
    setInstruments([]);
    setSector('');
    setInstrumentQuery('');
    setError(null);
    setDraftSaved(false);
    setResultsTab(0);
    setWizardScreen('select');
    setSelectorTab('Predefined');
    setSearchParams({}, { replace: true });
  };

  const openHistory = (): void => {
    setSearchParams({ view: 'history' }, { replace: true });
  };

  const openBatch = (batchId: string): void => {
    setSearchParams({ batchId }, { replace: true });
  };

  const addInstrument = (ref: InstrumentRef): void => {
    const key = `${ref.venue}|${ref.assetClass}|${ref.canonicalSymbol ?? ref.symbol}`;
    setInstruments((current) => {
      if (selected?.kind === 'SINGLE_STOCK') return [ref];
      if (
        current.some(
          (row) => `${row.venue}|${row.assetClass}|${row.canonicalSymbol ?? row.symbol}` === key,
        )
      ) {
        return current;
      }
      return [...current, ref];
    });
  };

  const saveDraft = (): void => {
    if (!selected) return;
    saveWorkstationDraft({
      universeId: selected.universeId,
      analysisPeriod,
      analysisResolution,
      horizon,
      mode,
      sector,
    });
    setDraftSaved(true);
  };

  const run = async (): Promise<void> => {
    if (!selected || !canRun) return;
    setError(null);
    try {
      const body = buildMultiAssetBatchRequest({
        universe: selected,
        analysisPeriod,
        analysisResolution,
        analysisWindow: analysisPeriod === 'CUSTOM' ? customWindow : undefined,
        predictionHorizon: horizon,
        mode,
        sector,
        instruments,
      });
      const created = await createBatch(body).unwrap();
      persistActiveBatchId(created.batchId, 'QUEUED');
      setSearchParams({ batchId: created.batchId }, { replace: true });
    } catch (reason) {
      const data =
        reason && typeof reason === 'object' && 'data' in reason
          ? (reason as { data?: { message?: string } }).data
          : undefined;
      setError(data?.message ?? (reason instanceof Error ? reason.message : 'Batch rejected'));
    }
  };

  const retryNewRun = (): void => {
    if (batch?.universe) setUniverseId(batch.universe);
    if (batch?.analysisPeriod) setAnalysisPeriod(batch.analysisPeriod);
    if (batch?.analysisResolution) setAnalysisResolution(batch.analysisResolution);
    if (batch?.predictionHorizon) setHorizon(batch.predictionHorizon);
    if (batch?.mode) setMode(batch.mode);
    if (batch?.sector) setSector(batch.sector);
    if (batch?.analysisWindow) setCustomWindow(batch.analysisWindow);
    clearActiveBatchSession();
    setWizardScreen('review');
    setSearchParams({}, { replace: true });
  };

  const selectUniverseCard = (entry: UniverseCatalogEntry | undefined, placeholder?: boolean) => {
    if (!entry || placeholder) return;
    setUniverseId(entry.universeId);
  };

  const periodOptions = (
    selected?.analysisOptions?.analysisPeriods ??
    selected?.analysisOptions?.timeframes ??
    []
  ).map((value) => ({ id: value, label: ANALYSIS_PERIOD_LABELS[value] ?? value }));
  const horizonOptions = (selected?.analysisOptions?.horizons ?? []).map((row) => ({
    id: row.id,
    label: row.label,
  }));
  const resolutionOptions = (selected?.analysisOptions?.analysisResolutions ?? ['1D']).map(
    (value) => ({
      id: value,
      label: ANALYSIS_RESOLUTION_LABELS[value] ?? value,
    }),
  );

  const header = (
    <PageTitle
      title={screen === 'history' ? 'Batch History' : 'Multi-Asset Batch Workstation'}
      subtitle={
        screen === 'history'
          ? 'View and compare all your analysis batches across global markets'
          : 'Analysis Across Global Markets'
      }
      breadcrumb={screen === 'history' ? 'Multi-Asset Batch > Batch History' : undefined}
      actions={
        screen === 'results' ? (
          <>
            <Button variant="outlined" onClick={openHistory}>
              View History
            </Button>
            <Button variant="outlined" onClick={retryNewRun}>
              Retry
            </Button>
            <Button variant="contained" onClick={startNewBatch}>
              Run New Batch
            </Button>
          </>
        ) : (
          <>
            <Button variant="outlined" onClick={openHistory}>
              View History
            </Button>
            <Button variant="contained" onClick={startNewBatch}>
              New Batch
            </Button>
          </>
        )
      }
    />
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2, lg: 3 }, maxWidth: 1600, mx: 'auto' }}>
      {header}

      {showStepper && (
        <Stepper activeStep={stepperIndex} alternativeLabel sx={{ mb: 3 }}>
          {WIZARD_STEPS.map((label) => (
            <Step key={label} completed={stepperIndex > WIZARD_STEPS.indexOf(label)}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {catalogFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Universe discovery is unavailable. Batch execution is disabled.
        </Alert>
      )}
      {draftSaved && (
        <Alert severity="success" onClose={() => setDraftSaved(false)} sx={{ mb: 2 }}>
          Draft saved on this device.
        </Alert>
      )}

      {screen === 'overview' && (
        <OverviewHome
          kpis={kpis}
          recent={historyRows}
          recentLoading={historyLoading}
          recentError={historyError}
          onRetryRecent={() => void refetchHistory()}
          onViewAll={openHistory}
          onView={openBatch}
          onNewBatch={startNewBatch}
        />
      )}

      {screen === 'select' && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-select-universe">
          <Typography variant="h6" fontWeight={750}>
            Select Universe
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Choose the markets and instruments to analyze
          </Typography>
          <Tabs
            value={selectorTab}
            onChange={(_, value: SelectorTab) => setSelectorTab(value)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {SELECTOR_TABS.map((label) => (
              <Tab key={label} value={label} label={label} />
            ))}
          </Tabs>

          {selectorTab === 'Predefined' && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              {FEATURED_PREDEFINED_CARDS.map((card) => {
                const entry = catalog.find((row) => row.universeId === card.universeId);
                const supported = card.placeholder ? false : Boolean(entry?.supported);
                const selectedCard = universeId === card.universeId;
                const count = entry?.instrumentCount;
                return (
                  <Card
                    key={card.universeId}
                    variant="outlined"
                    sx={{
                      borderColor: selectedCard ? 'primary.main' : undefined,
                      opacity: supported ? 1 : 0.68,
                    }}
                  >
                    <CardActionArea
                      onClick={() => selectUniverseCard(entry, card.placeholder)}
                      disabled={!supported}
                      sx={{ height: '100%' }}
                    >
                      <CardContent>
                        <Typography fontWeight={750}>{card.title}</Typography>
                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                          {card.subtitle}
                        </Typography>
                        <Typography variant="caption" display="block" mt={1}>
                          {supported
                            ? `${(count ?? 0).toLocaleString()} symbols`
                            : (entry?.reason ?? 'Not available')}
                        </Typography>
                        {!supported && <Chip size="small" label="Not available" sx={{ mt: 1 }} />}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Box>
          )}

          {selectorTab === 'Custom' && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              {moreUniverses.map((entry) => (
                <Card
                  key={entry.universeId}
                  variant="outlined"
                  sx={{
                    borderColor: universeId === entry.universeId ? 'primary.main' : undefined,
                    opacity: entry.supported ? 1 : 0.68,
                  }}
                >
                  <CardActionArea
                    onClick={() => setUniverseId(entry.universeId)}
                    sx={{ height: '100%' }}
                  >
                    <CardContent>
                      <Typography fontWeight={750}>{entry.name}</Typography>
                      <Typography variant="body2" color="text.secondary" mt={0.5}>
                        {entry.description}
                      </Typography>
                      <Typography variant="caption" display="block" mt={1}>
                        {entry.supported
                          ? `${(entry.instrumentCount ?? 0).toLocaleString()} eligible`
                          : (entry.reason ?? 'Not available')}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          )}

          {(selectorTab === 'My Watchlists' || selectorTab === 'Upload Symbols') && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {selectorTab} is Not available.
            </Alert>
          )}

          {universeId === 'NSE_ALL' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              NSE ALL is a large universe (~
              {(selected?.instrumentCount ?? 2300).toLocaleString()} names). Hydrate and Phase C
              evidence can take a long time.
            </Alert>
          )}

          <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
            <Button onClick={() => setWizardScreen('overview')}>Back</Button>
            <Typography variant="body2" color="text.secondary">
              Selected: {selected?.name ?? 'None'}
            </Typography>
            <Button
              variant="contained"
              onClick={() => setWizardScreen('configure')}
              disabled={!selected}
            >
              Next: Configure
            </Button>
          </Stack>
        </Paper>
      )}

      {screen === 'configure' && selected && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-configure-analysis">
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Box>
              <Typography variant="h6" fontWeight={750}>
                Configure Analysis
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selected.name}
                {selected.instrumentCount != null
                  ? ` · ${selected.instrumentCount.toLocaleString()} symbols selected`
                  : ''}
              </Typography>
            </Box>
            <Button onClick={() => setWizardScreen('select')}>Change</Button>
          </Stack>
          <Typography fontWeight={700} mb={1}>
            Historical Period
          </Typography>
          <OptionChips
            options={periodOptions}
            value={analysisPeriod}
            onChange={setAnalysisPeriod}
            testId="analysis-period-chips"
          />
          {analysisPeriod === 'CUSTOM' && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 1.5,
                mt: 1.5,
              }}
            >
              <TextField
                size="small"
                type="date"
                label="Start date"
                value={customWindow.startDate}
                InputLabelProps={{ shrink: true }}
                onChange={(event) =>
                  setCustomWindow((current) => ({ ...current, startDate: event.target.value }))
                }
              />
              <TextField
                size="small"
                type="date"
                label="End date"
                value={customWindow.endDate}
                InputLabelProps={{ shrink: true }}
                onChange={(event) =>
                  setCustomWindow((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </Box>
          )}
          <Typography fontWeight={700} mt={2} mb={1}>
            Analysis Resolution
          </Typography>
          <OptionChips
            options={resolutionOptions}
            value={analysisResolution}
            onChange={setAnalysisResolution}
            testId="analysis-resolution-chips"
          />
          <Typography fontWeight={700} mt={2} mb={1}>
            Prediction Horizons
          </Typography>
          <OptionChips
            options={horizonOptions}
            value={horizon}
            onChange={setHorizon}
            testId="prediction-horizon-chips"
          />
          {selected.kind === 'SECTOR' && (
            <TextField
              select
              fullWidth
              size="small"
              label="Canonical sector"
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              sx={{ mt: 2 }}
            >
              {(sectors?.sectors ?? []).map((row) => (
                <MenuItem key={row.sectorVersion} value={row.sector}>
                  {row.sector} · {row.memberCount} eligible
                </MenuItem>
              ))}
            </TextField>
          )}
          {selected.requiresManualInstruments && (
            <Box mt={2}>
              <TextField
                fullWidth
                size="small"
                label={
                  selected.kind === 'SINGLE_STOCK'
                    ? 'Find one canonical instrument'
                    : 'Find canonical instruments'
                }
                value={instrumentQuery}
                onChange={(event) => setInstrumentQuery(event.target.value)}
                helperText="Search canonical listings by symbol, company, or ISIN. Free-form identities are not accepted."
                InputProps={{
                  endAdornment: searching ? <CircularProgress size={18} /> : undefined,
                }}
              />
              <Stack spacing={0.5} mt={1}>
                {(searchResults?.instruments ?? []).slice(0, 8).map((row) => (
                  <Button
                    key={row.identityKey}
                    variant="text"
                    sx={{ justifyContent: 'space-between' }}
                    onClick={() => addInstrument(row.instrument)}
                  >
                    <span>
                      {row.instrument.symbol} · {row.instrument.venue} · {row.instrument.assetClass}
                    </span>
                    <span>Add</span>
                  </Button>
                ))}
              </Stack>
            </Box>
          )}
          <Stack direction="row" justifyContent="space-between" mt={2}>
            <Button onClick={() => setWizardScreen('select')}>Back</Button>
            <Button variant="contained" onClick={() => setWizardScreen('review')}>
              Next: Review & Run
            </Button>
          </Stack>
        </Paper>
      )}

      {screen === 'review' && selected && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-review-run">
          <Typography variant="h6" fontWeight={750}>
            Review & Run
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Confirm your configuration and start the analysis
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <AnalysisConfiguration
              universeName={selected.name}
              totalSymbols={
                selected.instrumentCount ??
                (selected.requiresManualInstruments ? instruments.length : 'Not available')
              }
              analysisPeriod={ANALYSIS_PERIOD_LABELS[analysisPeriod] ?? analysisPeriod}
              predictionHorizon={
                selected.analysisOptions?.horizons?.find((row) => row.id === horizon)?.label ??
                horizon
              }
              mode={selected.analysisOptions?.modes?.find((row) => row.id === mode)?.label ?? mode}
              analysisResolution={
                ANALYSIS_RESOLUTION_LABELS[analysisResolution] ?? analysisResolution
              }
              predefinedNote={
                selected.kind === 'PREDEFINED'
                  ? 'No instruments are sent. The backend resolves and freezes complete membership.'
                  : `${instruments.length} canonical instrument${instruments.length === 1 ? '' : 's'} selected.`
              }
              onEdit={() => setWizardScreen('configure')}
            />
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={700}>What will be analyzed?</Typography>
              <Stack spacing={0.75} mt={1}>
                {checklist.map((item) => (
                  <Typography
                    key={item.label}
                    variant="body2"
                    color={item.applicable ? 'text.primary' : 'text.secondary'}
                  >
                    {item.applicable ? '✓' : '○'} {item.label}
                    {item.status === 'N/A'
                      ? ' · N/A'
                      : item.status === 'UNAVAILABLE'
                        ? ' · UNAVAILABLE'
                        : ''}
                  </Typography>
                ))}
              </Stack>
              <Box mt={2}>
                <Typography fontWeight={700} mb={1}>
                  Data sources
                </Typography>
                <DataSourceList sources={scopedReadiness?.dataSources ?? []} />
              </Box>
            </Paper>
          </Box>
          <Alert severity="info" sx={{ mt: 2 }}>
            This is not investment advice. Predictions are probabilistic and there is no guarantee
            of profits. Live trading requires explicit broker authorization.
          </Alert>
          <Stack direction="row" justifyContent="space-between" mt={2}>
            <Button onClick={() => setWizardScreen('configure')}>Back</Button>
            <Stack direction="row" gap={1}>
              <Button variant="outlined" onClick={saveDraft}>
                Save Draft
              </Button>
              <Button variant="contained" disabled={!canRun} onClick={() => void run()}>
                {createState.isLoading ? 'Starting…' : 'Run Batch Analysis'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {screen === 'history' && (
        <BatchHistoryTable
          rows={historyError ? undefined : historyData}
          loading={historyLoading}
          error={historyError}
          onRetry={() => void refetchHistory()}
          query={historyQuery}
          universeFilter={historyUniverse}
          statusFilter={historyStatus}
          startDate={historyStartDate}
          endDate={historyEndDate}
          onQuery={(value) => {
            setHistoryQuery(value);
            setHistoryPage(0);
          }}
          onUniverseFilter={(value) => {
            setHistoryUniverse(value);
            setHistoryPage(0);
          }}
          onStatusFilter={(value) => {
            setHistoryStatus(value);
            setHistoryPage(0);
          }}
          onStartDate={(value) => {
            setHistoryStartDate(value);
            setHistoryPage(0);
          }}
          onEndDate={(value) => {
            setHistoryEndDate(value);
            setHistoryPage(0);
          }}
          onClear={() => {
            setHistoryQuery('');
            setHistoryUniverse('');
            setHistoryStatus('');
            setHistoryStartDate('');
            setHistoryEndDate('');
            setHistoryPage(0);
          }}
          onView={openBatch}
          onNewBatch={startNewBatch}
          page={historyPage}
          onPage={setHistoryPage}
        />
      )}

      {screen === 'progress' && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-batch-progress">
          <QueryState
            loading={batchLoading && !batch}
            error={batchError && !batch}
            errorMessage="Unable to load batch"
            onRetry={() => void refetchBatch()}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight={750}>
                Batch Analysis Progress
              </Typography>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  {batch?.batchId ?? 'Not available'} · {batch?.universe ?? 'Not available'}
                </Typography>
                {batch?.startedAt ? (
                  <Typography variant="caption" color="text.secondary">
                    Started at {formatTimestamp(batch.startedAt)}
                  </Typography>
                ) : null}
                {batch?.status ? (
                  <Chip
                    label={batch.status}
                    color={batch.status === 'RUNNING' ? 'success' : 'default'}
                  />
                ) : null}
              </Stack>
            </Stack>
            <BatchProgress
              stages={progressStages}
              percent={batch?.progress?.percent}
              backendStages={batch?.progress?.stages}
              copy={lifecycleStageCopy(
                batch?.lifecycleStage,
                batch?.dataReadinessReport?.eligible ?? batch?.eligibleCount,
              )}
            />
            <Stack direction="row" gap={3} mt={2} flexWrap="wrap">
              <Typography variant="body2">
                Total{' '}
                {batch?.dataReadinessReport?.eligible ?? batch?.eligibleCount ?? 'Not available'}
              </Typography>
              <Typography variant="body2">
                Processed{' '}
                {batch?.dataReadinessReport?.processed ??
                  batch?.progress?.processed ??
                  'Not available'}
              </Typography>
              <Typography variant="body2">
                Failed{' '}
                {batch?.dataReadinessReport?.failed ?? batch?.progress?.failed ?? 'Not available'}
              </Typography>
              <Typography variant="body2">Elapsed {formatElapsed(batch?.startedAt)}</Typography>
            </Stack>
            <Stack direction="row" gap={1} mt={2}>
              {batch?.status === 'RUNNING' && (
                <Button onClick={() => void pauseBatch(batch.batchId)}>Pause</Button>
              )}
              {batch?.status === 'PAUSED' && (
                <Button onClick={() => void resumeBatch(batch.batchId)}>Resume</Button>
              )}
              {(batch?.status === 'RUNNING' || batch?.status === 'PAUSED') && (
                <Button color="error" onClick={() => void cancelBatch(batch.batchId)}>
                  Cancel Batch
                </Button>
              )}
            </Stack>
          </QueryState>
        </Paper>
      )}

      {screen === 'results' && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-results">
          <QueryState
            loading={batchLoading && !batch}
            error={batchError && !batch}
            errorMessage="Unable to load batch"
            onRetry={() => void refetchBatch()}
          >
            <Alert severity={batch?.status === 'FAILED' ? 'error' : 'success'} sx={{ mb: 2 }}>
              {batch?.status === 'FAILED' ? 'Batch failed' : 'Batch Analysis Completed'}
              <Typography variant="caption" display="block">
                Completed at {formatTimestamp(batch?.completedAt)} · Total time{' '}
                {formatBatchDuration(batch?.startedAt, batch?.completedAt)}
              </Typography>
              {batch?.error ? (
                <Typography variant="caption" display="block">
                  {batch.error}
                </Typography>
              ) : null}
            </Alert>
            <TerminalContextBar
              universe={batch?.universe}
              eligible={batch?.dataReadinessReport?.eligible ?? batch?.eligibleCount}
              analysisPeriod={batch?.analysisPeriod}
              analysisResolution={batch?.analysisResolution}
              predictionHorizon={batch?.predictionHorizon}
              status={batch?.status}
              duration={formatBatchDuration(batch?.startedAt, batch?.completedAt)}
            />
            <Tabs value={resultsTab} onChange={(_, value) => setResultsTab(value)} sx={{ mb: 2 }}>
              <Tab label="Coverage" />
              <Tab label="Results" />
              <Tab label="Top Opportunities" />
              <Tab label="Batch Details" />
              <Tab label="Logs" />
              <Tab label="Artifacts" />
            </Tabs>
            {resultsTab === 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 280px' },
                  gap: 2,
                }}
              >
                <Box>
                  <Typography fontWeight={750} mb={1}>
                    Data & Intelligence Coverage
                  </Typography>
                  <CapabilityCoverageTable rows={coverage} onSelect={setSelectedCapability} />
                </Box>
                <Stack spacing={2}>
                  <CoverageDonut coveragePct={batch?.dataReadinessReport?.coveragePct} />
                  <DataQualityPanel identityCounts={batch?.identityCounts} />
                </Stack>
              </Box>
            )}
            {resultsTab === 1 && (
              <QueryState
                loading={resultsLoading && !results}
                error={resultsError && !results}
                errorMessage="Unable to load results"
                onRetry={() => void refetchResults()}
              >
                <Stack direction={{ xs: 'column', md: 'row' }} gap={1} mb={2}>
                  <TextField
                    size="small"
                    label="Search by symbol, name or identity"
                    value={resultsQuery}
                    onChange={(event) => {
                      setResultsQuery(event.target.value);
                      setResultsPage(0);
                    }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    select
                    size="small"
                    label="All Recommendations"
                    value={recommendationFilter}
                    onChange={(event) => {
                      setRecommendationFilter(event.target.value);
                      setResultsPage(0);
                    }}
                    sx={{ minWidth: 220 }}
                  >
                    <MenuItem value="">All Recommendations</MenuItem>
                    <MenuItem value="APPROVE">APPROVE</MenuItem>
                    <MenuItem value="WAIT">WAIT</MenuItem>
                    <MenuItem value="WATCH">WATCH</MenuItem>
                    <MenuItem value="NO_TRADE">NO_TRADE</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </TextField>
                </Stack>
                <ResultsSummary rankings={results?.rankings} onSelect={setSelectedResult} />
                <TablePagination
                  component="div"
                  count={results?.total ?? 0}
                  page={resultsPage}
                  onPageChange={(_, page) => setResultsPage(page)}
                  rowsPerPage={10}
                  rowsPerPageOptions={[10]}
                />
              </QueryState>
            )}
            {resultsTab === 2 && (
              <QueryState
                loading={resultsLoading && !results}
                error={resultsError && !results}
                errorMessage="Unable to load results"
                onRetry={() => void refetchResults()}
              >
                <TopOpportunities rankings={results?.rankings} onSelect={setSelectedResult} />
              </QueryState>
            )}
            {resultsTab === 3 && (
              <BatchDetailsPanel
                universe={batch?.universe}
                analysisPeriod={batch?.analysisPeriod}
                analysisResolution={batch?.analysisResolution}
                predictionHorizon={batch?.predictionHorizon}
                createdAt={batch?.createdAt}
                completedAt={batch?.completedAt}
                eligible={batch?.dataReadinessReport?.eligible ?? batch?.eligibleCount}
                processed={batch?.dataReadinessReport?.processed ?? batch?.progress?.processed}
                failed={batch?.dataReadinessReport?.failed ?? batch?.progress?.failed}
                status={batch?.status}
                elapsed={formatBatchDuration(batch?.startedAt, batch?.completedAt)}
              />
            )}
            {resultsTab === 4 && <TaskEventsPanel tasks={batch?.tasks} />}
            {resultsTab === 5 && (
              <ArtifactsPanel
                batchId={batch?.batchId}
                hasResearchReport={Boolean(reportEnvelope?.report)}
                hasResults={Boolean(results)}
              />
            )}
          </QueryState>
        </Paper>
      )}

      <ResultDetailsDrawer row={selectedResult} onClose={() => setSelectedResult(null)} />
      <CapabilityDetailsDrawer
        row={selectedCapability}
        onClose={() => setSelectedCapability(null)}
      />
      <WorkstationFooter />
    </Box>
  );
}
