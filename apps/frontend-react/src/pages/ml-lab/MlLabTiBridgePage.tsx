import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetMlTiBridgeQuery } from '../../store/api';

/** Phase 4: observational ML → Trade Intelligence usability bridge. */
export default function MlLabTiBridgePage(): JSX.Element {
  const { data, isLoading, isError } = useGetMlTiBridgeQuery(undefined, {
    pollingInterval: 30_000,
  });

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading TI bridge…</Typography>;
  }

  if (isError) {
    return (
      <Alert severity="error">
        Could not load <code>/market/ml-ti-bridge</code>. Is market-data-service running?
      </Alert>
    );
  }

  const rejected = data?.rejected;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Shows which cached ML predictions market-data currently treats as{' '}
        <strong>usable for Trade Intelligence / advisory</strong> (fresh + drift-compatible). This
        is a read-only bridge — it does not change TI logic or trading authorization.
      </Typography>

      <Alert severity="warning" variant="outlined">
        <strong>ML → TI only.</strong> Usable predictions never authorize BUY/SELL. Authorization
        remains Risk → Portfolio → Policy → Gate. See Agent Desk for decisions — not this Lab.
      </Alert>

      {data?.note ? (
        <Alert severity="info" variant="outlined">
          {data.note}
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Cached
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {data?.total ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Usable for TI
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.main">
                {data?.usable ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Rejected (not TI-usable)
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip size="small" label={`stale ${rejected?.stale ?? 0}`} />
                <Chip
                  size="small"
                  color="error"
                  label={`incompatible ${rejected?.incompatible ?? 0}`}
                />
                <Chip size="small" label={`missing expiry ${rejected?.missingExpiry ?? 0}`} />
                <Chip size="small" label={`other ${rejected?.other ?? 0}`} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="subtitle2" fontWeight={700}>
        By horizon
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {Object.entries(data?.byHorizon ?? {}).map(([horizon, bucket]) => (
          <Chip
            key={horizon}
            variant="outlined"
            label={`${horizon}: ${bucket.usable}/${bucket.total} usable`}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2" fontWeight={700}>
        Usable samples
      </Typography>
      {(data?.usableSamples?.length ?? 0) === 0 ? (
        <Alert severity="warning">
          No TI-usable predictions right now. Check{' '}
          <Box component={RouterLink} to="/ml-lab/predictions" sx={{ fontWeight: 600 }}>
            Predictions
          </Box>{' '}
          /{' '}
          <Box component={RouterLink} to="/ml-lab/monitoring" sx={{ fontWeight: 600 }}>
            Monitoring
          </Box>
          .
        </Alert>
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>Horizon</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell align="right">Confidence</TableCell>
                <TableCell>Drift</TableCell>
                <TableCell>Freshness</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.usableSamples ?? []).map((row) => (
                <TableRow key={`u-${row.symbol}-${row.horizon}`}>
                  <TableCell>{row.symbol}</TableCell>
                  <TableCell>{row.horizon}</TableCell>
                  <TableCell>{row.direction}</TableCell>
                  <TableCell align="right">{(Number(row.confidence) * 100).toFixed(1)}%</TableCell>
                  <TableCell>{row.driftStatus ?? '—'}</TableCell>
                  <TableCell>{row.freshnessStatus ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Typography variant="subtitle2" fontWeight={700}>
        Rejected samples
      </Typography>
      {(data?.rejectedSamples?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No rejected samples in the current cache snapshot.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>Horizon</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Drift</TableCell>
                <TableCell>Freshness</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.rejectedSamples ?? []).map((row) => (
                <TableRow key={`r-${row.symbol}-${row.horizon}-${row.rejectReason}`}>
                  <TableCell>{row.symbol}</TableCell>
                  <TableCell>{row.horizon}</TableCell>
                  <TableCell>{row.rejectReason ?? '—'}</TableCell>
                  <TableCell>{row.driftStatus ?? '—'}</TableCell>
                  <TableCell>{row.freshnessStatus ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
