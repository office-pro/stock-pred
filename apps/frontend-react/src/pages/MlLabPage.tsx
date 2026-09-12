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
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAppSelector } from '../store';
import {
  type MlJobCatalogItem,
  type MlJobKind,
  type MlLifecycleStageStatus,
  type MlUniverseId,
  type MlUniverseOption,
  useCancelMlJobMutation,
  useGetMlJobQuery,
  useGetMlLifecycleLatestQuery,
  useStartMlJobMutation,
} from '../store/api';

const FALLBACK_JOBS: MlJobCatalogItem[] = [
  {
    kind: 'ml_lifecycle_full',
    title: 'Full ML lifecycle',
    npm: 'python -m app.lifecycle --mode full',
    blurb:
      'Orchestrated M1–M4: ingest → train CANDIDATE → DQ → walk-forward → calibration → promote (gates) → predict ACTIVE → score. Promotion never forced. No trades.',
  },
  {
    kind: 'ml_lifecycle_refresh',
    title: 'Incremental ML refresh',
    npm: 'python -m app.lifecycle --mode refresh',
    blurb:
      'Ingest latest → predict with ACTIVE models → score/monitor. No retrain/promote. Requires ACTIVE models.',
  },
  {
    kind: 'run_all',
    title: 'Run all',
    npm: 'python -m app.run_all',
    blurb:
      'Incremental ingest (skip if fresh), then train from the feature cache, then predict. Walk-forward is its own card. Use python -m app.run_all --full for a cold rebuild.',
  },
  {
    kind: 'ingest_fundamentals',
    title: 'Ingest fundamentals',
    npm: 'npm run ingest:fundamentals -- --universe nifty50',
    blurb:
      'Yahoo statements into point-in-time snapshots. Run this before train if you want FA columns in the same trees.',
  },
  {
    kind: 'ingest_alt_data',
    title: 'Ingest alternative data',
    npm: 'python -m app.ingest_alt --universe nifty50',
    blurb:
      'Macro, news, and social for this universe. Run this, then train, so the same trees pick up the new columns.',
  },
  {
    kind: 'ingest_macro',
    title: 'Ingest macro',
    npm: 'python -m app.ingest_macro',
    blurb:
      'Yahoo FX/commodities/indices plus FRED CPI/policy rate with release-dated available_at.',
  },
  {
    kind: 'ingest_news',
    title: 'Ingest news',
    npm: 'python -m app.ingest_news --universe nifty50',
    blurb: 'RSS + GDELT headlines scored at ingest. Daily windows join the same trees.',
  },
  {
    kind: 'ingest_social',
    title: 'Ingest social',
    npm: 'python -m app.ingest_social --universe nifty50',
    blurb:
      'Reddit mentions and optional Google Trends. Spike/coordination also feed unusual-activity.',
  },
  {
    kind: 'train_all',
    title: 'Train direction models',
    npm: 'npm run train:ml:all',
    blurb:
      'XGBoost + LightGBM with a 365-day time-series holdout. Ingest fundamentals first if you want those columns in the same model.',
  },
  {
    kind: 'walk_forward',
    title: 'Walk-forward validate',
    npm: 'npm run walkforward:ml',
    blurb:
      'Retrain trees on expanding yearly folds. Honest hit-rate. Does not replace live models.',
  },
  {
    kind: 'ml_backtest',
    title: 'ML costed backtest',
    npm: 'npm run backtest:ml',
    blurb: 'Replay Buy chips with NSE delivery costs and 5 bps slippage. Needs trained models.',
  },
  {
    kind: 'predict_all',
    title: 'Predict stocks',
    npm: 'npm run predict:all',
    blurb:
      'Score the selected universe. Requires a finished train:ml:* run first — models are shared.',
  },
  {
    kind: 'train_manipulation',
    title: 'Train unusual-activity model',
    npm: 'npm run train:ml:manipulation',
    blurb: 'Separate LightGBM/XGBoost investigate head. Not a finding of market abuse.',
  },
];

function ingestNpm(universe: MlUniverseId): string {
  return `npm run ingest:fundamentals -- --universe ${universe}`;
}

function npmFor(kind: MlJobKind, universe: MlUniverseId): string {
  if (kind === 'ml_lifecycle_full') {
    return `python -m app.lifecycle --mode full --universe ${universe}`;
  }
  if (kind === 'ml_lifecycle_refresh') {
    return `python -m app.lifecycle --mode refresh --universe ${universe}`;
  }
  if (kind === 'run_all') {
    return `python -m app.run_all --universe ${universe}`;
  }
  if (kind === 'ingest_fundamentals') {
    return ingestNpm(universe);
  }
  if (kind === 'ingest_alt_data') {
    return `python -m app.ingest_alt --universe ${universe}`;
  }
  if (kind === 'ingest_macro') {
    return 'python -m app.ingest_macro';
  }
  if (kind === 'ingest_news') {
    return `python -m app.ingest_news --universe ${universe}`;
  }
  if (kind === 'ingest_social') {
    return `python -m app.ingest_social --universe ${universe}`;
  }
  if (kind === 'train_all') {
    return universe === 'all' ? 'npm run train:ml:all' : `npm run train:ml:${universe}`;
  }
  if (kind === 'predict_all') {
    return universe === 'all' ? 'npm run predict:all' : `npm run predict:${universe}`;
  }
  if (kind === 'walk_forward') {
    return universe === 'all' ? 'npm run walkforward:ml' : `npm run walkforward:${universe}`;
  }
  if (kind === 'ml_backtest') {
    return universe === 'all' ? 'npm run backtest:ml' : `npm run backtest:ml:${universe}`;
  }
  return universe === 'all'
    ? 'npm run train:ml:manipulation'
    : `npm run train:ml:manipulation:${universe}`;
}

