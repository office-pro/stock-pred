import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAppSelector } from '../../store';
import {
  type MarketIngestMode,
  type MarketQuoteStatus,
  type MlJobCatalogItem,
  type MlJobKind,
  type MlUniverseId,
  type MlUniverseOption,
  useCancelMlJobMutation,
  useGetMarketDataContractQuery,
  useGetMlJobQuery,
  useStartMlJobMutation,
} from '../../store/api';

const INGEST_KINDS: MlJobKind[] = [
  'ingest_fundamentals',
  'ingest_alt_data',
  'ingest_macro',
  'ingest_news',
  'ingest_social',
];

const INGEST_MODE_LEGEND: { mode: MarketIngestMode; blurb: string }[] = [
  { mode: 'LIVE_INGEST', blurb: 'Live provider or simulated ticks.' },
  { mode: 'EOD_INGEST', blurb: 'Official bhavcopy / index closes — not live entry.' },
  {
    mode: 'HISTORICAL_BACKFILL',
    blurb: 'Multi-session history job (logged); process mode stays LIVE/EOD.',
  },
];

const QUOTE_STATUS_LEGEND: { status: MarketQuoteStatus; blurb: string }[] = [
  { status: 'LIVE', blurb: 'NSE cash open and sample quote age ≤ 30s.' },
  {
    status: 'DELAYED',
    blurb: 'NSE cash open and 30s < age ≤ 60s — not an auth state; Risk still applies.',
  },
  { status: 'CLOSED_MARKET', blurb: 'Session closed — OK for ML/analysis, not live entry.' },
  {
    status: 'STALE',
    blurb: 'Session open but quote age > 60s — Risk DATA_STALE blocks execution.',
  },
  { status: 'UNKNOWN', blurb: 'Missing/invalid timestamp — labeled, never neutralized to flat.' },
];

const FALLBACK_INGEST_JOBS: MlJobCatalogItem[] = [
  {
    kind: 'ingest_fundamentals',
    title: 'Ingest fundamentals',
    npm: 'npm run ingest:fundamentals -- --universe nifty50',
    blurb:
      'Yahoo statements into point-in-time snapshots. Run before train if you want FA columns.',
  },
  {
    kind: 'ingest_alt_data',
    title: 'Ingest alternative data',
    npm: 'python -m app.ingest_alt --universe nifty50',
    blurb: 'Macro, news, and social for this universe in one pass.',
  },
  {
    kind: 'ingest_macro',
    title: 'Ingest macro',
    npm: 'python -m app.ingest_macro',
    blurb: 'FX/commodities/indices plus FRED CPI/policy with release-dated available_at.',
  },
  {
    kind: 'ingest_news',
    title: 'Ingest news',
    npm: 'python -m app.ingest_news --universe nifty50',
    blurb: 'RSS + GDELT headlines scored at ingest.',
  },
  {
    kind: 'ingest_social',
    title: 'Ingest social',
    npm: 'python -m app.ingest_social --universe nifty50',
    blurb: 'Reddit mentions and optional Google Trends.',
  },
];

const FALLBACK_UNIVERSES: MlUniverseOption[] = [
  { id: 'nifty50', label: 'Nifty 50', blurb: '~50 large-cap names. Fastest run.' },
  { id: 'nifty100', label: 'Nifty 100', blurb: 'Nifty 50 + Next 50.' },
  { id: 'nifty500', label: 'Nifty 500', blurb: 'Broad NSE snapshot (~500).' },
  { id: 'smallcap', label: 'Smallcap', blurb: 'Nifty 500 excluding Nifty 100.' },
  { id: 'all', label: 'All listed', blurb: 'Every listed NSE/BSE name. Slowest.' },
];

