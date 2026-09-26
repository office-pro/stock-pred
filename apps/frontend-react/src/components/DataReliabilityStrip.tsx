import { Alert, Chip, Stack, Typography } from '@mui/material';
import { useGetMarketDataContractQuery, useGetMarketSessionStateQuery } from '../store/api';

/**
 * Status / explanation only — never authorization.
 * Do not use liveUsable or DELAYED to enable/disable Approve.
 * Session OPEN/CLOSED comes from backend MarketSessionState — not FE clock.
 */
export default function DataReliabilityStrip(): JSX.Element {
  const { data, isError, isFetching } = useGetMarketDataContractQuery(undefined, {
    pollingInterval: 15_000,
  });
  const { data: sessionCard } = useGetMarketSessionStateQuery(undefined, {
    pollingInterval: 15_000,
  });

  if (isError && !sessionCard) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Market data contract unavailable — freshness status Not available.
      </Alert>
    );
  }

  if (!data && !sessionCard) {
    return (
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {isFetching ? 'Loading data reliability…' : 'Data reliability: Not available'}
      </Typography>
    );
  }

  const status = data?.quoteStatus ?? 'UNKNOWN';
  const color =
    status === 'LIVE'
      ? 'success'
      : status === 'DELAYED'
        ? 'warning'
        : status === 'STALE' || status === 'UNKNOWN'
          ? 'error'
          : 'default';

  const ageMs =
    data?.sampleUpdatedAt != null && Number.isFinite(data.sampleUpdatedAt)
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

  const nseSession = sessionCard?.nse;
  const sessionLabel = nseSession
    ? `NSE ${nseSession.status}${nseSession.isLive ? ' • LIVE' : ''}`
    : 'NSE Not available';

  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0.5 }}>
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={sessionLabel}
            color={nseSession?.status === 'OPEN' ? 'success' : 'default'}
          />
          <Chip size="small" color={color} label={ageLabel ? `${status} ${ageLabel}` : status} />
          <Chip
            size="small"
            variant="outlined"
            label={`Ingest ${data?.ingestMode ?? 'Not available'}`}
          />
          <Typography variant="caption" color="text.secondary">
            liveUsable={data ? String(data.liveUsable) : 'Not available'} (display only — not
            approval gate). ExecutionReady is backend-owned only.
          </Typography>
        </Stack>
        {sessionCard?.sessions?.length ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography variant="caption" fontWeight={700} sx={{ mr: 0.5 }}>
              MARKETS
            </Typography>
            {sessionCard.sessions.map((s) => (
              <Chip
                key={s.venue}
                size="small"
                variant="outlined"
                label={`${s.venue} ${s.liveLabel}`}
                color={s.status === 'OPEN' && s.dataStatus === 'LIVE' ? 'success' : 'default'}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  );
}
