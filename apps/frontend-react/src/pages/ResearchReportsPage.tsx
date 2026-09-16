/**
 * Research Reports — latest / selected BatchResearchReport. Backend-owned only.
 */
import {
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import {
  useGetBatchResearchReportQuery,
  useGetLatestBatchResearchReportQuery,
  useListIntelligenceBatchesQuery,
} from '../store/api';

export default function ResearchReportsPage(): JSX.Element {
  const { data: batches } = useListIntelligenceBatchesQuery({ limit: 20 });
  const batchList = useMemo(() => {
    const list = Array.isArray(batches) ? batches : [];
    return list as Array<{ batchId: string; status: string; universe?: string }>;
  }, [batches]);
  const [selected, setSelected] = useState<string>('latest');
  const latest = useGetLatestBatchResearchReportQuery(undefined, {
    skip: selected !== 'latest',
  });
  const byId = useGetBatchResearchReportQuery(selected, {
    skip: selected === 'latest',
  });
  const payload = selected === 'latest' ? latest.data : byId.data;
  const loading = selected === 'latest' ? latest.isLoading : byId.isLoading;

  return (
    <Box sx={{ p: 2, maxWidth: 960 }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Research Reports
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Backend-owned projections from completed intelligence batches. Not fabricated dashboards.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Select
          size="small"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          sx={{ minWidth: 280 }}
        >
          <MenuItem value="latest">Latest available</MenuItem>
          {batchList
            .filter((b) => b.status === 'COMPLETED' || b.status === 'PARTIAL')
            .map((b) => (
              <MenuItem key={b.batchId} value={b.batchId}>
                {b.batchId} ({b.universe ?? '?'})
              </MenuItem>
            ))}
        </Select>
      </Stack>
      {loading ? <CircularProgress size={24} /> : null}
      {!loading && (!payload?.available || !payload.report) ? (
        <Alert severity="info">
          Research report Not available
          {payload?.reason ? `: ${payload.reason}` : ''}.
          {payload?.missingCapability ? ` Missing capability: ${payload.missingCapability}.` : ''}
        </Alert>
      ) : null}
      {payload?.available && payload.report ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            {(payload.report as { batchId?: string }).batchId}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', mt: 1 }}
          >
            {JSON.stringify(payload.report, null, 2)}
          </Typography>
        </Paper>
      ) : null}
    </Box>
  );
}
