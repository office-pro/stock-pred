import { Alert, Chip, Stack, Typography } from '@mui/material';
import { useGetMarketDataContractQuery } from '../store/api';

/**
 * Status / explanation only — never authorization.
 * Do not use liveUsable or DELAYED to enable/disable Approve.
 */
export default function DataReliabilityStrip(): JSX.Element {
  const { data, isError, isFetching } = useGetMarketDataContractQuery(undefined, {
    pollingInterval: 15_000,
  });

  if (isError) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Market data contract unavailable — freshness status Not available.
      </Alert>
    );
  }

  if (!data) {
    return (
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {isFetching ? 'Loading data reliability…' : 'Data reliability: Not available'}
      </Typography>
    );
  }

  const status = data.quoteStatus;
  const color =
    status === 'LIVE'
      ? 'success'
      : status === 'DELAYED'
        ? 'warning'
        : status === 'STALE' || status === 'UNKNOWN'
          ? 'error'
          : 'default';

  const ageMs =
    data.sampleUpdatedAt != null && Number.isFinite(data.sampleUpdatedAt)
      ? Date.now() - data.sampleUpdatedAt
      : null;
  const ageLabel =
    ageMs == null
      ? null
      : ageMs < 1000
        ? `${Math.round(ageMs)}ms`
        : ageMs < 60_000
          ? `${Math.round(ageMs / 1000)}s`
          : `${(ageMs / 60_000).toFixed(1)}m`;

  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          label={data.nseCashSessionOpen ? 'NSE OPEN' : 'NSE CLOSED'}
          color={data.nseCashSessionOpen ? 'success' : 'default'}
        />
        <Chip size="small" color={color} label={ageLabel ? `${status} ${ageLabel}` : status} />
        <Chip size="small" variant="outlined" label={`Ingest ${data.ingestMode}`} />
        <Typography variant="caption" color="text.secondary">
          liveUsable={String(data.liveUsable)} (display only — not approval gate). DELAYED does not
          block by freshness alone; STALE still fails Risk.
        </Typography>
      </Stack>
    </Alert>
  );
}
