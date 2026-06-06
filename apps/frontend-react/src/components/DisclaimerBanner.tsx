import { Alert } from '@mui/material';
import { DISCLAIMER } from '@stockpred/shared-types';

/** Compliance: shown on every page. Predictions are probabilistic. */
export default function DisclaimerBanner(): JSX.Element {
  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 2 }} data-testid="disclaimer-banner">
      {DISCLAIMER} Predictions are probabilistic; there is no guarantee of profits. Paper trading is
      enabled by default - live trading requires explicit broker authorization.
    </Alert>
  );
}
