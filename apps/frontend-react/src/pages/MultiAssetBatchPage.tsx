/**
 * Multi-Asset Batch — universe-driven batch platform.
 *
 * BATCH UNIVERSE RULE:
 * Predefined universes (NIFTY*, NSE_ALL, US_SP500, *_ALL) resolve membership on the backend.
 * Manual symbols only for CUSTOM / SINGLE_STOCK / legacy *_CUSTOM.
 * Missing canonical source → Not available — never fall back to Custom/MDS/hardcoded.
 */
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  ListSubheader,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState, Fragment } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  useCreateIntelligenceBatchMutation,
  useCreatePaperExperimentMutation,
  useGetCanonicalUniversesQuery,
  useGetLatestBatchResearchReportQuery,
  useGetMultiAssetRegistryQuery,
  useListPaperExperimentsQuery,
  type UniverseCoveragePreview,
} from '../store/api';
import DataReliabilityStrip from '../components/DataReliabilityStrip';
import MultiAssetBatchWorkstation from '../components/MultiAssetBatchWorkstation';

const GROUP_ORDER = ['INDIA', 'US', 'FOREX', 'CRYPTO', 'COMMODITIES', 'FUTURES'] as const;

const TIMEFRAMES = ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'] as const;
const HORIZONS = ['1D', '3D', '5D', '1W', '1M', '3M', '6M', '1Y'] as const;

function capLabel(state: string | undefined): string {
  if (!state) return 'Not available';
  if (state === 'AVAILABLE') return 'Available';
  if (state === 'PARTIAL') return 'Partial';
  return 'Not available';
}

