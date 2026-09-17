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
import type { InstrumentRef } from '@stockpred/shared-types';
import { useEffect, useMemo, useState } from 'react';
import {
  useCancelIntelligenceBatchMutation,
  useCreateIntelligenceBatchMutation,
  useGetBatchResearchReportQuery,
  useGetCanonicalUniversesQuery,
  useGetIntelligenceBatchQuery,
  useGetIntelligenceBatchResultsQuery,
  useGetIntelligenceSectorsQuery,
  useGetMultiAssetReadinessQuery,
  usePauseIntelligenceBatchMutation,
  useResumeIntelligenceBatchMutation,
  useSearchCanonicalInstrumentsQuery,
} from '../store/api';
import {
  ANALYSIS_PERIOD_LABELS,
  ANALYSIS_RESOLUTION_LABELS,
  analysisChecklist,
  buildMultiAssetBatchRequest,
  defaultCustomAnalysisWindow,
  formatElapsed,
  formatTimestamp,
  isValidAnalysisWindow,
  lifecycleStageCopy,
  loadWorkstationDraft,
  pickDefaultAnalysisPeriod,
  pickDefaultAnalysisResolution,
  pickDefaultPredictionHorizon,
  saveWorkstationDraft,
  wizardStageStates,
  type FrozenResultIdentity,
  type SnapshotCoverageRow,
} from '../lib/multi-asset-batch';
import {
  AnalysisConfiguration,
  BatchProgress,
  CapabilityCoverageTable,
  CapabilityDetailsDrawer,
  CoverageDonut,
  DataQualityPanel,
  DataSourceList,
  ResultDetailsDrawer,
  ResultsSummary,
  TopOpportunities,
  UniverseSummary,
} from './multi-asset-batch/workstation-panels';

const MARKET_TABS = [
  ['INDIA', 'India'],
  ['US', 'US'],
  ['FOREX', 'Forex'],
  ['CRYPTO', 'Crypto'],
  ['COMMODITIES', 'Commodities'],
  ['FUTURES', 'Futures'],
  ['CUSTOM', 'Custom'],
] as const;

const WIZARD_STEPS = ['Select Universe', 'Configure Analysis', 'Review & Run'];

