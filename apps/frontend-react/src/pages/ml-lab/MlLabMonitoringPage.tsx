import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useGetMlDriftQuery, useGetPredictionAccuracyQuery } from '../../store/api';

function statusColor(status?: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'ok') return 'success';
  if (status === 'warn' || status === 'insufficient_data') return 'warning';
  if (status === 'incompatible') return 'error';
  return 'default';
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  // accuracy payloads may be 0–1 or already percent
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
}

/** Phase 4: M4 drift reports + scored accuracy (read-only). */
export default function MlLabMonitoringPage(): JSX.Element {
  const [horizon, setHorizon] = useState('NEXT_DAY');
  const {
    data: drift,
    isLoading: driftLoading,
    isError: driftError,
  } = useGetMlDriftQuery(undefined, { pollingInterval: 60_000 });
  const {
    data: accuracy,
    isLoading: accLoading,
    isError: accError,
  } = useGetPredictionAccuracyQuery({ horizon }, { pollingInterval: 60_000 });

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Monitoring surfaces existing M4 drift stamps and scored accuracy. It does not auto-retrain
        or change promote gates — use{' '}
        <Box component={RouterLink} to="/ml-lab/registry" sx={{ fontWeight: 600 }}>
          Registry
        </Box>{' '}
        /{' '}
        <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
          Jobs
        </Box>
        .
      </Typography>

      <Alert severity="info" variant="outlined">
        Drift / accuracy are <strong>ML criteria only</strong>. They do not authorize trades (Risk →
        Portfolio → Policy → Gate).
      </Alert>

      {drift?.note ? (
        <Alert severity="success" variant="outlined">
          {drift.note}
        </Alert>
      ) : null}

      <Typography variant="subtitle1" fontWeight={700}>
        Drift by horizon
      </Typography>
      {driftLoading && !drift ? (
        <Typography color="text.secondary">Loading drift reports…</Typography>
      ) : null}
      {driftError ? (
        <Alert severity="warning">
          Could not load <code>/ml/drift</code>. Reports appear after predictions run with ACTIVE
          models.
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        {Object.entries(drift?.horizons ?? {}).map(([hz, report]) => {
          const present = Boolean(drift?.present?.[hz]);
          const status = typeof report?.status === 'string' ? report.status : undefined;
          const reasons = Array.isArray(report?.reasons) ? (report.reasons as string[]) : [];
          return (
            <Grid item xs={12} md={6} key={hz}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography fontWeight={700}>{hz}</Typography>
                    <Chip
                      size="small"
                      color={present ? statusColor(status) : 'default'}
                      label={present ? (status ?? 'present') : 'missing'}
                    />
                  </Stack>
                  {!present ? (
                    <Typography variant="body2" color="text.secondary">
                      No <code>drift/{hz}.json</code> yet.
                    </Typography>
                  ) : (
                    <Stack spacing={0.5}>
                      {report.outcomeSampleSize != null ? (
                        <Typography variant="body2">
                          Outcome samples: {String(report.outcomeSampleSize)}
                        </Typography>
                      ) : null}
                      {reasons.slice(0, 4).map((reason) => (
                        <Typography key={reason} variant="caption" color="text.secondary">
                          • {reason}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Accuracy
        </Typography>
        <TextField
          size="small"
          select
          label="Horizon"
          value={horizon}
          onChange={(event) => setHorizon(event.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="NEXT_DAY">NEXT_DAY</MenuItem>
          <MenuItem value="NEXT_WEEK">NEXT_WEEK</MenuItem>
        </TextField>
      </Stack>

      {accLoading && !accuracy ? (
        <Typography color="text.secondary">Loading accuracy…</Typography>
      ) : null}
      {accError ? (
        <Alert severity="warning">
          Accuracy not scored yet. Run <code>python -m app.score</code> (or wait for the prediction
          loop).
        </Alert>
      ) : null}

      {accuracy ? (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                label={`Hit rate ${fmtPct(
                  (accuracy as { overallHitRate?: number }).overallHitRate ??
                    (accuracy as { hitRate?: number }).hitRate,
                )}`}
              />
              <Chip
                variant="outlined"
                label={`n=${
                  (accuracy as { scoredCalls?: number }).scoredCalls ??
                  (accuracy as { sessions?: number }).sessions ??
                  '—'
                }`}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Scored track record is observational — not a Gate input.
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