function npmFor(kind: MlJobKind, universe: MlUniverseId): string {
  if (kind === 'ingest_fundamentals') {
    return `npm run ingest:fundamentals -- --universe ${universe}`;
  }
  if (kind === 'ingest_alt_data') {
    return `python -m app.ingest_alt --universe ${universe}`;
  }
  if (kind === 'ingest_macro') return 'python -m app.ingest_macro';
  if (kind === 'ingest_news') return `python -m app.ingest_news --universe ${universe}`;
  if (kind === 'ingest_social') return `python -m app.ingest_social --universe ${universe}`;
  return kind;
}

function isIngestKind(kind: MlJobKind | undefined): boolean {
  return kind != null && INGEST_KINDS.includes(kind);
}

function quoteChipColor(
  status: MarketQuoteStatus,
  active: MarketQuoteStatus | undefined,
): 'success' | 'warning' | 'error' | 'default' {
  if (status !== active) return 'default';
  if (status === 'LIVE') return 'success';
  if (status === 'DELAYED') return 'warning';
  if (status === 'CLOSED_MARKET') return 'warning';
  if (status === 'UNKNOWN') return 'default';
  return 'error';
}

/** Phase 2: feature ingest jobs + market data-contract (status display only). */
export default function MlLabIngestionPage(): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const loggedIn = Boolean(user);

  const {
    data: contract,
    isError: contractError,
    isFetching: contractFetching,
  } = useGetMarketDataContractQuery(undefined, { pollingInterval: 15_000 });

  const { data: jobSnap, isError: jobError } = useGetMlJobQuery(undefined, {
    skip: !loggedIn,
    pollingInterval: 800,
  });
  const [startJob, startState] = useStartMlJobMutation();
  const [cancelJob, cancelState] = useCancelMlJobMutation();
  const [universe, setUniverse] = useState<MlUniverseId>('nifty50');
  const logRef = useRef<HTMLPreElement | null>(null);

  const catalog = useMemo(() => {
    const byKind = new Map<MlJobKind, MlJobCatalogItem>();
    for (const item of FALLBACK_INGEST_JOBS) byKind.set(item.kind, item);
    for (const item of jobSnap?.available ?? []) {
      if (isIngestKind(item.kind)) byKind.set(item.kind, item);
    }
    return INGEST_KINDS.map((kind) => byKind.get(kind)!);
  }, [jobSnap?.available]);

  const universes = jobSnap?.universes?.length ? jobSnap.universes : FALLBACK_UNIVERSES;
  const job = jobSnap?.job ?? null;
  const running = job?.status === 'running';
  const ingestRunning = running && isIngestKind(job?.kind);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.lines.length, job?.percent]);

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Run ML feature ingestion and inspect the market-data contract. Live OHLCV / bhavcopy is
        owned by <strong>market-data-service</strong> — this tab does not reimplement market ticks.
      </Typography>

      <Alert severity="warning" variant="outlined">
        <strong>Data status ≠ trade authorization.</strong> Ingest mode and quote freshness are
        labels for ops and ML. They do not authorize BUY/SELL and do not bypass the 60s risk quote
        gate.
      </Alert>

      <Card variant="outlined">
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1 }}
          >
            <Typography variant="subtitle1" fontWeight={700}>
              Market data contract
            </Typography>
            {contractFetching ? <Chip size="small" label="refreshing…" /> : null}
            <Chip
              size="small"
              color={contract?.nseCashSessionOpen ? 'success' : 'default'}
              label={contract?.nseCashSessionOpen ? 'NSE cash open' : 'NSE cash closed'}
            />
          </Stack>

          {contractError ? (
            <Alert severity="error" sx={{ mb: 1 }}>
              Could not load <code>/market/data-contract</code>. Is market-data-service running?
            </Alert>
          ) : null}

          <Typography variant="overline" color="text.secondary">
            Ingest mode
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            {INGEST_MODE_LEGEND.map((item) => (
              <Chip
                key={item.mode}
                size="small"
                color={item.mode === contract?.ingestMode ? 'success' : 'default'}
                variant={item.mode === contract?.ingestMode ? 'filled' : 'outlined'}
                label={item.mode}
                title={item.blurb}
              />
            ))}
          </Stack>

          <Typography variant="overline" color="text.secondary">
            Quote status (sample)
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            {QUOTE_STATUS_LEGEND.map((item) => (
              <Chip
                key={item.status}
                size="small"
                color={quoteChipColor(item.status, contract?.quoteStatus)}
                variant={item.status === contract?.quoteStatus ? 'filled' : 'outlined'}
                label={item.status}
                title={item.blurb}
              />
            ))}
            <Chip
              size="small"
              variant="outlined"
              label={contract?.liveUsable ? 'liveUsable=true' : 'liveUsable=false'}
            />
          </Stack>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Sample:{' '}
            {contract?.sampleSymbol
              ? `${contract.sampleSymbol}${
                  contract.sampleUpdatedAt
                    ? ` · ${new Date(contract.sampleUpdatedAt).toLocaleString()}`
                    : ''
                }`
              : 'no quote stamp yet'}
          </Typography>
          {contract?.note ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {contract.note}
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      {!loggedIn ? (
        <Alert severity="info">
          Log in to start ingest jobs.{' '}
          <Button component={RouterLink} to="/login" size="small">
            Login
          </Button>
        </Alert>
      ) : null}
      {jobError && loggedIn ? (
        <Alert severity="error">Could not reach the ml-engine job API.</Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Universe
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={universe}
            onChange={(_e, next: MlUniverseId | null) => {
              if (next) setUniverse(next);
            }}
            sx={{ flexWrap: 'wrap', gap: 0.5 }}
          >
            {universes.map((item) => (
              <ToggleButton key={item.id} value={item.id} sx={{ textTransform: 'none', px: 1.5 }}>
                {item.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        {catalog.map((item) => (
          <Grid item xs={12} md={item.kind === 'ingest_alt_data' ? 12 : 4} key={item.kind}>
            <Card
              variant="outlined"
              sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {item.title}
                </Typography>
                <Typography
                  variant="caption"
                  component="code"
                  display="block"
                  sx={{ my: 1, color: 'primary.main' }}
                >
                  {item.npmByUniverse?.[universe] ?? npmFor(item.kind, universe)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.blurb}
                </Typography>
              </CardContent>
              <CardActions>
                <Button
                  variant="contained"
                  disabled={!loggedIn || running || startState.isLoading}
                  onClick={() => void startJob({ kind: item.kind, universe })}
                >
                  Run
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Live ingest run
            </Typography>
            {job && isIngestKind(job.kind) ? (
              <Chip size="small" color="info" label={job.status} />
            ) : (
              <Chip size="small" label="idle (ingest)" />
            )}
            {ingestRunning ? (
              <Button
                size="small"
                color="warning"
                disabled={cancelState.isLoading}
                onClick={() => void cancelJob()}
              >
                Cancel
              </Button>
            ) : null}
          </Stack>
          {job && isIngestKind(job.kind) ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {job.stage}
                {job.total ? ` · ${job.current}/${job.total}` : ''} · {job.percent}%
              </Typography>
              <LinearProgress
                variant={running && job.percent < 3 ? 'indeterminate' : 'determinate'}
                value={job.percent ?? 0}
                sx={{ mb: 2, height: 8, borderRadius: 1 }}
              />
              <Box
                ref={logRef}
                component="pre"
                sx={{
                  m: 0,
                  p: 2,
                  height: 240,
                  overflow: 'auto',
                  bgcolor: '#0b1020',
                  color: '#d6e0ff',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.45,
                  borderRadius: 1,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {(job.lines ?? ['Waiting…']).join('\n')}
              </Box>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No ingest job in this session. Train / walk-forward / predict stay on the{' '}
              <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
                Jobs
              </Box>{' '}
              tab.
            </Typography>
          )}
          {startState.isError ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Could not start ingest job (another run may already be active).
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </Stack>
  );
}
