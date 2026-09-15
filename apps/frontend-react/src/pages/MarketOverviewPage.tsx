/**
 * Market Overview — layman dashboard from latest BatchResearchReport only.
 * No FE ranking / Bull-Run calculation. Probabilities are estimates, not guarantees.
 */
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
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
import { useGetLatestBatchResearchReportQuery } from '../store/api';

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return 'Not available';
  return `${(p * 100).toFixed(0)}%`;
}

function fmtTarget(t: number | undefined): string {
  if (t == null) return 'Not available';
  return `≥ +${(t * 100).toFixed(0)}%`;
}

export default function MarketOverviewPage(): JSX.Element {
  const { data, isLoading, isError } = useGetLatestBatchResearchReportQuery();

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (isError || !data?.available || !data.report) {
    return (
      <Box sx={{ p: 2, maxWidth: 960 }}>
        <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
          Market Intelligence
        </Typography>
        <Alert severity="info">
          Latest batch research report: <strong>Not available</strong>
          {data?.reason ? ` — ${data.reason}` : ''}.
          {data?.missingCapability ? ` Missing capability: ${data.missingCapability}.` : ''} Run a
          batch from <RouterLink to="/batch">Batch Center</RouterLink> to populate this dashboard.
          Values are never fabricated.
        </Alert>
      </Box>
    );
  }

  const r = data.report;
  const countsByHorizon = ['1D', '1W', '1M', '3M', '6M', '12M'].map((h) => {
    const rows = r.bullRunCountsByHorizon.filter((c) => c.horizon === h);
    const total = rows.reduce((s, c) => s + (c.candidateCount || 0), 0);
    return { h, total };
  });

  return (
    <Box sx={{ p: 2, maxWidth: 1100 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-start' }}
        sx={{ mb: 2 }}
        gap={1}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Market Intelligence
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Latest: {r.universe} · Batch {r.batchId}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Data: ${r.dataStatus ?? 'UNKNOWN'}`} />
          <Chip
            size="small"
            label={`Coverage ${r.coverage.processed}/${r.coverage.total}`}
            variant="outlined"
          />
          <Chip size="small" label={r.outcome} color="default" variant="outlined" />
        </Stack>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        {r.disclaimer}
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Bull-Run outlook (AVAILABLE candidates with p≥50%)
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {countsByHorizon.map((c) => (
            <Box key={c.h} sx={{ minWidth: 72, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                {c.h}
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                {c.total}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Sector rotation
        </Typography>
        <Typography variant="body2">
          Leading: {(r.sectorRotation?.leading ?? []).join(' · ') || 'Not available'}
        </Typography>
        <Typography variant="body2">
          Improving: {(r.sectorRotation?.improving ?? []).join(' · ') || 'Not available'}
        </Typography>
        <Typography variant="body2">
          Weakening: {(r.sectorRotation?.weakening ?? []).join(' · ') || 'Not available'}
        </Typography>
        <Typography variant="body2">
          Lagging: {(r.sectorRotation?.lagging ?? []).join(' · ') || 'Not available'}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          <RouterLink to="/sectors">Sector overview →</RouterLink>
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Best opportunities (canonical RankingContext order)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Target × Horizon specific. Intelligence pick ≠ Execution Ready.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Rank</TableCell>
              <TableCell>Stock</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Horizon</TableCell>
              <TableCell>Probability</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell>Recommendation</TableCell>
              <TableCell>Execution Ready</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {r.bestOpportunities.slice(0, 10).map((o) => (
              <TableRow key={o.symbol}>
                <TableCell>{o.rank}</TableCell>
                <TableCell>
                  <RouterLink to={`/bull-run?symbol=${encodeURIComponent(o.symbol)}`}>
                    {o.symbol}
                  </RouterLink>
                </TableCell>
                <TableCell>{fmtTarget(o.targetReturn)}</TableCell>
                <TableCell>{o.horizon ?? 'Not available'}</TableCell>
                <TableCell>{fmtPct(o.probability)}</TableCell>
                <TableCell>{o.confidence ?? 'Not available'}</TableCell>
                <TableCell>{o.recommendation ?? 'Not available'}</TableCell>
                <TableCell>
                  {o.tradePlanExecutionReady === true
                    ? 'YES'
                    : o.tradePlanExecutionReady === false
                      ? 'NO'
                      : 'Not available'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        Data quality: analyzed {r.dataQuality.analyzed}, incomplete {r.dataQuality.incomplete},
        quote gaps {r.dataQuality.quoteGaps}, fabricated {r.dataQuality.fabricated} (must stay 0).{' '}
        <RouterLink to="/research-reports">Research reports →</RouterLink>
      </Typography>
    </Box>
  );
}