const JOB_TITLES: Record<MlJobKind, string> = {
  ml_lifecycle_full: 'Full ML lifecycle',
  ml_lifecycle_refresh: 'Incremental ML refresh',
  run_all: 'Run all',
  ingest_fundamentals: 'Ingest fundamentals',
  ingest_alt_data: 'Ingest alternative data',
  ingest_macro: 'Ingest macro',
  ingest_news: 'Ingest news',
  ingest_social: 'Ingest social',
  train_all: 'Train direction models',
  walk_forward: 'Walk-forward validate',
  ml_backtest: 'ML costed backtest',
  predict_all: 'Predict stocks',
  train_manipulation: 'Train unusual-activity model',
};

const FALLBACK_UNIVERSES: MlUniverseOption[] = [
  { id: 'nifty50', label: 'Nifty 50', blurb: '~50 large-cap names. Fastest run.' },
  { id: 'nifty100', label: 'Nifty 100', blurb: 'Nifty 50 + Next 50. Still quick.' },
  { id: 'nifty500', label: 'Nifty 500', blurb: 'Broad NSE large/mid/small snapshot (~500).' },
  {
    id: 'smallcap',
    label: 'Smallcap',
    blurb: 'Nifty 500 excluding Nifty 100 (~400 mid/small names).',
  },
  { id: 'all', label: 'All listed', blurb: 'Every listed NSE/BSE name. Slowest.' },
];

function mergeCatalog(remote?: MlJobCatalogItem[]): MlJobCatalogItem[] {
  const byKind = new Map<MlJobKind, MlJobCatalogItem>();
  for (const item of FALLBACK_JOBS) byKind.set(item.kind, item);
  for (const item of remote ?? []) byKind.set(item.kind, item);
  return FALLBACK_JOBS.map((item) => byKind.get(item.kind) ?? item);
}

const STATUS_COLOR: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'warning',
};

const STAGE_COLOR: Record<
  MlLifecycleStageStatus,
  'default' | 'info' | 'success' | 'error' | 'warning'
> = {
  PENDING: 'default',
  RUNNING: 'info',
  PASSED: 'success',
  FAILED: 'error',
  SKIPPED: 'default',
  BLOCKED: 'warning',
};

function isWideCard(kind: MlJobKind): boolean {
  return (
    kind === 'run_all' ||
    kind === 'ingest_alt_data' ||
    kind === 'ml_lifecycle_full' ||
    kind === 'ml_lifecycle_refresh'
  );
}

