import { Box, Chip, Stack, Typography } from '@mui/material';

type RankingDimensions = {
  ev: string;
  rs: string;
  sector: string;
  mtf: string;
  regime: string;
  eventSafety: string;
  technical: string;
  liquidity: string;
  freshness: string;
  portfolioFit: string;
};

/**
 * UI-6 — display existing ranking/opportunity fields only.
 * ML only when API provides it (never frontend-derived).
 */
export default function OpportunityIntelligencePanel({
  dimensions,
  thesis,
  decision,
  mlLabel,
}: {
  dimensions?: RankingDimensions | null;
  thesis?: string;
  decision?: string;
  /** Pass only when an API returned ML prediction/model data */
  mlLabel?: string | null;
}): JSX.Element {
  const row = (label: string, value: string | undefined | null): JSX.Element => (
    <Stack direction="row" spacing={1} key={label}>
      <Typography variant="caption" sx={{ minWidth: 120, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={600}>
        {value && String(value).trim() ? value : 'Not available'}
      </Typography>
    </Stack>
  );

  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
        Intelligence Explorer (API fields only)
      </Typography>
      {row('Recommendation', decision)}
      {row('Technical', dimensions?.technical)}
      {row('Fundamental', null)}
      {row('Relative Strength', dimensions?.rs)}
      {row('Sector', dimensions?.sector)}
      {row('Multi-Horizon', dimensions?.mtf)}
      {row('Regime', dimensions?.regime)}
      {row('Catalyst / event', dimensions?.eventSafety)}
      {row('Liquidity', dimensions?.liquidity)}
      {row('Freshness dim', dimensions?.freshness)}
      {row('Portfolio fit', dimensions?.portfolioFit)}
      {row('EV dim', dimensions?.ev)}
      {row('Thesis', thesis)}
      {row('ML', mlLabel ?? null)}
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
        <Chip size="small" variant="outlined" label="No FE ranking" />
        <Chip size="small" variant="outlined" label="No FE ML inference" />
      </Stack>
    </Box>
  );
}