export default function MultiAssetBatchWorkstation(): JSX.Element {
  const [step, setStep] = useState(0);
  const [resultsTab, setResultsTab] = useState(0);
  const [resultsPage, setResultsPage] = useState(0);
  const [resultsQuery, setResultsQuery] = useState('');
  const [recommendationFilter, setRecommendationFilter] = useState('');
  const [market, setMarket] = useState<(typeof MARKET_TABS)[number][0]>('INDIA');
  const [universeId, setUniverseId] = useState('NSE_ALL');
  const [analysisPeriod, setAnalysisPeriod] = useState('');
  const [analysisResolution, setAnalysisResolution] = useState('1D');
  const [customWindow, setCustomWindow] = useState(() => defaultCustomAnalysisWindow());
  const [horizon, setHorizon] = useState('');
  const [mode, setMode] = useState('');
  const [sector, setSector] = useState('');
  const [instrumentQuery, setInstrumentQuery] = useState('');
  const [instruments, setInstruments] = useState<InstrumentRef[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState(
    () => sessionStorage.getItem('multiAsset.selectedBatchId') ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [selectedResult, setSelectedResult] = useState<FrozenResultIdentity | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<SnapshotCoverageRow | null>(null);

  const { data: catalogResponse, isError: catalogFailed } = useGetCanonicalUniversesQuery();
  const catalog = catalogResponse?.universes ?? [];
  const selected = catalog.find((entry) => entry.universeId === universeId);
  const cards = useMemo(
    () =>
      catalog.filter(
        (entry) =>
          entry.group === market &&
          !['US_CUSTOM', 'CRYPTO_CUSTOM', 'COMMODITIES_CUSTOM', 'FUTURES_CUSTOM'].includes(
            entry.universeId,
          ),
      ),
    [catalog, market],
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
  const { data: batch } = useGetIntelligenceBatchQuery(selectedBatchId, {
    skip: !selectedBatchId,
    pollingInterval: 2_000,
  });
  const running =
    batch?.status === 'RUNNING' || batch?.status === 'PAUSED' || batch?.status === 'QUEUED';
  const terminal =
    batch?.status === 'COMPLETED' || batch?.status === 'PARTIAL' || batch?.status === 'FAILED';
  const { data: reportEnvelope } = useGetBatchResearchReportQuery(selectedBatchId, {
    skip: !selectedBatchId || !terminal,
  });
  const { data: results } = useGetIntelligenceBatchResultsQuery(
    {
      id: selectedBatchId,
      page: resultsPage + 1,
      pageSize: 10,
      q: resultsQuery || undefined,
      recommendation: recommendationFilter || undefined,
    },
    { skip: !selectedBatchId || !terminal },
  );

  useEffect(() => {
    if (selectedBatchId) sessionStorage.setItem('multiAsset.selectedBatchId', selectedBatchId);
  }, [selectedBatchId]);

  useEffect(() => {
    if (running) setStep(3);
    else if (terminal) setStep(4);
  }, [running, terminal]);

  useEffect(() => {
    const inMarket = cards.some((entry) => entry.universeId === universeId);
    if (inMarket) return;
    const first = cards.find((entry) => entry.supported) ?? cards[0];
    if (first) setUniverseId(first.universeId);
  }, [cards, universeId]);

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
      setSelectedBatchId(created.batchId);
      setStep(3);
    } catch (reason) {
      const data =
        reason && typeof reason === 'object' && 'data' in reason
          ? (reason as { data?: { message?: string } }).data
          : undefined;
      setError(data?.message ?? (reason instanceof Error ? reason.message : 'Batch rejected'));
    }
  };

  const configureFields = selected ? (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5 }}
    >
      <TextField
        select
        size="small"
        label="Analysis Period"
        value={analysisPeriod}
        onChange={(event) => setAnalysisPeriod(event.target.value)}
      >
        {(
          selected.analysisOptions?.analysisPeriods ??
          selected.analysisOptions?.timeframes ??
          []
        ).map((value) => (
          <MenuItem key={value} value={value}>
            {ANALYSIS_PERIOD_LABELS[value] ?? value}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Prediction Horizon"
        value={horizon}
        onChange={(event) => setHorizon(event.target.value)}
      >
        {(selected.analysisOptions?.horizons ?? []).map((value) => (
          <MenuItem key={value.id} value={value.id}>
            {value.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Mode"
        value={mode}
        onChange={(event) => setMode(event.target.value)}
      >
        {(selected.analysisOptions?.modes ?? []).map((value) => (
          <MenuItem key={value.id} value={value.id}>
            {value.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Analysis Resolution"
        value={analysisResolution}
        onChange={(event) => setAnalysisResolution(event.target.value)}
      >
        {(selected.analysisOptions?.analysisResolutions ?? ['1D']).map((value) => (
          <MenuItem key={value} value={value}>
            {ANALYSIS_RESOLUTION_LABELS[value] ?? value}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  ) : null;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2, lg: 3 }, maxWidth: 1280, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1} mb={2}>
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Multi-Asset Batch Workstation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Run comprehensive analysis across global markets
          </Typography>
        </Box>
      </Stack>

      <Stepper activeStep={Math.min(step, 2)} alternativeLabel sx={{ mb: 3 }}>
        {WIZARD_STEPS.map((label) => (
          <Step key={label} completed={step > WIZARD_STEPS.indexOf(label) || terminal || running}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

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

      {step === 0 && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-select-universe">
          <Typography variant="h6" fontWeight={750}>
            Select Universe
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Choose the market universe for your batch analysis
          </Typography>
          <Tabs
            value={market}
            onChange={(_, value) => setMarket(value)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {MARKET_TABS.map(([id, label]) => (
              <Tab key={id} value={id} label={label} />
            ))}
          </Tabs>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: 1.5,
              mt: 2,
            }}
          >
            {cards.map((entry) => (
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
                    {!entry.supported && <Chip size="small" label="Not available" sx={{ mt: 1 }} />}
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
          <Stack direction="row" justifyContent="flex-end" mt={2}>
            <Button variant="contained" onClick={() => setStep(1)} disabled={!selected}>
              Next
            </Button>
          </Stack>
        </Paper>
      )}

      {step === 1 && selected && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-configure-analysis">
          <Typography variant="h6" fontWeight={750}>
            Configure Analysis
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Set up analysis parameters for your batch run
          </Typography>
          <Box
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr' }, gap: 2 }}
          >
            <Box>
              {configureFields}
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
                          {row.instrument.symbol} · {row.instrument.venue} ·{' '}
                          {row.instrument.assetClass}
                        </span>
                        <span>Add</span>
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
            <UniverseSummary
              name={selected.name}
              description={selected.description}
              instrumentCount={selected.instrumentCount}
              assetClass={selected.assetClass}
              venue={selected.venue}
              market={market}
              onEdit={() => setStep(0)}
            />
          </Box>
          <Stack direction="row" justifyContent="space-between" mt={2}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="contained" onClick={() => setStep(2)}>
              Next
            </Button>
          </Stack>
        </Paper>
      )}

      {step === 2 && selected && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-review-run">
          <Typography variant="h6" fontWeight={750}>
            Review & Run
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Review your configuration and start the batch analysis
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
              onEdit={() => setStep(1)}
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
          <Stack direction="row" justifyContent="space-between" mt={2}>
            <Button onClick={() => setStep(1)}>Back</Button>
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

      {step === 3 && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-batch-progress">
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6" fontWeight={750}>
              Batch Analysis Progress
            </Typography>
            <Stack direction="row" gap={1} alignItems="center">
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
            <Typography variant="body2">Remaining Not available</Typography>
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
        </Paper>
      )}

      {step >= 4 && (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="screen-results">
          {terminal && (
            <Alert severity={batch?.status === 'FAILED' ? 'error' : 'success'} sx={{ mb: 2 }}>
              {batch?.status === 'FAILED' ? 'Batch failed' : 'Batch Analysis Completed'}
              <Typography variant="caption" display="block">
                Completed at {formatTimestamp(batch?.completedAt)} · Total time{' '}
                {formatElapsed(batch?.startedAt, batch?.completedAt)}
              </Typography>
            </Alert>
          )}
          <Tabs value={resultsTab} onChange={(_, value) => setResultsTab(value)} sx={{ mb: 2 }}>
            <Tab label="Coverage" />
            <Tab label="Results" />
            <Tab label="Top Opportunities" />
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
                <CoverageDonut
                  rows={coverage}
                  coveragePct={batch?.dataReadinessReport?.coveragePct}
                />
                <DataQualityPanel identityCounts={batch?.identityCounts} />
              </Stack>
            </Box>
          )}
          {resultsTab === 1 && (
            <Box>
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
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 280px' },
                  gap: 2,
                }}
              >
                <Box>
                  <ResultsSummary rankings={results?.rankings ?? []} onSelect={setSelectedResult} />
                  <TablePagination
                    component="div"
                    count={results?.total ?? 0}
                    page={resultsPage}
                    onPageChange={(_, page) => setResultsPage(page)}
                    rowsPerPage={10}
                    rowsPerPageOptions={[10]}
                  />
                </Box>
                <TopOpportunities rankings={results?.rankings ?? []} onSelect={setSelectedResult} />
              </Box>
            </Box>
          )}
          {resultsTab === 2 && (
            <TopOpportunities rankings={results?.rankings ?? []} onSelect={setSelectedResult} />
          )}
        </Paper>
      )}

      <ResultDetailsDrawer row={selectedResult} onClose={() => setSelectedResult(null)} />
      <CapabilityDetailsDrawer
        row={selectedCapability}
        onClose={() => setSelectedCapability(null)}
      />
    </Box>
  );
}
