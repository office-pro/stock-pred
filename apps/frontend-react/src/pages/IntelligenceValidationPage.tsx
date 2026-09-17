/**
 * Intelligence Validation Dashboard — measure/calibrate only.
 * Backend metrics when available; never FE-computed accuracy.
 * Does not modify Risk / Portfolio / Policy / Gate.
 */
import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  useGetAgentCalibrationQuery,
  useGetAgentSoakReportQuery,
  useGetHistoricalPredictionProofQuery,
} from '../store/api';

function fmtRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'Not available';
  return `${(n * 100).toFixed(1)}%`;
}

export default function IntelligenceValidationPage(): JSX.Element {
  const { data: calibration, isLoading: calLoading } = useGetAgentCalibrationQuery();
  const { data: soakReport, isLoading: soakLoading } = useGetAgentSoakReportQuery();
  const { data: proof, isLoading: proofLoading } = useGetHistoricalPredictionProofQuery();

  const claimStatus = proof?.improvementClaim?.status ?? 'IMPROVEMENT_NOT_VERIFIED';
  const verdict = proof?.verdict;
  const proofReady = Boolean(proof?.schemaVersion);

  return (
    <Box sx={{ p: 2, maxWidth: 960 }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Intelligence Validation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Measurement only. Confidence ≠ probability. Insufficient samples → Not available. Does not
        modify Risk / Portfolio / Policy / Gate.
      </Typography>

      <Alert severity="warning" sx={{ mb: 2 }}>
        A–F freeze: <strong>PARTIAL PASS</strong>. Implementation completeness ≠ predictive
        validation. Comparative prediction improvement remains{' '}
        <strong>IMPROVEMENT NOT VERIFIED</strong> unless matched walk-forward returns{' '}
        <strong>IMPROVED</strong>.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Historical prediction proof (matched walk-forward)
        </Typography>
        {proofLoading ? (
          <Typography variant="body2">Loading…</Typography>
        ) : proofReady ? (
          <Stack spacing={1}>
            <Typography variant="body2">
              Verdict: <strong>{verdict ?? 'INCONCLUSIVE'}</strong> · Claim:{' '}
              <strong>{claimStatus}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {proof?.symbol} · {proof?.universe} · {proof?.priceReturnBasis} · membership{' '}
              {proof?.universeMembershipStatus} · scored={proof?.totalScored ?? 0}
            </Typography>
            <Typography variant="body2">
              Gross hit-rate — baseline {fmtRate(proof?.overallBaselineHitRate)} vs enhanced{' '}
              {fmtRate(proof?.overallEnhancedHitRate)}
            </Typography>
            <Typography variant="body2">
              Net (costed) — baseline {fmtRate(proof?.overallBaselineNetHitRate)} vs enhanced{' '}
              {fmtRate(proof?.overallEnhancedNetHitRate)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {proof?.improvementClaim?.message}
            </Typography>
            {proof?.notes?.slice(0, 4).map((n) => (
              <Typography key={n} variant="caption" display="block" color="text.secondary">
                {n}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Stack spacing={1}>
            <Typography variant="body2">
              Verdict: <strong>Not available</strong> · Claim: <strong>{claimStatus}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {proof?.improvementClaim?.message ??
                proof?.message ??
                'No matched proof artifact yet. Protocol exists; improvement not proven.'}
            </Typography>
          </Stack>
        )}
      </Paper>

      <Alert severity="info" sx={{ mb: 2 }}>
        Historical analogue reliability and engine×horizon×regime metrics require labeled prediction
        stores with minimum sample thresholds. Until populated, report UNAVAILABLE — never invent
        hit rates.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Soak / Walk-forward report
        </Typography>
        {soakLoading ? (
          <Typography variant="body2">Loading…</Typography>
        ) : soakReport ? (
          <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {JSON.stringify(soakReport, null, 2).slice(0, 4000)}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Not available
          </Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Calibration (agent)
        </Typography>
        {calLoading ? (
          <Typography variant="body2">Loading…</Typography>
        ) : calibration ? (
          <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {JSON.stringify(calibration, null, 2).slice(0, 4000)}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Calibration Not available — uncalibrated outputs must not be shown as calibrated
            probabilities.
          </Typography>
        )}
      </Paper>

      <Stack direction="row" spacing={2}>
        <Typography variant="body2">
          <RouterLink to="/overview">Command Center →</RouterLink>
        </Typography>
        <Typography variant="body2">
          <RouterLink to="/agent">Agent Desk →</RouterLink>
        </Typography>
        <Typography variant="body2">
          <RouterLink to="/ml-lab/validation">ML Lab Validation →</RouterLink>
        </Typography>
      </Stack>
    </Box>
  );
}
