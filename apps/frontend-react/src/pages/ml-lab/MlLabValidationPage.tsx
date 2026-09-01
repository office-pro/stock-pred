import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { type MlWalkForwardHorizon, useGetMlEvaluationsQuery } from '../../store/api';

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function horizonEntries(
  walkForward: Record<string, unknown> | undefined,
): Array<[string, MlWalkForwardHorizon]> {
  if (!walkForward) return [];
  const horizons = (walkForward.horizons as Record<string, MlWalkForwardHorizon> | undefined) ?? {};
  return Object.entries(horizons);
}

function holdoutRows(
  holdout: Record<string, unknown> | undefined,
): Array<[string, Record<string, unknown>]> {
  if (!holdout) return [];
  return Object.entries(holdout).filter(
    ([key, value]) => key !== 'disclaimer' && value != null && typeof value === 'object',
  ) as Array<[string, Record<string, unknown>]>;
}

/** Phase 3: read-only holdout + walk-forward artifacts (M2). */
export default function MlLabValidationPage(): JSX.Element {
  const { data, isLoading, isError } = useGetMlEvaluationsQuery(undefined, {
    pollingInterval: 30_000,
  });

  const wfPresent =
    Boolean(data?.present?.walkForward) ||
    Boolean(data?.walkForward && Object.keys(data.walkForward).length);
  const holdoutPresent =
    Boolean(data?.present?.holdout) || Boolean(data?.holdout && Object.keys(data.holdout).length);
  const horizons = horizonEntries(data?.walkForward);
  const holdouts = holdoutRows(data?.holdout);

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading validation reports…</Typography>;
  }

  if (isError) {
    return (
      <Alert severity="error">
        Could not load <code>/ml/evaluations</code>. Is ml-engine running?
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Surfaces existing M2 <code>holdout.json</code> and <code>walkforward.json</code>. Run train
        / walk-forward from{' '}
        <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
          Jobs
        </Box>
        . Promote stays on{' '}
        <Box component={RouterLink} to="/ml-lab/registry" sx={{ fontWeight: 600 }}>
          Registry
        </Box>{' '}
        (server gates).
      </Typography>

      <Alert severity="info" variant="outlined">
        Validation metrics are <strong>ML promotion evidence only</strong>. They do not change Risk
        → Portfolio → Policy → Gate.
      </Alert>

      {data?.note ? (
        <Alert severity="success" variant="outlined">
          {data.note}
        </Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Walk-forward
          </Typography>
          {!wfPresent ? (
            <Alert severity="warning">
              No walk-forward report. Run <strong>Walk-forward</strong> from Jobs to write{' '}
              <code>walkforward.json</code>.
            </Alert>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Universe: {String(data?.walkForward?.universe ?? '—')} · Days:{' '}
                {String(data?.walkForward?.days ?? '—')}
              </Typography>
              {horizons.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Report present but no horizon sections yet.
                </Typography>
              ) : (
                horizons.map(([horizon, report]) => {
                  const stability = report.stability;
                  return (
                    <Card key={horizon} variant="outlined">
                      <CardContent>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                          sx={{ mb: 1 }}
                        >
                          <Typography variant="subtitle2" fontWeight={700}>
                            {horizon}
                          </Typography>
                          {stability ? (
                            <Chip
                              size="small"
                              color={stability.passed ? 'success' : 'error'}
                              label={stability.passed ? 'STABLE' : 'UNSTABLE'}
                            />
                          ) : null}
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`hit ${fmtNum(report.overallHitRate ?? stability?.meanHitRate)}`}
                          />
                        </Stack>
                        {stability ? (
                          <Stack
                            direction="row"
                            spacing={1}
                            flexWrap="wrap"
                            useFlexGap
                            sx={{ mb: 1 }}
                          >
                            <Chip size="small" label={`folds ${stability.foldCount ?? '—'}`} />
                            <Chip size="small" label={`mean ${fmtNum(stability.meanHitRate)}`} />
                            <Chip size="small" label={`std ${fmtNum(stability.hitRateStd)}`} />
                            <Chip
                              size="small"
                              label={`worst ${fmtNum(stability.worstFoldHitRate)}`}
                            />
                          </Stack>
                        ) : null}
                        {(stability?.failures?.length ?? 0) > 0 ? (
                          <Alert severity="error" sx={{ mb: 1 }}>
                            {(stability?.failures ?? []).join(' · ')}
                          </Alert>
                        ) : null}
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Fold</TableCell>
                              <TableCell>Year</TableCell>
                              <TableCell align="right">Hit rate</TableCell>
                              <TableCell align="right">N</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(report.folds ?? []).map((fold, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{idx + 1}</TableCell>
                                <TableCell>{String(fold.year ?? '—')}</TableCell>
                                <TableCell align="right">
                                  {fmtNum(
                                    (fold.overallHitRate as number | undefined) ??
                                      (fold.hitRate as number | undefined),
                                  )}
                                </TableCell>
                                <TableCell align="right">
                                  {String(fold.scoredCalls ?? fold.n ?? fold.samples ?? '—')}
                                </TableCell>
                              </TableRow>
                            ))}
                            {(report.folds ?? []).length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4}>
                                  <Typography variant="body2" color="text.secondary">
                                    No fold rows in this horizon report.
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Holdout
          </Typography>
          {!holdoutPresent ? (
            <Alert severity="warning">
              No holdout report. Train direction models from Jobs to write <code>holdout.json</code>
              .
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Horizon</TableCell>
                  <TableCell align="right">Hit rate</TableCell>
                  <TableCell align="right">Scored</TableCell>
                  <TableCell align="right">Holdout days</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holdouts.map(([horizon, row]) => (
                  <TableRow key={horizon}>
                    <TableCell>{horizon}</TableCell>
                    <TableCell align="right">
                      {fmtNum(row.overallHitRate as number | undefined)}
                    </TableCell>
                    <TableCell align="right">
                      {String(row.scoredCalls ?? row.holdoutSamples ?? '—')}
                    </TableCell>
                    <TableCell align="right">{String(row.holdoutDays ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
