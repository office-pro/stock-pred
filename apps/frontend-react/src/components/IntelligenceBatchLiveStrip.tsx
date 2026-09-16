import { Box, Button, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useListIntelligenceBatchesQuery } from '../store/api';

const LIVE_STATUSES = new Set(['CREATED', 'QUEUED', 'RUNNING', 'RESUMING', 'PAUSED']);

/**
 * Global strip — backend batch status only (poll while active).
 * Pause/resume continue from checkpoint on the server.
 */
export default function IntelligenceBatchLiveStrip(): JSX.Element | null {
  const { data: batches = [] } = useListIntelligenceBatchesQuery(
    { limit: 10 },
    { pollingInterval: 3_000 },
  );

  const active =
    batches.find((b) => LIVE_STATUSES.has(b.status) && b.status !== 'PAUSED') ??
    batches.find((b) => b.status === 'PAUSED') ??
    null;

  if (!active) return null;

  const percent = active.progress?.percent ?? 0;
  const processed = active.progress?.processed ?? 0;
  const total = active.progress?.total ?? 0;
  const isPaused = active.status === 'PAUSED';
  const isLive = active.status === 'RUNNING' || active.status === 'RESUMING';

  return (
    <Box
      sx={{
        px: 2,
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: isPaused ? 'action.hover' : 'background.default',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={active.status}
            color={isPaused ? 'warning' : isLive ? 'success' : 'default'}
            variant="outlined"
          />
          <Typography variant="body2" fontWeight={600}>
            Intelligence Batch · {active.universe}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {processed}/{total} ({percent}%)
            {isPaused ? ' · paused' : isLive ? ' · analyzing symbols…' : ''}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: { sm: 220 } }}>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{ flex: 1, height: 6, borderRadius: 1 }}
          />
          <Button component={RouterLink} to="/batch" size="small" variant="text">
            {isPaused ? 'Continue' : 'Open'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
