import { Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import type { FundamentalView } from '@stockpred/shared-types';

function fmtDate(ms: number | null | undefined): string {
  if (ms == null || ms <= 0 || Number.isNaN(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Grid item xs={6} sm={4} md={3}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value}
      </Typography>
    </Grid>
  );
}

export default function FundamentalsPanel({
  data,
}: {
  data: FundamentalView | undefined;
}): JSX.Element {
  if (!data || data.missing) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Fundamentals
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No as-of snapshot yet. Run{' '}
            <code>npm run ingest:fundamentals -- --universe nifty50</code> then retrain. These
            numbers feed the same direction model — not a second FA score.
          </Typography>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Fundamentals
          </Typography>
          {data.displayScore != null && (
            <Chip size="small" color="primary" label={`Score ${Math.round(data.displayScore)}`} />
          )}
          {data.sector && <Chip size="small" variant="outlined" label={data.sector} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Period ended {fmtDate(data.asOfDate)} · available {fmtDate(data.availableAt)}. Display
          score is a rubric for this panel; the model uses the raw ratios, not this number.
        </Typography>
        <Grid container spacing={1.5}>
          <Metric label="PE" value={fmtNum(data.pe, 1)} />
          <Metric label="PB" value={fmtNum(data.pb, 2)} />
          <Metric label="ROE" value={fmtPct(data.roe)} />
          <Metric label="D/E" value={fmtNum(data.debtEquity, 2)} />
          <Metric label="Revenue YoY" value={fmtPct(data.revYoy)} />
          <Metric label="PAT YoY" value={fmtPct(data.patYoy)} />
          <Metric label="Net margin" value={fmtPct(data.netMargin)} />
          <Metric label="Current ratio" value={fmtNum(data.currentRatio, 2)} />
        </Grid>
      </CardContent>
    </Card>
  );
}
