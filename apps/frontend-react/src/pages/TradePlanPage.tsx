/**
 * Trade Plan workspace — backend TradePlan / intelligence only.
 * Reuses OpportunityDetailPanel; does not authorize or invent fields.
 */
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { useGetIntelligenceBatchResultsQuery, useListIntelligenceBatchesQuery } from '../store/api';
import OpportunityDetailPanel from '../components/OpportunityDetailPanel';
import { confidenceChipColor } from '../lib/bull-run-display';

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
  const ctx = (row?.intelligenceContext ?? {}) as Record<string, unknown>;
  const rec = String(ctx.tradePlanRecommendation ?? 'Not available');
  const quality = String(ctx.opportunityQuality ?? 'Not available');
  const direction = String(ctx.tradePlanDirection ?? 'Not available');
  const horizon = String(ctx.tradePlanHorizon ?? 'Not available');
  const execReady = ctx.tradePlanExecutionReady === true;

  return (
    <Box sx={{ p: { xs: 1, md: 2 }, maxWidth: 1400 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        This is not investment advice. Predictions are probabilistic; there is no guarantee of
        profits. Paper trading is enabled by default — live trading requires explicit broker
        authorization. APPROVE ≠ authorization.
      </Alert>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        gap={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Trade Plan · {symbol || '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {row?.companyName ?? 'Company name Not available'}
            {typeof (row as { sector?: string } | undefined)?.sector === 'string'
              ? ` · ${(row as { sector?: string }).sector}`
              : ''}
            {row?.rank != null ? ` · Rank #${row.rank}` : ''}
            {batchId ? ` · ${batchId}` : ''}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            <Chip
              label={rec}
              color={
                rec === 'APPROVE'
                  ? 'success'
                  : rec === 'WAIT'
                    ? 'warning'
                    : rec === 'REJECT'
                      ? 'error'
                      : 'default'
              }
            />
            <Chip
              label={`Quality: ${quality}`}
              color={
                quality === 'HIGH'
                  ? 'success'
                  : quality === 'LOW'
                    ? 'error'
                    : quality === 'MEDIUM'
                      ? 'warning'
                      : 'default'
              }
              variant="outlined"
            />
            <Chip label={`Direction: ${direction}`} color="info" variant="outlined" />
            <Chip label={`Horizon: ${horizon}`} variant="outlined" />
            <Chip
              label={execReady ? 'EXECUTION-READY' : 'NOT EXECUTION-READY'}
              color={execReady ? 'success' : 'error'}
              size="small"
            />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" component={RouterLink} to="/agent" variant="contained">
            Open Desk
          </Button>
          <Button size="small" component={RouterLink} to="/advanced/decision" variant="outlined">
            Decision Center
          </Button>
          <Button size="small" component={RouterLink} to="/batch" variant="outlined">
            Batch Center
          </Button>
        </Stack>
      </Stack>

      {!row && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No batch result for this symbol yet. Run a batch from{' '}
          <Typography component={RouterLink} to="/batch" variant="body2">
            Batch Center
          </Typography>
          .
        </Alert>
      )}

      {row ? (
        <Paper variant="outlined" sx={{ p: 2, minHeight: 640 }}>
          <OpportunityDetailPanel
            row={{
              symbol: row.symbol,
              companyName: row.companyName,
              rank: row.rank,
              exchange: row.exchange,
              sector:
                typeof (row as { sector?: string }).sector === 'string'
                  ? (row as { sector?: string }).sector
                  : typeof ctx.sectorState === 'string'
                    ? ctx.sectorState
                    : undefined,
              price: row.price,
              opportunityId: row.opportunityId,
              intelligenceContext: ctx,
              recommendation:
                typeof ctx.tradePlanRecommendation === 'string'
                  ? ctx.tradePlanRecommendation
                  : undefined,
              tradePlanExecutionReady:
                typeof ctx.tradePlanExecutionReady === 'boolean'
                  ? ctx.tradePlanExecutionReady
                  : undefined,
              tradePlanStatus:
                typeof ctx.tradePlanStatus === 'string' ? ctx.tradePlanStatus : undefined,
              tradePlanExpectedR:
                typeof ctx.tradePlanExpectedR === 'number' ? ctx.tradePlanExpectedR : undefined,
              tradePlanHorizon:
                typeof ctx.tradePlanHorizon === 'string' ? ctx.tradePlanHorizon : undefined,
              invalidationPrice:
                typeof ctx.invalidationPrice === 'number' ? ctx.invalidationPrice : undefined,
              integrityStatus:
                typeof ctx.integrityStatus === 'string' ? ctx.integrityStatus : undefined,
              thesis: typeof ctx.thesis === 'string' ? ctx.thesis : undefined,
            }}
            batchId={batchId}
            initialTab="Trade Plan"
          />
        </Paper>
      ) : null}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
        Confidence chips use backend labels only
        {ctx.tradePlanConfidence != null
          ? ` (tradePlanConfidence=${String(ctx.tradePlanConfidence)}; ≠ probability)`
          : ''}
        . Reliability colors: {confidenceChipColor(String(ctx.bullRunConfidence ?? ''))}.
      </Typography>
    </Box>
  );
}
