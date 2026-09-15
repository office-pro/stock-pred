import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { useGetIntelligenceBatchResultsQuery, useListIntelligenceBatchesQuery } from '../store/api';

/**
 * B8 Trade Plan card — renders backend TradePlan / compact labels only.
 * Does not generate plans, scores, or authorization.
 */
export default function TradePlanPage(): JSX.Element {
  const { symbol = '' } = useParams();
  const [params] = useSearchParams();
  const opportunityId = params.get('opportunityId');
  const { data: batches = [] } = useListIntelligenceBatchesQuery({ limit: 5 });
  const batchId = batches[0]?.batchId;
  const { data: results } = useGetIntelligenceBatchResultsQuery(
    {
      id: batchId!,
      page: 1,
      pageSize: 100,
      q: symbol || undefined,
      sort: 'rank',
      order: 'asc',
    },
    { skip: !batchId },
  );

  const row = results?.rankings?.find(
    (r) =>
      r.symbol.toUpperCase() === symbol.toUpperCase() &&
      (!opportunityId || r.opportunityId === opportunityId),
  );
  const ctx = row?.intelligenceContext ?? {};

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Trade Plan · {symbol || '—'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Explains the backend advisory TradePlan. APPROVE / WAIT / REJECT here are advisory —
        authorization still requires evaluateTrade → Risk → Portfolio → Policy → Gate.
      </Typography>

      {!row && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No batch result for this symbol yet. Run a batch from{' '}
          <Typography component={RouterLink} to="/batch" variant="body2">
            Batch Center
          </Typography>
          .
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Chip
            label={`Recommendation: ${String(ctx.tradePlanRecommendation ?? 'Not available')}`}
          />
          <Chip label={`Quality: ${String(ctx.opportunityQuality ?? 'Not available')}`} />
          <Chip label={`Lifecycle: ${String(ctx.intelligenceLifecycleState ?? 'Not available')}`} />
        </Stack>
        <Typography variant="body2">
          Direction: {String(ctx.tradePlanDirection ?? 'Not available')}
        </Typography>
        <Typography variant="body2">
          Horizon: {String(ctx.tradePlanHorizon ?? 'Not available')}
        </Typography>
        <Typography variant="body2">
          Expected return:{' '}
          {ctx.expectedReturnLow != null && ctx.expectedReturnHigh != null
            ? `+${ctx.expectedReturnLow}–${ctx.expectedReturnHigh}%`
            : 'Not available'}
        </Typography>
        <Typography variant="body2">
          Buy zone:{' '}
          {ctx.buyZoneLow != null && ctx.buyZoneHigh != null
            ? `₹${ctx.buyZoneLow}–₹${ctx.buyZoneHigh}`
            : 'Not available'}
        </Typography>
        <Typography variant="body2">
          Expected R:{' '}
          {ctx.tradePlanExpectedR != null ? String(ctx.tradePlanExpectedR) : 'Not available'}
        </Typography>
        <Typography variant="body2">
          Confidence:{' '}
          {ctx.tradePlanConfidence != null ? String(ctx.tradePlanConfidence) : 'Not available'}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Upside probability:{' '}
          {ctx.upsideProbability != null
            ? `${(Number(ctx.upsideProbability) * 100).toFixed(0)}%`
            : ctx.mlProbUp != null
              ? `${(Number(ctx.mlProbUp) * 100).toFixed(0)}% (ML)`
              : 'Not available'}
        </Typography>
        <Typography variant="body2">
          Thesis state: {String(ctx.thesisState ?? 'Not available')}
        </Typography>
        <Typography variant="body2">
          Regime: {String(ctx.regimeCombo ?? 'Not available')}
        </Typography>
        <Typography variant="body2">
          Catalyst / event risk: {String(ctx.eventRisk ?? 'Not available')}
        </Typography>
      </Paper>

      <Alert severity="warning" sx={{ mb: 2 }}>
        This card does not place orders. Use Desk Approve to enter the existing authorization chain.
      </Alert>

      <Stack direction="row" spacing={1}>
        <Button component={RouterLink} to="/agent" variant="contained">
          Open Desk
        </Button>
        <Button component={RouterLink} to="/advanced/decision" variant="outlined">
          Decision Center
        </Button>
      </Stack>
    </Box>
  );
}
