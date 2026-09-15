import {
  Alert,
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetContinuousEventsQuery, useGetPositionManagementPlansQuery } from '../store/api';

/**
 * B8 Live Monitor — continuous intelligence events + position plans from backend.
 * Events are intelligence only; never orders. DELAYED ≠ execution eligibility.
 */
export default function LiveMonitorPage(): JSX.Element {
  const { data: events = [] } = useGetContinuousEventsQuery({ limit: 50 });
  const { data: plans = [] } = useGetPositionManagementPlansQuery({ limit: 50 });

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Live Intelligence
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Continuous reassessment events and PositionManagementPlans. The UI never amends orders —
        recommendations still flow through evaluateTrade → Risk → Portfolio → Policy → Gate.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        DELAYED data may appear here for intelligence. Execution eligibility remains with Risk /
        Gate — see{' '}
        <Typography component={RouterLink} to="/advanced/decision" variant="body2">
          Decision Center
        </Typography>
        .
      </Alert>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ p: 2, pb: 0 }}>
          Events
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Priority</TableCell>
              <TableCell>Symbol</TableCell>
              <TableCell>Trigger</TableCell>
              <TableCell>Data</TableCell>
              <TableCell>Message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.eventId} hover>
                <TableCell>
                  <Chip size="small" label={e.priority} />
                </TableCell>
                <TableCell>{e.symbol}</TableCell>
                <TableCell>{e.trigger}</TableCell>
                <TableCell>{e.dataStatus}</TableCell>
                <TableCell>{e.message}</TableCell>
              </TableRow>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                    No continuous events yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="subtitle2" fontWeight={700} sx={{ p: 2, pb: 0 }}>
          Position management plans (real positions only)
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Advisory</TableCell>
              <TableCell>Thesis</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={`${p.positionId}-${p.symbol}`} hover>
                <TableCell>{p.symbol}</TableCell>
                <TableCell>{p.recommendedAction}</TableCell>
                <TableCell>{p.recommendation}</TableCell>
                <TableCell>{p.thesisState ?? '—'}</TableCell>
                <TableCell>{p.reassessmentReason}</TableCell>
              </TableRow>
            ))}
            {plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                    No position plans — research symbols do not invent positions.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
