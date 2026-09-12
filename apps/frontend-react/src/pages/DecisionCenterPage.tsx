import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Decision Center — explains the frozen auth chain.
 * Pass/fail comes only from backend responses; UI does not infer eligibility.
 */
const STEPS = [
  'Intelligence',
  'Recommendation',
  'evaluateTrade',
  'Risk',
  'Portfolio',
  'Policy',
  'Gate',
  'Execution',
] as const;

export default function DecisionCenterPage(): JSX.Element {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Decision Center
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Authorization always runs on the backend. This page explains the chain — it does not approve
        or size trades.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Approve on{' '}
        <Typography component={RouterLink} to="/agent" variant="body2">
          Desk
        </Typography>{' '}
        calls the existing recommendation API. Block reasons (e.g. DATA_STALE) come from Risk / Gate
        responses — the UI never decides freshness authorization.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Frozen chain
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {STEPS.map((step) => (
            <Chip key={step} label={step} variant="outlined" />
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Example block (display only)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Risk ✕ DATA_STALE — quote age above the 60s Risk boundary. DELAYED (30–60s) still enters
          this same chain; the frontend must not grey Approve solely for DELAYED or liveUsable.
        </Typography>
      </Paper>
    </Box>
  );
}
