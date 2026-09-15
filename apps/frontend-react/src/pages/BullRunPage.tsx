/**
 * Bull-Run Intelligence screen — Target×Horizon matrix from backend only.
 * Bars mirror backend probability text; no FE calculation / ranking.
 */
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import {
  useGetBullRunIntelligenceQuery,
  useListIntelligenceBatchesQuery,
  useGetIntelligenceBatchResultsQuery,
} from '../store/api';

const HORIZONS = ['1D', '1W', '1M', '3M', '6M', '12M'] as const;
const TARGETS = [0.05, 0.1, 0.2, 0.3, 0.5, 1.0] as const;

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return 'Not available';
  return `${(p * 100).toFixed(0)}%`;
}

function ProbBar({ p }: { p: number | null | undefined }): JSX.Element {
  if (p == null || !Number.isFinite(p)) {
    return <Typography variant="caption">Not available</Typography>;
  }
  const pct = Math.max(0, Math.min(100, p * 100));
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ flex: 1, height: 8, borderRadius: 1 }}
      />
      <Typography variant="caption" sx={{ width: 36 }}>
        {fmtPct(p)}
      </Typography>
    </Stack>
  );
}

export default function BullRunPage(): JSX.Element {
  const [symbol, setSymbol] = useState('TCS');
  const [horizonTab, setHorizonTab] = useState<(typeof HORIZONS)[number]>('3M');
  const [target, setTarget] = useState<number>(0.2);

  const { data: batches } = useListIntelligenceBatchesQuery({ limit: 5 });
  const latestId = useMemo(() => {
    const arr = (Array.isArray(batches) ? batches : []) as Array<{
      batchId?: string;
      status?: string;
    }>;
    return arr.find((b) => b.status === 'COMPLETED' || b.status === 'PARTIAL')?.batchId;
  }, [batches]);

  const { data: batchResults } = useGetIntelligenceBatchResultsQuery(
    { id: latestId ?? '', page: 1, pageSize: 50, sort: 'rank', order: 'asc', preset: 'BULL_RUN' },
    { skip: !latestId },
  );

  const {
    data: bull,
    isFetching,
    isError,
  } = useGetBullRunIntelligenceQuery(symbol, {
    skip: !symbol.trim(),
  });

  const cells = bull?.v2?.cells ?? [];
  const matrixCell = (h: string, t: number) =>
    cells.find((c) => c.horizon === h && Math.abs(c.targetReturn - t) < 1e-9);

  return (
    <Box sx={{ p: 2, maxWidth: 1200 }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Bull-Run Intelligence
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Bull-Run answers P(max forward return within H ≥ T). Probabilities are model estimates, not
        guarantees. Offline/stale analysis is not execution readiness. Auth path unchanged.
      </Alert>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Stock"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Target</InputLabel>
          <Select label="Target" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            {TARGETS.map((t) => (
              <MenuItem key={t} value={t}>
                ≥ +{(t * 100).toFixed(0)}%
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {bull?.v2?.dataStatus ? (
          <Chip
            size="small"
            label={`dataStatus: ${bull.v2.dataStatus}`}
            sx={{ alignSelf: 'center' }}
          />
        ) : null}
        {bull?.v2?.executionReadyFromBullRun === false ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="Not execution-ready from Bull-Run"
            sx={{ alignSelf: 'center' }}
          />
        ) : null}
      </Stack>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={horizonTab}
        onChange={(_, v) => v && setHorizonTab(v)}
        sx={{ mb: 2 }}
      >
        {HORIZONS.map((h) => (
          <ToggleButton key={h} value={h}>
            {h}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isFetching ? <CircularProgress size={24} /> : null}
      {isError ? <Alert severity="info">Bull-Run data Not available for {symbol}.</Alert> : null}

      {bull ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            {bull.symbol} · Stage: {bull.stage ?? 'Not available'} · Status: {bull.status}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Focus: Target ≥ +{(target * 100).toFixed(0)}% within {horizonTab}
          </Typography>
          {(() => {
            const c = matrixCell(horizonTab, target);
            if (!c || c.status !== 'AVAILABLE') {
              return (
                <Typography variant="body2">
                  Probability: Not available
                  {c?.reason ? ` (${c.reason})` : ''}
                </Typography>
              );
            }
            return (
              <Stack spacing={0.5}>
                <ProbBar p={c.probability} />
                <Typography variant="body2">
                  Confidence: {c.confidence ?? 'Not available'} (≠ probability)
                </Typography>
                <Typography variant="body2">
                  Expected return:{' '}
                  {c.expectedReturnRange
                    ? `${(c.expectedReturnRange.low * 100).toFixed(1)}% → ${(c.expectedReturnRange.high * 100).toFixed(1)}%`
                    : 'Not available'}
                </Typography>
                <Typography variant="body2">
                  Expected drawdown:{' '}
                  {c.expectedDrawdownRange
                    ? `${(c.expectedDrawdownRange.low * 100).toFixed(1)}% → ${(c.expectedDrawdownRange.high * 100).toFixed(1)}%`
                    : 'Not available'}
                </Typography>
              </Stack>
            );
          })()}

          <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
            Target × Horizon matrix (backend cells only)
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Horizon</TableCell>
                {TARGETS.map((t) => (
                  <TableCell key={t} align="right">
                    +{(t * 100).toFixed(0)}%
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {HORIZONS.map((h) => (
                <TableRow key={h}>
                  <TableCell>{h}</TableCell>
                  {TARGETS.map((t) => {
                    const c = matrixCell(h, t);
                    return (
                      <TableCell key={`${h}-${t}`} align="right">
                        {c?.status === 'AVAILABLE' ? fmtPct(c.probability) : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(bull.evidence?.length ?? 0) > 0 ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">Why?</Typography>
              <ul>
                {bull.evidence!.map((e) => (
                  <li key={e}>
                    <Typography variant="body2">{e}</Typography>
                  </li>
                ))}
              </ul>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ mt: 2 }}>
              Why? Not available
            </Typography>
          )}
          {(bull.invalidation?.length ?? 0) > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2">What could invalidate this?</Typography>
              <ul>
                {bull.invalidation!.map((e) => (
                  <li key={e}>
                    <Typography variant="body2">{e}</Typography>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {latestId && batchResults?.rankings?.length ? (
        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Latest batch Bull-Run preset (RankingContext order)
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rank</TableCell>
                <TableCell>Stock</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell>Recommendation</TableCell>
                <TableCell>Execution Ready</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {batchResults.rankings.slice(0, 25).map((row) => {
                const ctx = row.intelligenceContext as Record<string, unknown> | undefined;
                return (
                  <TableRow
                    key={row.symbol}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setSymbol(row.symbol)}
                  >
                    <TableCell>{row.rank}</TableCell>
                    <TableCell>{row.symbol}</TableCell>
                    <TableCell>{String(ctx?.bullRunStage ?? 'Not available')}</TableCell>
                    <TableCell>{String(ctx?.tradePlanRecommendation ?? 'Not available')}</TableCell>
                    <TableCell>
                      {ctx?.tradePlanExecutionReady === true
                        ? 'YES'
                        : ctx?.tradePlanExecutionReady === false
                          ? 'NO'
                          : 'Not available'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      ) : null}
    </Box>
  );
}
