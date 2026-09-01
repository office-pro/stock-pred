import { Alert, Box, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetMlOverviewQuery } from '../../store/api';

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function MlLabOverviewPage(): JSX.Element {
  const { data, isLoading, isError, error } = useGetMlOverviewQuery(undefined, {
    pollingInterval: 15_000,
  });

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading ML overview…</Typography>;
  }

  if (isError) {
    return (
      <Alert severity="error">
        Could not load overview.{' '}
        {(error as { data?: { message?: string } })?.data?.message ??
          'Is ml-engine and the API gateway running?'}
      </Alert>
    );
  }

  const counts = data?.counts;
  const job = data?.currentJob;
  const evals = data?.evaluationsPresent;

  return (
    <Stack spacing={2}>
      {data?.note ? (
        <Alert severity="success" variant="outlined">
          {data.note}
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Active models" value={counts?.active ?? 0} hint="Served for predict" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Candidates"
            value={counts?.candidate ?? 0}
            hint="Awaiting promote gates"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Retired" value={counts?.retired ?? 0} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Models trained (disk)"
            value={data?.modelsTrained ? 'Yes' : 'No'}
            hint="Direction artifacts present"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Active by horizon
              </Typography>
              <Stack spacing={1}>
                {Object.entries(data?.activeByHorizon ?? {}).map(([horizon, model]) => (
                  <Stack
                    key={horizon}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Chip size="small" label={horizon} />
                    {model ? (
                      <>
                        <Typography variant="body2" component="span">
                          {model.modelVersion}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="span">
                          {model.modelId.slice(0, 8)}…
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        None active
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
              <Typography variant="body2" sx={{ mt: 2 }}>
                Manage promotion on{' '}
                <Box component={RouterLink} to="/ml-lab/registry" sx={{ fontWeight: 600 }}>
                  Registry
                </Box>
                .
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Current job
              </Typography>
              {job ? (
                <Stack spacing={0.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" color="primary" label={String(job.status ?? 'unknown')} />
                    <Typography variant="body2">{job.kind}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {job.stage ?? '—'}
                    {job.universe ? ` · ${job.universe}` : ''}
                    {typeof job.percent === 'number' ? ` · ${job.percent}%` : ''}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Idle — start work from{' '}
                  <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
                    Jobs
                  </Box>
                  .
                </Typography>
              )}
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                Evaluation artifacts
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  color={evals?.holdout ? 'success' : 'default'}
                  label={`Holdout ${evals?.holdout ? 'yes' : 'no'}`}
                />
                <Chip
                  size="small"
                  color={evals?.walkForward ? 'success' : 'default'}
                  label={`Walk-forward ${evals?.walkForward ? 'yes' : 'no'}`}
                />
                <Chip
                  size="small"
                  color={evals?.mlBacktest ? 'success' : 'default'}
                  label={`ML backtest ${evals?.mlBacktest ? 'yes' : 'no'}`}
                />
                <Chip
                  size="small"
                  color={evals?.datasetQuality ? 'success' : 'default'}
                  label={`Dataset quality ${evals?.datasetQuality ? 'yes' : 'no'}`}
                />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                Open{' '}
                <Box component={RouterLink} to="/ml-lab/dataset" sx={{ fontWeight: 600 }}>
                  Dataset
                </Box>{' '}
                /{' '}
                <Box component={RouterLink} to="/ml-lab/validation" sx={{ fontWeight: 600 }}>
                  Validation
                </Box>{' '}
                /{' '}
                <Box component={RouterLink} to="/ml-lab/predictions" sx={{ fontWeight: 600 }}>
                  Predictions
                </Box>{' '}
                /{' '}
                <Box component={RouterLink} to="/ml-lab/monitoring" sx={{ fontWeight: 600 }}>
                  Monitoring
                </Box>{' '}
                /{' '}
                <Box component={RouterLink} to="/ml-lab/ti-bridge" sx={{ fontWeight: 600 }}>
                  TI Bridge
                </Box>{' '}
                /{' '}
                <Box component={RouterLink} to="/ml-lab/reports" sx={{ fontWeight: 600 }}>
                  Reports
                </Box>
                .
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
