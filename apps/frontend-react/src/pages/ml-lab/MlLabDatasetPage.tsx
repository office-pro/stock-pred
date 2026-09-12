import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetMlEvaluationsQuery } from '../../store/api';

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function fmtTs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return '—';
  return new Date(Number(ms)).toLocaleString();
}

/** Phase 3: read-only dataset-quality.json (M2 artifact). */
export default function MlLabDatasetPage(): JSX.Element {
  const { data, isLoading, isError } = useGetMlEvaluationsQuery(undefined, {
    pollingInterval: 30_000,
  });

  const dq = data?.datasetQuality;
  const present =
    Boolean(data?.present?.datasetQuality) || Boolean(dq && Object.keys(dq).length > 0);

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading dataset quality…</Typography>;
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
        Surfaces the existing M2 <code>dataset-quality.json</code> artifact. This page does not
        build datasets or train models — run train / ingest from{' '}
        <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
          Jobs
        </Box>
        .
      </Typography>

      <Alert severity="info" variant="outlined">
        Dataset quality feeds <strong>ML promote gates only</strong>. It does not authorize trades
        (Risk → Portfolio → Policy → Gate).
      </Alert>

      {!present ? (
        <Alert severity="warning">
          No dataset-quality report found. Train a candidate (Jobs → Train) to generate{' '}
          <code>dataset-quality.json</code>.
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              color={dq?.passed ? 'success' : 'error'}
              label={dq?.passed ? 'PASSED' : 'FAILED'}
            />
            {dq?.generatedAt ? (
              <Chip size="small" variant="outlined" label={`Generated ${dq.generatedAt}`} />
            ) : null}
            {dq?.schemaVersion ? (
              <Chip size="small" variant="outlined" label={String(dq.schemaVersion)} />
            ) : null}
          </Stack>

          <Grid container spacing={2}>
            {(
              [
                ['Rows', dq?.rows],
                ['Features', dq?.nFeatures],
                ['Symbols', dq?.symbols],
                ['Coverage', fmtPct(dq?.symbolCoverage)],
                ['Missing', fmtPct(dq?.missingRate)],
                ['PIT violations', (dq?.pitViolations ?? 0) + (dq?.pitMembershipViolations ?? 0)],
              ] as Array<[string, string | number | undefined]>
            ).map(([label, value]) => (
              <Grid item xs={6} sm={4} md={2} key={label}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {value ?? '—'}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Time range
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {fmtTs(dq?.timeMin)} → {fmtTs(dq?.timeMax)}
              </Typography>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                Class counts
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(dq?.classCounts ?? {}).map(([name, count]) => (
                  <Chip key={name} size="small" label={`${name}: ${count}`} />
                ))}
                {!Object.keys(dq?.classCounts ?? {}).length ? (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                ) : null}
              </Stack>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                Price policy
              </Typography>
              <Typography variant="body2" color="text.secondary">
                mode={dq?.pricePolicy?.mode ?? '—'} · version={dq?.pricePolicy?.version ?? '—'} ·
                unverified={dq?.pricePolicy?.unverifiedAdjustment ? 'yes' : 'no'}
              </Typography>
            </CardContent>
          </Card>

          {(dq?.hardFailures?.length ?? 0) > 0 ? (
            <Alert severity="error">
              <Typography fontWeight={700} gutterBottom>
                Hard failures
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {dq?.hardFailures?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </Box>
            </Alert>
          ) : null}

          {(dq?.warnings?.length ?? 0) > 0 ? (
            <Alert severity="warning">
              <Typography fontWeight={700} gutterBottom>
                Warnings
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {dq?.warnings?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </Box>
            </Alert>
          ) : null}

          {(dq?.pitExamples?.length ?? 0) > 0 ? (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  PIT examples
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Symbol</TableCell>
                      <TableCell>Feature ts</TableCell>
                      <TableCell>Available at</TableCell>
                      <TableCell>Detail</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dq?.pitExamples?.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{String(row.symbol ?? '—')}</TableCell>
                        <TableCell>{String(row.featureTimestamp ?? '—')}</TableCell>
                        <TableCell>{String(row.availableAt ?? '—')}</TableCell>
                        <TableCell>{String(row.detail ?? '—')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </Stack>
  );
}
