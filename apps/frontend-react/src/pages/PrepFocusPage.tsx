import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { authErrorMessage } from '../lib/auth-errors';
import { useGetFocusUniverseLatestQuery, useRunOfflineFocusBatchMutation } from '../store/api';
import { useState } from 'react';

/**
 * Pre-Market Intelligence — Focus Universe only.
 * Optimization / attention — not LIVE_READY, not authorization. No Approve.
 */
export default function PrepFocusPage(): JSX.Element {
  const { data, refetch, isFetching, isError } = useGetFocusUniverseLatestQuery(undefined, {
    pollingInterval: 60_000,
  });
  const [runOffline, runState] = useRunOfflineFocusBatchMutation();
  const [toast, setToast] = useState<{
    text: string;
    severity: 'success' | 'error' | 'info';
  } | null>(null);

  const candidates = data?.candidates ?? [];
  const t1 = candidates.filter((c) => c.focusTier === 1).length;
  const t2 = candidates.filter((c) => c.focusTier === 2).length;
  const t3 = candidates.filter((c) => c.focusTier === 3).length;
  const ageMs = data ? Date.now() - data.dataAsOf : null;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2 }}
        spacing={1}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Prep
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Offline Focus Intelligence — RankingContext order only.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            disabled={runState.isLoading}
            onClick={() => {
              void runOffline({ limit: 80 })
                .unwrap()
                .then((batch) => {
                  setToast({
                    severity: 'success',
                    text: `Focus batch ${batch.batchId}: ${batch.candidates.length} candidates (read-only)`,
                  });
                  void refetch();
                })
                .catch((err: unknown) => {
                  setToast({
                    severity: 'error',
                    text: authErrorMessage(err, 'Offline Focus batch failed'),
                  });
                });
            }}
          >
            Run Offline Focus Batch
          </Button>
          <Button component={RouterLink} to="/batch" variant="outlined">
            Intelligence Batch
          </Button>
        </Stack>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        <strong>Optimization only — not LIVE_READY / not authorization.</strong> No Approve, Buy, or
        Sell from this page.
      </Alert>

      {toast ? (
        <Alert severity={toast.severity} sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      ) : null}

      {isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load Focus Universe latest.
        </Alert>
      ) : null}

      {!data ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">
            No Focus batch yet. Run Offline Focus Batch to generate candidates.
          </Typography>
          <Button size="small" sx={{ mt: 1 }} onClick={() => void refetch()} disabled={isFetching}>
            Refresh
          </Button>
        </Paper>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Batch ${data.batchId}`} />
              <Chip
                variant="outlined"
                label={`dataAsOf ${new Date(data.dataAsOf).toLocaleString()}`}
              />
              <Chip variant="outlined" label={`Status ${data.dataStatus}`} />
              <Chip
                variant="outlined"
                label={
                  ageMs == null
                    ? 'Age Not available'
                    : `Age ${ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : `${(ageMs / 60_000).toFixed(1)}m`}`
                }
              />
              <Chip color="primary" label={`T1 ${t1}`} />
              <Chip color="primary" variant="outlined" label={`T2 ${t2}`} />
              <Chip variant="outlined" label={`T3 ${t3}`} />
              <Button size="small" component={RouterLink} to="/agent">
                Open Desk
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              RankingContext lexicographic order (no RankingScore). Backend candidate order
              preserved.
            </Typography>
          </Paper>

          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            All Candidates
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Tier</TableCell>
                  <TableCell>Ranking reason</TableCell>
                  <TableCell>Sector</TableCell>
                  <TableCell>Data status</TableCell>
                  <TableCell>Age</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((row) => (
                  <TableRow key={`${row.rank}-${row.symbol}`}>
                    <TableCell>
                      <Typography
                        component={RouterLink}
                        to={`/stocks/${row.symbol}`}
                        fontWeight={700}
                        sx={{ textDecoration: 'none' }}
                      >
                        {row.symbol}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={`T${row.focusTier}`}
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        RankingContext rank {row.rank} → Focus tier {row.focusTier}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        Not available
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={data.dataStatus} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        batch-level
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {candidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        Batch has no candidates.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
