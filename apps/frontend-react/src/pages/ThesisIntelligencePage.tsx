import { Alert, Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetAgentOpportunitiesQuery } from '../store/api';

/** Thesis Intelligence advanced view — existing contracts only; advisory. */
export default function ThesisIntelligencePage(): JSX.Element {
  const { data } = useGetAgentOpportunitiesQuery({ limit: 25 });
  const byId = data?.thesisIntelligenceById ?? {};
  const entries = Object.entries(byId);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Thesis Intelligence
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Thesis weakening does <strong>not</strong> automatically mean SELL. Exit authority remains
        the existing policy path. Open opportunities on{' '}
        <Typography component={RouterLink} to="/agent" variant="body2">
          Desk
        </Typography>
        .
      </Alert>
      {entries.length === 0 ? (
        <Typography color="text.secondary">
          No thesis payloads on current opportunities — Not available.
        </Typography>
      ) : (
        entries.map(([id, thesis]) => (
          <Box key={id} sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography fontWeight={700}>{thesis.primaryThesis}</Typography>
            <Typography variant="body2" color="text.secondary">
              State: {thesis.state} · id {id}
            </Typography>
            {thesis.invalidationConditions?.length ? (
              <Typography variant="caption" display="block" color="text.secondary">
                Invalidation: {thesis.invalidationConditions.join(' · ')}
              </Typography>
            ) : null}
          </Box>
        ))
      )}
    </Box>
  );
}