export default function MlLabPage(): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const loggedIn = Boolean(user);
  const { data, isError } = useGetMlJobQuery(undefined, {
    skip: !loggedIn,
    pollingInterval: 800,
  });
  const { data: lifecycleData } = useGetMlLifecycleLatestQuery(undefined, {
    skip: !loggedIn,
    pollingInterval: 2000,
  });
  const [startJob, startState] = useStartMlJobMutation();
  const [cancelJob, cancelState] = useCancelMlJobMutation();
  const [universe, setUniverse] = useState<MlUniverseId>('nifty50');
  const job = data?.job ?? null;
  const running = job?.status === 'running';
  const modelsTrained = Boolean(data?.modelsTrained);
  const catalog = mergeCatalog(data?.available);
  const universes = data?.universes?.length ? data.universes : FALLBACK_UNIVERSES;
  const selectedUniverse = universes.find((item) => item.id === universe) ?? FALLBACK_UNIVERSES[0];
  const logRef = useRef<HTMLPreElement | null>(null);
  const lifecycleRun = lifecycleData?.run ?? null;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.lines.length, job?.percent]);

  return (
    <>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        Jobs
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Prefer <b>Full ML lifecycle</b> for the staged ingest → train → validate → promote → predict
        path, or <b>Incremental ML refresh</b> when ACTIVE models already exist. Component cards
        remain for one-off jobs. Train still registers <b>CANDIDATE</b> only — promote is
        gate-controlled and never forced. No BUY / SELL / ARM.
      </Typography>
      {!loggedIn && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Log in to start a job.{' '}
          <Button component={RouterLink} to="/login" size="small">
            Login
          </Button>
        </Alert>
      )}
      {isError && loggedIn && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not reach the ML engine. Is ml-engine running?
        </Alert>
      )}
      {loggedIn && data && !modelsTrained && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="models-missing-banner">
          Predict / refresh need trained (preferably ACTIVE) models. Run <b>Full ML lifecycle</b> or{' '}
          <b>Train direction models</b> first (
          <Box component="code" sx={{ fontSize: 12 }}>
            {npmFor('train_all', universe)}
          </Box>
          ).
        </Alert>
      )}

      {lifecycleRun && (
        <Card variant="outlined" sx={{ mb: 2 }} data-testid="lifecycle-stage-board">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                Lifecycle stages
              </Typography>
              <Chip size="small" label={lifecycleRun.mode} color="primary" variant="outlined" />
              <Chip size="small" label={lifecycleRun.status} />
              <Chip size="small" variant="outlined" label={lifecycleRun.universe} />
              <Typography variant="caption" color="text.secondary">
                {lifecycleRun.runId.slice(0, 8)}…
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {lifecycleRun.stages.map((stage) => (
                <Chip
                  key={stage.id}
                  size="small"
                  color={STAGE_COLOR[stage.status] ?? 'default'}
                  label={`${stage.id}: ${stage.status}`}
                  title={stage.detail ?? undefined}
                />
              ))}
            </Stack>
            {lifecycleRun.stages.some((s) => s.detail) && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Hover a stage chip for detail. Promote BLOCKED keeps CANDIDATE and skips ACTIVE
                predict.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Universe
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Commands and job cards follow this picker. Lifecycle jobs reuse the same M1–M4 modules
            as the component cards — they do not reimplement training or promote gates.
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={universe}
            onChange={(_event, next: MlUniverseId | null) => {
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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 1 }}>
            {selectedUniverse.blurb}
          </Typography>
          <Stack spacing={0.25}>
            <Box component="code" sx={{ fontSize: 12, color: 'primary.main' }}>
              {npmFor('ml_lifecycle_full', universe)}
            </Box>
            <Box component="code" sx={{ fontSize: 12, color: 'primary.main' }}>
              {npmFor('ml_lifecycle_refresh', universe)}
            </Box>
            <Box component="code" sx={{ fontSize: 12, color: 'primary.main' }}>
              {npmFor('train_all', universe)}
            </Box>
            <Box component="code" sx={{ fontSize: 12, color: 'primary.main' }}>
              {npmFor('predict_all', universe)}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {catalog.map((item) => (
          <Grid item xs={12} md={isWideCard(item.kind) ? 12 : 4} key={item.kind}>
            <Card
              variant="outlined"
              sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {JOB_TITLES[item.kind] ?? item.title}
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
                  disabled={
                    !loggedIn ||
                    running ||
                    startState.isLoading ||
                    (item.kind === 'predict_all' && !modelsTrained) ||
                    (item.kind === 'ml_backtest' && !modelsTrained) ||
                    (item.kind === 'ml_lifecycle_refresh' && !modelsTrained)
                  }
                  onClick={() => {
                    void startJob({ kind: item.kind, universe }).then(() => {
                      logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    });
                  }}
                >
                  {item.kind === 'ml_lifecycle_full'
                    ? `Run full lifecycle · ${selectedUniverse.label}`
                    : item.kind === 'ml_lifecycle_refresh'
                      ? `Refresh predictions · ${selectedUniverse.label}`
                      : item.kind === 'run_all'
                        ? `Run all · ${selectedUniverse.label}`
                        : `Run ${selectedUniverse.label}`}
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" id="ml-lab-live-run" sx={{ scrollMarginTop: 16 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Live console
            </Typography>
            {job ? (
              <Chip size="small" color={STATUS_COLOR[job.status] ?? 'default'} label={job.status} />
            ) : (
              <Chip size="small" label="idle" />
            )}
            {job?.universe && (
              <Chip size="small" color="primary" variant="outlined" label={job.universe} />
            )}
            {job?.kind && (
              <Chip
                size="small"
                variant="outlined"
                label={
                  job.universe
                    ? npmFor(job.kind, job.universe)
                    : job.npm || npmFor(job.kind, universe)
                }
              />
            )}
            {running && (
              <Button
                size="small"
                color="warning"
                disabled={cancelState.isLoading}
                onClick={() => void cancelJob()}
              >
                Cancel
              </Button>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {job
              ? `${job.stage}${job.total ? ` · ${job.current}/${job.total}` : ''} · ${job.percent}%`
              : 'No job yet. Pick a universe, then a card above.'}
          </Typography>
          <LinearProgress
            variant={running && job.percent < 3 ? 'indeterminate' : 'determinate'}
            value={job?.percent ?? 0}
            sx={{ mb: 2, height: 10, borderRadius: 1 }}
          />
          {startState.isError && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {(startState.error as { data?: { message?: string; detail?: string } })?.data
                ?.detail ||
                (startState.error as { data?: { message?: string } })?.data?.message ||
                'Could not start the job. Another run may already be in progress.'}
            </Alert>
          )}
          <Box
            ref={logRef}
            component="pre"
            sx={{
              m: 0,
              p: 2,
              height: 380,
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
            {(job?.lines ?? ['Waiting for a run…']).join('\n')}
          </Box>
        </CardContent>
      </Card>
    </>
  );
}
