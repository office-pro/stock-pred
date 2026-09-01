import {
  Alert,
  Box,
  Chip,
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
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useGetAllPredictionsQuery } from '../../store/api';

function driftColor(status?: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'ok') return 'success';
  if (status === 'warn' || status === 'insufficient_data') return 'warning';
  if (status === 'incompatible') return 'error';
  return 'default';
}

/** Phase 4: latest served predictions (existing ml-engine artifacts). */
export default function MlLabPredictionsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [horizon, setHorizon] = useState('');
  const { data, isLoading, isError } = useGetAllPredictionsQuery(
    { limit: 100, page: 1, search: search.trim() || undefined, horizon: horizon || undefined },
    { pollingInterval: 30_000 },
  );

  const rows = data?.predictions ?? [];

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading predictions…</Typography>;
  }

  if (isError) {
    return (
      <Alert severity="error">
        Could not load <code>/predictions</code>. Is ml-engine running?
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Surfaces latest ACTIVE-model predictions from ml-engine (M4 serving). Run predict from{' '}
        <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
          Jobs
        </Box>
        . This page does not train models or authorize trades.
      </Typography>

      <Alert severity="info" variant="outlined">
        Predictions feed <strong>Trade Intelligence only</strong>. They never enter Risk → Portfolio
        → Policy → Gate.
      </Alert>

      {data?.note ? (
        <Alert severity="success" variant="outlined">
          {data.note}
        </Alert>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small"
          label="Search symbol"
          value={search}
          onChange={(event) => setSearch(event.target.value.toUpperCase())}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          select
          label="Horizon"
          value={horizon}
          onChange={(event) => setHorizon(event.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="NEXT_DAY">NEXT_DAY</MenuItem>
          <MenuItem value="NEXT_WEEK">NEXT_WEEK</MenuItem>
        </TextField>
        <Chip
          size="small"
          label={`${data?.total ?? rows.length} total`}
          sx={{ alignSelf: 'center' }}
        />
      </Stack>

      {rows.length === 0 ? (
        <Alert severity="warning">
          No predictions yet. Start <code>predict_all</code> from Jobs after an ACTIVE model exists.
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
                <TableCell align="right">Expected move</TableCell>
                <TableCell>Drift</TableCell>
                <TableCell>Model</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.symbol}-${row.horizon}`}>
                  <TableCell>{row.symbol}</TableCell>
                  <TableCell>{row.horizon}</TableCell>
                  <TableCell>{row.direction}</TableCell>
                  <TableCell align="right">{(Number(row.confidence) * 100).toFixed(1)}%</TableCell>
                  <TableCell align="right">
                    {row.expectedMove == null ? '—' : `${Number(row.expectedMove).toFixed(2)}%`}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={driftColor(row.driftStatus)}
                      label={row.driftStatus ?? '—'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" component="span">
                      {row.modelId ? `${row.modelId.slice(0, 8)}…` : (row.modelVersion ?? '—')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
