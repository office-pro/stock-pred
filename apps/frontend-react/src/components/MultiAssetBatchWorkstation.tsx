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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  usePostCombinedBatchPreflightMutation,
  useResumeIntelligenceBatchMutation,
  useSearchCanonicalInstrumentsQuery,
} from '../store/api';
import {
  ANALYSIS_PERIOD_LABELS,
  ANALYSIS_RESOLUTION_LABELS,
  batchRunProgressStages,
  buildMultiAssetBatchRequest,
  clearActiveBatchSession,
  clearWorkstationDraft,
  computeBackendCanRun,
  computeCanSubmit,
  defaultCustomAnalysisWindow,
  DEFAULT_WORKSTATION_UNIVERSE,
  FEATURED_PREDEFINED_CARDS,
  FEATURED_UNIVERSE_IDS,
  formatBatchDuration,
  formatCreateBatchError,
  formatElapsed,
  formatPreflightRequestError,
  formatTimestamp,
  isActiveBatchStatus,
  isMiPreflightUniverse,
  isTerminalBatchStatus,
  isValidAnalysisWindow,
  lifecycleStageCopy,
  loadWorkstationDraft,
  mapWorkstationToPreflightConfig,
  miWorkflowStepIndex,
  overviewKpis,
  persistActiveBatchId,
  pickDefaultAnalysisPeriod,
  pickDefaultAnalysisResolution,
  pickDefaultPredictionHorizon,
  pickActiveBatchForUniverse,
  pickLatestTerminalBatch,
  pickRecoverableCreatedBatch,
  saveWorkstationDraft,
  stableSerializePreflightConfig,
  unwrapPreflightBlockedBody,
  type FrozenResultIdentity,
  type PreflightPresentationState,
  type ReadinessPolicyChoice,
  type AnalysisSessionChoice,
  type SnapshotCoverageRow,
} from '../lib/multi-asset-batch';
import {
  AnalysisConfiguration,
  ArtifactsPanel,
  BatchDetailsPanel,
  BatchHistoryTable,
  CapabilityDetailsDrawer,
  OptionChips,
  OverviewHome,
  ResultDetailsDrawer,
  ResultsSummary,
  TaskEventsPanel,
  TopOpportunities,
} from './multi-asset-batch/workstation-panels';
import {
  BatchReadinessPanel,
  BatchResultDetail,
  BatchRunProgressPanel,
  DataSourceStatusPanel,
  GroupedCapabilityCoverageTable,
  IneligibleInstrumentsTable,
  MiWorkflowStepper,
  QuarantineBanner,
  ResultsReadinessBanner,
  SnapshotInfoPanel,
} from './multi-asset-batch/batch-run-panels';
import { PageTitle, QueryState, WorkstationFooter } from './multi-asset-batch/workstation-chrome';
import type { CombinedBatchPreflightV2 } from '@stockpred/shared-types';
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
  const [miMode, setMiMode] = useState<'STANDARD' | 'ADVANCED' | 'CUSTOM'>('STANDARD');
  const [readinessPolicyChoice, setReadinessPolicyChoice] =
    useState<ReadinessPolicyChoice>('DEFAULT');
  const [analysisSessionChoice, setAnalysisSessionChoice] =
    useState<AnalysisSessionChoice>('CURRENT_MARKET');
  const [detailTab, setDetailTab] = useState(1);
  const [preflightPresentation, setPreflightPresentation] =
    useState<PreflightPresentationState>('NOT_EVALUATED');
  const [preflightStored, setPreflightStored] = useState<{
    key: string;
    result: CombinedBatchPreflightV2;
  } | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightAttempt, setPreflightAttempt] = useState(0);
  const [peekBatch] = useLazyGetIntelligenceBatchQuery();
  const [postPreflight] = usePostCombinedBatchPreflightMutation();
  const postPreflightRef = useRef(postPreflight);
  postPreflightRef.current = postPreflight;
  const { data: catalogResponse, isError: catalogFailed } = useGetCanonicalUniversesQuery();
  const catalog = catalogResponse?.universes ?? [];
  const selected = catalog.find((entry) => entry.universeId === universeId);
  const selectedUniverseId = selected?.universeId ?? '';
  const selectedKind = selected?.kind;
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
  const activeForUniverse = pickActiveBatchForUniverse(historyRows, selected?.universeId);
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

  // Reopen stored active batch only on overview — never hijack Review for another universe.
  useEffect(() => {
    if (urlBatchId || urlView === 'history' || wizardScreen !== 'overview') return;
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
  }, [peekBatch, setSearchParams, urlBatchId, urlView, wizardScreen]);

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

  const formValid = useMemo(() => {
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

  const isMiUniverse = isMiPreflightUniverse(selected?.universeId);
  const preflightConfig = useMemo(() => {
    if (!selectedUniverseId || !isMiUniverse) return null;
    return mapWorkstationToPreflightConfig({
      universeId: selectedUniverseId,
      analysisPeriod,
      analysisResolution,
      predictionHorizon: horizon,
      miMode,
      readinessPolicyChoice,
      analysisSessionChoice,
      lockedSymbols:
        selectedKind === 'CUSTOM' || selectedKind === 'SINGLE_STOCK'
          ? instruments.map((i) => i.symbol)
          : undefined,
    });
  }, [
    analysisPeriod,
    analysisResolution,
    analysisSessionChoice,
    horizon,
    instruments,
    isMiUniverse,
    miMode,
    readinessPolicyChoice,
    selectedKind,
    selectedUniverseId,
  ]);
  const currentPreflightKey = stableSerializePreflightConfig(preflightConfig);

  const backendCanRun = computeBackendCanRun({
    isMiUniverse,
    currentKey: currentPreflightKey,
    storedKey: preflightStored?.key ?? null,
    result: preflightStored?.result,
    presentation: preflightPresentation,
  });
  const canSubmit = computeCanSubmit({ formValid, isMiUniverse, backendCanRun });

  useEffect(() => {
    setPreflightError(null);
    if (!isMiUniverse) {
      setPreflightPresentation('NOT_EVALUATED');
      setPreflightStored(null);
      return;
    }
    if (!preflightConfig || !formValid) {
      // Incomplete form is not a pending request — avoid sticky "Loading preflight…".
      setPreflightPresentation('NOT_EVALUATED');
      return;
    }
    const key = currentPreflightKey;
    const config = preflightConfig;
    setPreflightPresentation('LOADING');
    setPreflightStored((prev) => (prev?.key === key ? prev : null));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void postPreflightRef
        .current(config)
        .unwrap()
        .then((result) => {
          if (cancelled) return;
          setPreflightStored({ key, result });
          setPreflightPresentation(result.canAnalyze === true ? 'READY' : 'BLOCKED');
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setPreflightStored(null);
          setPreflightError(formatPreflightRequestError(reason));
          setPreflightPresentation('ERROR');
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Keyed only on stable fingerprint — catalog object identity must not restart LOADING.
  }, [currentPreflightKey, formValid, isMiUniverse, preflightAttempt]);

  const coverage: SnapshotCoverageRow[] = (batch?.capabilityCoverage ??
    (reportEnvelope?.report as { capabilityCoverage?: SnapshotCoverageRow[] } | undefined)
      ?.capabilityCoverage ??
    []) as SnapshotCoverageRow[];
  const runProgressStages = batchRunProgressStages({
    lifecycle: batch?.lifecycleStage,
    status: batch?.status,
    coverage,
  });
  const workflowIndex = miWorkflowStepIndex({
    hasBatch: Boolean(urlBatchId),
    lifecycle: batch?.lifecycleStage,
    status: batch?.status,
    preflightPresentation,
  });
  const activePreflight =
    preflightStored?.key === currentPreflightKey ? preflightStored.result : null;

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
    if (!selected || !canSubmit) return;
    setError(null);
    const startedAt = Date.now();
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
        miMode,
        readinessPolicyChoice,
        analysisSessionChoice,
      });
      const created = await createBatch(body).unwrap();
      const newId = created?.batchId || (created as { id?: string } | undefined)?.id || '';
      if (!newId) {
        throw new Error('Create succeeded but response had no batchId');
      }
      persistActiveBatchId(newId, 'QUEUED');
      // Navigate immediately so progress header can show ID before detail fetch.
      setSearchParams({ batchId: newId }, { replace: true });
    } catch (reason) {
      // Gateway/proxy timeout can lose the 201 while trader-agent already persisted.
      try {
        const listed = await refetchHistory().unwrap();
        const recovered = pickRecoverableCreatedBatch(listed ?? [], selected.universeId, startedAt);
        if (recovered?.batchId) {
          persistActiveBatchId(recovered.batchId, recovered.status);
          setSearchParams({ batchId: recovered.batchId }, { replace: true });
          return;
        }
      } catch {
        /* fall through to surface original error */
      }
      const blocked = unwrapPreflightBlockedBody(reason);
      if (blocked?.combinedPreflight) {
        setPreflightStored({
          key: currentPreflightKey,
          result: blocked.combinedPreflight,
        });
        setPreflightPresentation('BLOCKED');
      }
      setError(formatCreateBatchError(reason));
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
        <Alert
          severity="error"
          onClose={() => setError(null)}
          sx={{ mb: 2, whiteSpace: 'pre-line' }}
        >
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
          <MiWorkflowStepper activeIndex={workflowIndex} />
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            gap={1}
            alignItems={{ md: 'center' }}
            flexWrap="wrap"
            mb={2}
          >
            <Typography variant="h6" fontWeight={750} flex={1}>
              Review & Run
            </Typography>
            <TextField
              select
              size="small"
              label="MI Mode"
              value={miMode}
              onChange={(e) => setMiMode(e.target.value as 'STANDARD' | 'ADVANCED' | 'CUSTOM')}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="STANDARD">Standard</MenuItem>
              <MenuItem value="ADVANCED">Advanced</MenuItem>
              <MenuItem value="CUSTOM">Custom</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Readiness policy"
              value={readinessPolicyChoice}
              onChange={(e) => setReadinessPolicyChoice(e.target.value as ReadinessPolicyChoice)}
              sx={{ minWidth: 220 }}
              data-testid="readiness-policy-select"
            >
              <MenuItem value="DEFAULT">Default: STRICT_ALL</MenuItem>
              <MenuItem value="ELIGIBLE_SUBSET">Eligible subset (ELIGIBLE_SUBSET)</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Analysis session"
              value={analysisSessionChoice}
              onChange={(e) => setAnalysisSessionChoice(e.target.value as AnalysisSessionChoice)}
              sx={{ minWidth: 240 }}
              data-testid="analysis-session-select"
            >
              <MenuItem value="CURRENT_MARKET">Current market (15m freshness)</MenuItem>
              <MenuItem value="OFF_SESSION_ANALYSIS">
                Off-session research (non-actionable)
              </MenuItem>
            </TextField>
            <Button
              variant="contained"
              disabled={!canSubmit}
              onClick={() => void run()}
              data-testid="run-batch-button"
            >
              {createState.isLoading ? 'Starting…' : 'Run Batch'}
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={1}>
            Default keeps today&apos;s all-or-nothing gate. Eligible subset runs when ≥90% of the
            universe is ELIGIBLE (backend-enforced). Off-session research uses completed-session
            data and is always non-actionable — never a silent downgrade from current market.
          </Typography>
          {readinessPolicyChoice === 'ELIGIBLE_SUBSET' ? (
            <Alert severity="info" sx={{ mb: 2 }} data-testid="eligible-subset-info">
              Eligible subset (ELIGIBLE_SUBSET) requires ≥1 ELIGIBLE instrument and ≥90% of the
              universe ELIGIBLE. ANALYZED_NOT_PROMOTABLE does not count toward the threshold.
            </Alert>
          ) : null}
          {analysisSessionChoice === 'OFF_SESSION_ANALYSIS' ? (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="off-session-info">
              Off-session analysis uses the latest completed-session data. Results are marked
              NON_ACTIONABLE and do not authorize trades. Source timestamps are preserved.
            </Alert>
          ) : null}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
              gap: 2,
              mb: 2,
            }}
          >
            <BatchReadinessPanel
              presentation={preflightPresentation}
              preflight={activePreflight}
              notEvaluatedReason={
                isMiUniverse ? undefined : 'Market Intelligence — Not evaluated for this universe'
              }
              errorMessage={preflightError}
              onRetry={() => setPreflightAttempt((n) => n + 1)}
            />
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
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
              gap: 2,
            }}
          >
            <DataSourceStatusPanel
              sources={scopedReadiness?.dataSources ?? []}
              preflight={activePreflight}
            />
            <SnapshotInfoPanel
              miEvaluated={isMiUniverse}
              universe={selected.universeId}
              resolution={analysisResolution}
              miMode={miMode}
              batchId={activeForUniverse?.batchId}
              batchStatus={activeForUniverse?.status}
              creating={createState.isLoading}
              onOpenBatch={(id) => setSearchParams({ batchId: id }, { replace: true })}
            />
          </Box>
          <Alert severity="info" sx={{ mt: 2 }}>
            This is not investment advice. Predictions are probabilistic and there is no guarantee
            of profits. Live trading requires explicit broker authorization.
          </Alert>
          <Stack direction="row" justifyContent="space-between" mt={2}>
            <Button onClick={() => setWizardScreen('configure')}>Back</Button>
            <Button variant="outlined" onClick={saveDraft}>
              Save Draft
            </Button>
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

      {(screen === 'progress' || screen === 'results') && (
        <Box data-testid={screen === 'progress' ? 'screen-batch-progress' : 'screen-results'}>
          {/* Batch ID from URL immediately after create — do not wait for detail fetch. */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ md: 'center' }}
            gap={1}
            mb={1.5}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                Multi-Asset Batch Workstation
              </Typography>
              <Typography variant="body2" color="text.secondary">
                End-to-end market intelligence for equities.
              </Typography>
            </Box>
            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
              {batch?.status || (urlBatchId && batchLoading) ? (
                <Chip
                  label={
                    batch?.status === 'COMPLETED' || batch?.status === 'PARTIAL'
                      ? 'Batch Completed'
                      : (batch?.status ?? 'Loading…')
                  }
                  color={
                    batch?.status === 'COMPLETED' || batch?.status === 'PARTIAL'
                      ? 'success'
                      : batch?.status === 'RUNNING' || batch?.status === 'QUEUED'
                        ? 'info'
                        : 'default'
                  }
                />
              ) : null}
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="running-batch-id"
                fontWeight={700}
              >
                {batch?.batchId ?? urlBatchId ?? '—'}
                {batch?.completedAt || batch?.startedAt
                  ? ` · ${formatTimestamp(batch.completedAt ?? batch.startedAt)}`
                  : ''}
              </Typography>
              <Button size="small" variant="contained" onClick={startNewBatch}>
                + New Batch
              </Button>
              <Button size="small" variant="outlined" onClick={openHistory}>
                View History
              </Button>
            </Stack>
          </Stack>
          <QueryState
            loading={batchLoading && !batch}
            error={batchError && !batch}
            errorMessage="Unable to load batch"
            onRetry={() => void refetchBatch()}
          >
            <MiWorkflowStepper activeIndex={workflowIndex} />
            <QuarantineBanner identityCounts={batch?.identityCounts} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '1.15fr 1fr' },
                gap: 2,
                mb: 2,
              }}
            >
              <BatchReadinessPanel
                presentation={isMiPreflightUniverse(batch?.universe) ? 'READY' : 'NOT_EVALUATED'}
                preflight={activePreflight}
                notEvaluatedReason={
                  isMiPreflightUniverse(batch?.universe)
                    ? undefined
                    : 'Market Intelligence — Not evaluated for this universe'
                }
              />
              <BatchRunProgressPanel stages={runProgressStages} running={running} />
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
                gap: 2,
                mb: 2,
              }}
            >
              <DataSourceStatusPanel
                sources={scopedReadiness?.dataSources ?? []}
                preflight={activePreflight}
              />
              <SnapshotInfoPanel
                batchId={batch?.batchId ?? urlBatchId}
                batchStatus={batch?.status}
                dataSnapshotVersion={batch?.dataSnapshotVersion}
                marketIntelligenceSnapshotId={batch?.marketIntelligenceSnapshotId}
                asOf={batch?.asOf}
                universe={batch?.universe ?? selected?.universeId}
                resolution={batch?.analysisResolution ?? analysisResolution}
                miMode={batch?.miMode ?? miMode}
                miEvaluated={isMiPreflightUniverse(batch?.universe ?? selected?.universeId)}
              />
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', xl: '1.3fr 1fr' },
                gap: 2,
              }}
            >
              <Paper variant="outlined" sx={{ p: 2 }} data-testid="coverage-results-tabs">
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: 'rgba(148, 163, 184, 0.9)',
                    mb: 1,
                  }}
                >
                  ⑤ COVERAGE / RESULTS / OPPORTUNITIES
                </Typography>
                <Tabs
                  value={resultsTab}
                  onChange={(_, value) => setResultsTab(value)}
                  sx={{ mb: 2 }}
                >
                  <Tab label="Coverage" />
                  <Tab label={`Results${results?.total != null ? ` (${results.total})` : ''}`} />
                  <Tab label="Top Opportunities" />
                  <Tab label="Batch Details" />
                  <Tab label="Logs" />
                  <Tab label="Artifacts" />
                </Tabs>
                {resultsTab === 0 && (
                  <GroupedCapabilityCoverageTable
                    rows={coverage}
                    onSelect={setSelectedCapability}
                  />
                )}
                {resultsTab === 1 && terminal && (
                  <QueryState
                    loading={resultsLoading && !results}
                    error={resultsError && !results}
                    errorMessage="Unable to load results"
                    onRetry={() => void refetchResults()}
                  >
                    <ResultsReadinessBanner
                      outcome={results?.outcome}
                      readinessPolicy={results?.readinessPolicy}
                      ineligibleCount={results?.ineligible?.length}
                      batchStatus={batch?.status}
                      hasRankings={(results?.rankings?.length ?? 0) > 0}
                    />
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
                    <IneligibleInstrumentsTable
                      rows={
                        results?.ineligible as
                          | import('@stockpred/shared-types').InstrumentReadinessEligibility[]
                          | undefined
                      }
                    />
                  </QueryState>
                )}
                {resultsTab === 1 && !terminal && (
                  <Typography color="text.secondary">
                    Results appear when the batch completes.
                  </Typography>
                )}
                {resultsTab === 2 && terminal && (
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
                    readinessPolicy={results?.readinessPolicy}
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
              </Paper>
              <BatchResultDetail row={selectedResult} tab={detailTab} onTab={setDetailTab} />
            </Box>
            {(running || batch?.status === 'PAUSED') && (
              <Stack direction="row" gap={1} mt={2} flexWrap="wrap">
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
                <Typography variant="body2" color="text.secondary" alignSelf="center">
                  {lifecycleStageCopy(
                    batch?.lifecycleStage,
                    batch?.dataReadinessReport?.eligible ?? batch?.eligibleCount,
                  )}{' '}
                  · Elapsed {formatElapsed(batch?.startedAt)}
                </Typography>
              </Stack>
            )}
          </QueryState>
        </Box>
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
