import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import {
  MANIPULATION_DISCLAIMER,
  type ManipulationBand,
  type ManipulationSnapshot,
} from '@stockpred/shared-types';

const BAND_COLOR: Record<ManipulationBand, 'default' | 'warning' | 'error'> = {
  NORMAL: 'default',
  SUSPICIOUS: 'warning',
  INVESTIGATE: 'error',
};

function ComponentBar({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <Box sx={{ mb: 0.75 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, Math.max(0, value))}
        color={value >= 70 ? 'error' : value >= 40 ? 'warning' : 'primary'}
        sx={{ height: 6, borderRadius: 1 }}
      />
    </Box>
  );
}

export default function ManipulationPanel({
  snapshot,
}: {
  snapshot: ManipulationSnapshot;
}): JSX.Element {
  const mlPct =
    snapshot.investigateProbability != null
      ? Math.round(snapshot.investigateProbability * 100)
      : null;
  return (
    <>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Unusual activity
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        <Chip size="small" color={BAND_COLOR[snapshot.band]} label={snapshot.band} />
        <Chip size="small" label={`Intensity ${snapshot.investigateIntensity}/100`} />
        {mlPct != null && <Chip size="small" label={`Model ${mlPct}%`} />}
        <Chip size="small" variant="outlined" label={snapshot.modelVersion} />
      </Stack>
      <ComponentBar label="Price" value={snapshot.priceAnomaly} />
      <ComponentBar label="Volume" value={snapshot.volumeAnomaly} />
      <ComponentBar label="Volatility" value={snapshot.volatilityAnomaly} />
      <ComponentBar label="vs Nifty" value={snapshot.marketRelativeAnomaly} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 0.5 }}>
        {(snapshot.evidence ?? []).join(' · ') || 'No standout evidence on the latest bar.'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {MANIPULATION_DISCLAIMER}
      </Typography>
    </>
  );
}
