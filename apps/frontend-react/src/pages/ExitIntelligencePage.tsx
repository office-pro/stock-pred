import { Alert, Box, Chip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetAgentPositionsQuery } from '../store/api';

/** Exit Intelligence — advisory HOLD/TRIM/EXIT from existing position payloads. */
export default function ExitIntelligencePage(): JSX.Element {
  const { data } = useGetAgentPositionsQuery(undefined, { pollingInterval: 15_000 });
  const lots = (data?.positions ?? []).filter((p) => p.exitIntelligence);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Exit Intelligence
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Exit Intelligence is <strong>advisory</strong>; actual exit authority remains the existing
        policy path. Manage lots on{' '}
        <Typography component={RouterLink} to="/book" variant="body2">
          Book
        </Typography>
        .
      </Alert>
      {lots.length === 0 ? (
        <Typography color="text.secondary">
          No exit intelligence on open lots — Not available.
        </Typography>
      ) : (
        lots.map((lot) => (
          <Box
            key={`${lot.bookKey ?? 'sys'}-${lot.symbol}`}
            sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            <Typography fontWeight={700} component="span" sx={{ mr: 1 }}>
              {lot.symbol}
            </Typography>
            <Chip size="small" label={lot.exitIntelligence!.action} />
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {lot.exitIntelligence!.summary}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Codes: {lot.exitIntelligence!.reasonCodes.join(', ') || '—'}
            </Typography>
          </Box>
        ))
      )}
    </Box>
  );
}
