import { Alert, Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetAgentOpportunitiesQuery } from '../store/api';

/** WAIT Intelligence advanced view — existing contracts; advisory. */
export default function WaitIntelligencePage(): JSX.Element {
  const { data } = useGetAgentOpportunitiesQuery({ limit: 25 });
  const byId = data?.waitIntelligenceById ?? {};
  const entries = Object.entries(byId);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        WAIT Intelligence
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        WAIT explains why entry is deferred (PRICE / TIME / EVENT / UNAVAILABLE). Actions remain on{' '}
        <Typography component={RouterLink} to="/agent" variant="body2">
          Desk
        </Typography>
        .
      </Alert>
      {entries.length === 0 ? (
        <Typography color="text.secondary">
          No WAIT payloads on current opportunities — Not available.
        </Typography>
      ) : (
        entries.map(([id, wait]) => (
          <Box key={id} sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography fontWeight={700}>{wait.summary}</Typography>
            <Typography variant="body2" color="text.secondary">
              Trigger: {wait.reevaluateWhen.trigger}
              {wait.reevaluateWhen.priceLevel != null
                ? ` · entry/level ₹${wait.reevaluateWhen.priceLevel}`
                : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Codes: {wait.reasonCodes?.join(', ') || '—'} · id {id}
            </Typography>
          </Box>
        ))
      )}
    </Box>
  );
}
