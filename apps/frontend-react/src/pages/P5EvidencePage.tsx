import {
  Alert,
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  useGetAgentHumanIntelMetricsQuery,
  useGetAgentModeQuery,
  useGetP5EvidenceUnlockQuery,
} from '../store/api';

/**
 * UI-10 — strictly read-only.
 * May READ metrics / evidenceUnlock / verdict.
 * May NOT mutate evidence, recalc, change floors/verdict, or ARM P6.
 */
export default function P5EvidencePage(): JSX.Element {
  const { data: unlock } = useGetP5EvidenceUnlockQuery(undefined, { pollingInterval: 30_000 });
  const { data: mode } = useGetAgentModeQuery(undefined, { pollingInterval: 30_000 });
  const { data: human } = useGetAgentHumanIntelMetricsQuery(
    { limit: 500 },
    { pollingInterval: 60_000 },
  );

  const overall = unlock?.overallDecision ?? mode?.evidenceUnlock?.overallDecision ?? 'UNKNOWN';
  const unlocked = unlock?.unlocked ?? mode?.evidenceUnlock?.unlocked ?? false;
  const reason = unlock?.reason ?? mode?.evidenceUnlock?.reason ?? 'Not available';
  const reviewed = human?.metrics?.reviewed;

  const p6State = unlocked
    ? 'ARM ELIGIBLE — Human action required on Desk Trading Controls'
    : 'LOCKED';

  const checklist: { label: string; status: string }[] = [
    { label: 'Live handoff (P5 C)', status: 'Not available — ops / export' },
    { label: 'Delayed full chain (P5 D)', status: 'Not available — ops / export' },
    { label: '≥10 UNIQUE ACTUAL (P5 E)', status: 'Not available — ops / export' },
    {
      label: 'Mechanical verdict (P5 F)',
      status: overall === 'UNKNOWN' ? 'Not available' : `Artifact overall=${overall}`,
    },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        P5 Evidence
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Read-only measurement display. This page never ARMs P6 and never changes floors or verdict.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        P5 = <strong>{overall}</strong>
        {unlocked ? ' (measurement GO)' : ''} · P6 = <strong>{p6State}</strong>
        {unlocked ? (
          <>
            {' '}
            — use Desk{' '}
            <Typography component={RouterLink} to="/agent" variant="body2">
              Trading Controls
            </Typography>{' '}
            for human ARM only.
          </>
        ) : null}
      </Alert>

      {unlocked ? (
        <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
          Evidence OVERALL is GO. That makes ARM <em>eligible</em> — it is not an activation button.
        </Alert>
      ) : (
        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
          {reason}
        </Alert>
      )}

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Resilience validation (display only)
      </Typography>
      <Grid container spacing={1} sx={{ mb: 2 }}>
        {checklist.map((row) => (
          <Grid item xs={12} sm={6} key={row.label}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="body2" fontWeight={600}>
                {row.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.status}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={`Overall ${overall}`} color={unlocked ? 'success' : 'default'} />
        <Chip
          variant="outlined"
          label={unlocked ? 'P6 ARM ELIGIBLE' : 'P6 LOCKED'}
          color={unlocked ? 'warning' : 'default'}
        />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Floor / metric</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Source</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Reviewed</TableCell>
              <TableCell>{reviewed != null ? String(reviewed) : 'Not available'}</TableCell>
              <TableCell>human-intel-metrics</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Unique ACTUAL</TableCell>
              <TableCell>Not available</TableCell>
              <TableCell>Export artifact only</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>realizedR / qualityVsRealizedR</TableCell>
              <TableCell>Not available</TableCell>
              <TableCell>Export artifact only</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Overall verdict</TableCell>
              <TableCell>{overall}</TableCell>
              <TableCell>p5-evidence-unlock (read-only)</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Alert severity="info" sx={{ mt: 2 }}>
        Footer: read-only — does not modify evidence, trigger recalculation, change floors, or ARM
        P6.
      </Alert>
    </Box>
  );
}
