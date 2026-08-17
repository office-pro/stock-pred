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
  type MlJobKind,
  type MlUniverseId,
  type MlUniverseOption,
  useCancelMlJobMutation,
  useGetMlJobQuery,
  useStartMlJobMutation,
} from '../store/api';

const FALLBACK_JOBS: {
  kind: MlJobKind;
  title: string;
  npm: string;
  blurb: string;
}[] = [
  {
    kind: 'train_all',
    title: 'Train direction models',
    npm: 'npm run train:ml:all',
    blurb: 'XGBoost, LightGBM, LSTM and Transformer on ~1500 daily bars for the selected universe.',
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

function npmFor(kind: MlJobKind, universe: MlUniverseId): string {
  if (kind === 'train_all') {
    return universe === 'all' ? 'npm run train:ml:all' : `npm run train:ml:${universe}`;
  }
  if (kind === 'predict_all') {
    return universe === 'all' ? 'npm run predict:all' : `npm run predict:${universe}`;
  }
  return universe === 'all'
    ? 'npm run train:ml:manipulation'
    : `npm run train:ml:manipulation:${universe}`;
}

const JOB_TITLES: Record<MlJobKind, string> = {
  train_all: 'Train direction models',
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

const STATUS_COLOR: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'warning',
};

export default function MlLabPage(): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const loggedIn = Boolean(user);
  const { data, isError } = useGetMlJobQuery(undefined, {
    skip: !loggedIn,
    pollingInterval: 800,
  });
  const [startJob, startState] = useStartMlJobMutation();
  const [cancelJob, cancelState] = useCancelMlJobMutation();
  const [universe, setUniverse] = useState<MlUniverseId>('nifty50');
  const job = data?.job ?? null;
  const running = job?.status === 'running';
  const modelsTrained = Boolean(data?.modelsTrained);
  const catalog = data?.available?.length ? data.available : FALLBACK_JOBS;
  const universes = data?.universes?.length ? data.universes : FALLBACK_UNIVERSES;
  const selectedUniverse = universes.find((item) => item.id === universe) ?? FALLBACK_UNIVERSES[0];
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.lines.length, job?.percent]);

  return (
    <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        ML Lab
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Run the same jobs as the CLI, with live percent complete and a console of what Python is
        doing. Pick a smaller universe for a quicker pass. One job at a time. Predictions are
        probabilistic — not investment advice.
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
          Predict needs trained direction models. Run <b>Train direction models</b> first (
          <Box component="code" sx={{ fontSize: 12 }}>
            {npmFor('train_all', universe)}
          </Box>
          ). Nifty 50 train is enough to unlock Nifty 100/500 predict — the artifacts are shared.
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Universe
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Applies to train, predict, and unusual-activity. Selected run:{' '}
            <Box component="code" sx={{ fontSize: 12 }}>
              {npmFor('train_all', universe)}
            </Box>
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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {selectedUniverse.blurb}
          </Typography>
        </CardContent>
      </Card>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {catalog.map((item) => (
          <Grid item xs={12} md={4} key={item.kind}>
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
                  {npmFor(item.kind, universe)}
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
                    (item.kind === 'predict_all' && !modelsTrained)
                  }
                  onClick={() => void startJob({ kind: item.kind, universe })}
                >
                  Run {selectedUniverse.label}
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
              Live run
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