function formatEligible(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function groupLabel(group: string): string {
  if (group === 'INDIA') return 'India';
  if (group === 'US') return 'US';
  if (group === 'FOREX') return 'Forex';
  if (group === 'CRYPTO') return 'Crypto';
  if (group === 'COMMODITIES') return 'Commodities';
  if (group === 'FUTURES') return 'Futures';
  return group;
}

function LegacyMultiAssetBatchPage(): JSX.Element {
  const [universe, setUniverse] = useState<string>('NSE_ALL');
  const [symbolsText, setSymbolsText] = useState('');
  const [sector, setSector] = useState('');
  const [analysisTimeframe, setAnalysisTimeframe] = useState<string>('3M');
  const [predictionHorizon, setPredictionHorizon] = useState<string>('1M');
  const [actionError, setActionError] = useState<string | null>(null);
  const [createBatch, createState] = useCreateIntelligenceBatchMutation();
  const [createPaper, paperState] = useCreatePaperExperimentMutation();
  const { data: catalog, isError: catalogError } = useGetCanonicalUniversesQuery();
  const { data: registry } = useGetMultiAssetRegistryQuery();
  const { data: paperList = [] } = useListPaperExperimentsQuery();
  const { data: latestEnvelope } = useGetLatestBatchResearchReportQuery({});
  const coverage = latestEnvelope?.report?.capabilityCoverage ?? [];

  const universes = catalog?.universes ?? [];
  const selected: UniverseCoveragePreview | undefined =
    universes.find((u) => u.universeId === universe) ?? universes[0];

  const needsSymbols = !!selected?.requiresManualInstruments;
  const needsSector = selected?.universeId === 'SECTOR';
  const canRun =
    !!selected &&
    selected.supported &&
    !createState.isLoading &&
    (!needsSymbols ||
      (selected.universeId === 'SINGLE_STOCK'
        ? symbolsText
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean).length === 1
        : symbolsText
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean).length > 0)) &&
    (!needsSector || sector.trim().length > 0);

  const symbols = useMemo(
    () =>
      symbolsText
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    [symbolsText],
  );

  const adapterCaps = useMemo(() => {
    const adapters = registry?.adapters ?? [];
    const hint = selected?.adapterHint ?? 'NSE_EQUITY';
    if (hint === 'US_EQUITY') return adapters.find((a) => a.id.includes('us-equity'));
    if (hint === 'CRYPTO_SPOT') return adapters.find((a) => a.id.includes('crypto-spot'));
    if (hint === 'COMMODITY_FUTURE') return adapters.find((a) => a.id.includes('commodity-future'));
    if (hint === 'INDEX_FUTURE') return adapters.find((a) => a.id.includes('index-future'));
    return adapters.find((a) => a.id.includes('nse-equity'));
  }, [registry, selected?.adapterHint]);

  const groupedMenu = useMemo(() => {
    const byGroup = new Map<string, UniverseCoveragePreview[]>();
    for (const g of GROUP_ORDER) byGroup.set(g, []);
    for (const u of universes) {
      const list = byGroup.get(u.group) ?? [];
      list.push(u);
      byGroup.set(u.group, list);
    }
    return GROUP_ORDER.map((g) => ({ group: g, items: byGroup.get(g) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [universes]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Multi-Asset Batch
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select a universe — the backend resolves all eligible members. Manual symbols only for
        Custom / Single Stock. Missing canonical sources show Not available (never fall back to
        Custom).
      </Typography>

      <DataReliabilityStrip />

      {actionError && (
        <Alert severity="error" sx={{ my: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {catalogError && (
        <Alert severity="warning" sx={{ my: 2 }}>
          Universe catalog unavailable — cannot start a predefined batch until the agent service
          responds.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          Universe
        </Typography>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
            <TextField
              select
              size="small"
              label="Universe"
              value={selected?.universeId ?? universe}
              onChange={(e) => {
                setUniverse(e.target.value);
                setActionError(null);
              }}
              sx={{ minWidth: 260 }}
            >
              {groupedMenu.map(({ group, items }) => (
                <Fragment key={group}>
                  <ListSubheader>{groupLabel(group)}</ListSubheader>
                  {items.map((u) => (
                    <MenuItem key={u.universeId} value={u.universeId}>
                      {u.label}
                      {!u.supported ? ' — Not available' : ''}
                      {u.requiresManualInstruments ? ' (manual)' : ''}
                    </MenuItem>
                  ))}
                </Fragment>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Analysis timeframe"
              value={analysisTimeframe}
              onChange={(e) => setAnalysisTimeframe(e.target.value)}
              sx={{ minWidth: 140 }}
            >
              {TIMEFRAMES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t.toUpperCase()}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Prediction horizon"
              value={predictionHorizon}
              onChange={(e) => setPredictionHorizon(e.target.value)}
              sx={{ minWidth: 140 }}
            >
              {HORIZONS.map((h) => (
                <MenuItem key={h} value={h}>
                  {h}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {/* Canonical coverage — never "eligible cache" */}
          {selected && (
            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Universe coverage
              </Typography>
              {selected.supported ? (
                <Stack spacing={0.25}>
                  <Typography variant="body2">
                    ✓ Canonical universe {selected.requiresManualInstruments ? 'mode' : 'loaded'}
                  </Typography>
                  {selected.eligibleCount != null && (
                    <Typography variant="body2">
                      {formatEligible(selected.eligibleCount)} eligible instruments
                    </Typography>
                  )}
                  {selected.source && (
                    <Typography variant="body2" color="text.secondary">
                      Source: {selected.source}
                    </Typography>
                  )}
                  {(selected.version || selected.effectiveDate) && (
                    <Typography variant="body2" color="text.secondary">
                      Version: {selected.version ?? '—'}
                      {selected.effectiveDate ? ` · ${selected.effectiveDate}` : ''}
                    </Typography>
                  )}
                  {selected.detail && selected.requiresManualInstruments && (
                    <Typography variant="caption" color="text.secondary">
                      {selected.detail}
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Alert severity="info" variant="outlined" sx={{ mt: 0.5 }}>
                  <Typography fontWeight={700}>Not available</Typography>
                  <Typography variant="body2">
                    {selected.detail ?? 'Canonical universe source is not currently configured.'}
                  </Typography>
                  {selected.reasonCode && (
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      reasonCode: {selected.reasonCode}
                    </Typography>
                  )}
                </Alert>
              )}
            </Box>
          )}

          {needsSector && (
            <TextField
              size="small"
              label="Sector"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              helperText="Backend resolves sector members — do not paste a symbol list."
              sx={{ maxWidth: 360 }}
            />
          )}

          {needsSymbols && (
            <TextField
              size="small"
              label={selected?.universeId === 'SINGLE_STOCK' ? 'Symbol' : 'Instruments'}
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              helperText={
                selected?.universeId === 'SINGLE_STOCK'
                  ? 'Exactly one symbol / InstrumentRef.'
                  : 'Comma-separated. Custom only — not a substitute for All universes.'
              }
              fullWidth
            />
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              disabled={!canRun}
              onClick={async () => {
                try {
                  setActionError(null);
                  if (!selected?.supported) {
                    setActionError(
                      selected?.detail ?? 'UNSUPPORTED_UNIVERSE — canonical source not configured',
                    );
                    return;
                  }
                  const body: {
                    universe: string;
                    scanKind?: string;
                    symbols?: string[];
                    sector?: string;
                    analysisTimeframe?: string;
                    predictionHorizon?: string;
                  } = {
                    universe: selected.universeId,
                    scanKind: selected.scanKind,
                    analysisTimeframe,
                    predictionHorizon,
                  };
                  // BATCH UNIVERSE RULE: never send symbols for predefined universes.
                  if (needsSymbols) {
                    body.symbols = symbols;
                  }
                  if (needsSector) {
                    body.sector = sector.trim();
                  }
                  await createBatch(body).unwrap();
                } catch (e: unknown) {
                  const msg =
                    e && typeof e === 'object' && 'data' in e
                      ? String(
                          (e as { data?: { message?: string } }).data?.message ?? 'Batch rejected',
                        )
                      : e instanceof Error
                        ? e.message
                        : 'Batch rejected — provider/capability not available';
                  setActionError(msg);
                }
              }}
            >
              Run batch
            </Button>
            <Button component={RouterLink} to="/batch" size="small">
              NSE Batch Center
            </Button>
            <Button component={RouterLink} to="/research-reports" size="small">
              Command Center
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Adapter capabilities
        </Typography>
        {!adapterCaps ? (
          <Typography color="text.secondary">Not available</Typography>
        ) : (
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {Object.entries(adapterCaps.capabilities).map(([k, v]) => (
              <Chip
                key={k}
                size="small"
                label={`${k}: ${capLabel(v)}`}
                color={v === 'AVAILABLE' ? 'success' : v === 'PARTIAL' ? 'warning' : 'default'}
                variant="outlined"
              />
            ))}
          </Stack>
        )}
        {adapterCaps?.benchmarkId != null && (
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            Benchmark: {adapterCaps.benchmarkId} · Product: {adapterCaps.productLabel}
          </Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Latest batch capabilityCoverage
        </Typography>
        {coverage.length === 0 ? (
          <Typography color="text.secondary">Not available</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Capability</TableCell>
                <TableCell align="right">Available</TableCell>
                <TableCell align="right">Partial</TableCell>
                <TableCell align="right">Unavailable</TableCell>
                <TableCell align="right">Coverage</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {coverage.map((row) => (
                <TableRow key={row.capability}>
                  <TableCell>{row.capability}</TableCell>
                  <TableCell align="right">{row.available}</TableCell>
                  <TableCell align="right">{row.partial}</TableCell>
                  <TableCell align="right">{row.unavailable}</TableCell>
                  <TableCell align="right">
                    {row.coverageCount}/{row.totalCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Paper experiments</Typography>
          <Button
            size="small"
            disabled={
              paperState.isLoading || !needsSymbols || symbols.length === 0 || !selected?.supported
            }
            onClick={async () => {
              try {
                setActionError(null);
                await createPaper({
                  symbol: symbols[0]!,
                  adapterHint: selected?.adapterHint,
                  predictionHorizon,
                  note: 'Advisory paper experiment — Learning never mutates Risk/Gate',
                }).unwrap();
              } catch (e: unknown) {
                setActionError(e instanceof Error ? e.message : 'Paper experiment failed');
              }
            }}
          >
            Queue experiment ({symbols[0] ?? '—'})
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Paper queue uses an explicit instrument (Custom / Single Stock). Predefined All universes
          do not invent a paper symbol.
        </Typography>
        <Divider sx={{ mb: 1 }} />
        {paperList.length === 0 ? (
          <Typography color="text.secondary">Not available</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Id</TableCell>
                <TableCell>Instrument</TableCell>
                <TableCell>Adapter</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Confidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paperList.slice(0, 20).map((row) => {
                const inst = row.instrument as { symbol?: string; venue?: string } | undefined;
                return (
                  <TableRow key={String(row.experimentId)}>
                    <TableCell>{String(row.experimentId)}</TableCell>
                    <TableCell>
                      {inst?.venue}/{inst?.symbol}
                    </TableCell>
                    <TableCell>{String(row.adapterId ?? '')}</TableCell>
                    <TableCell>{String(row.status ?? '')}</TableCell>
                    <TableCell>
                      {row.confidenceStatus === 'AVAILABLE' && row.confidence != null
                        ? String(row.confidence)
                        : 'Not available'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {registry && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            learningTouchesRiskOrGate={String(registry.learningTouchesRiskOrGate)}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

void LegacyMultiAssetBatchPage;
export default MultiAssetBatchWorkstation;
