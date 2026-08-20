import { Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import type { AltDataView } from '@stockpred/shared-types';

function fmtDate(ms: number | null | undefined): string {
  if (ms == null || ms <= 0 || Number.isNaN(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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

export default function AltDataPanel({ data }: { data: AltDataView | undefined }): JSX.Element {
  if (!data || data.missing) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            News / Social / Macro
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No as-of alternative data yet. Use <b>Data ingest</b> above for news, social, and macro,
            then refresh. These numbers feed the same direction model — not a second score.
          </Typography>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          News / Social / Macro
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Point-in-time windows only. Display values are not a buy/sell score.
        </Typography>
        {data.news ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                News
              </Typography>
              <Typography variant="caption" color="text.secondary">
                as of {fmtDate(data.news.availableAt)}
              </Typography>
            </Stack>
            <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
              <Metric label="Sentiment 7d" value={fmtNum(data.news.sentiment7d)} />
              <Metric label="Articles 7d" value={fmtNum(data.news.count7d, 0)} />
              <Metric label="High-impact 7d" value={fmtNum(data.news.highImpact7d, 0)} />
              <Metric label="Earnings tone" value={fmtNum(data.news.earningsSentiment)} />
            </Grid>
          </>
        ) : null}
        {data.social ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                Social
              </Typography>
              <Typography variant="caption" color="text.secondary">
                as of {fmtDate(data.social.availableAt)}
              </Typography>
            </Stack>
            <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
              <Metric label="Mentions 1d" value={fmtNum(data.social.mentions1d, 0)} />
              <Metric label="Attention spike" value={fmtNum(data.social.attentionSpike)} />
              <Metric label="Sentiment 1d" value={fmtNum(data.social.sentiment1d)} />
              <Metric label="Coordination" value={fmtNum(data.social.coordination)} />
            </Grid>
          </>
        ) : null}
        {data.macro ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                Macro
              </Typography>
              <Typography variant="caption" color="text.secondary">
                as of {fmtDate(data.macro.availableAt)}
              </Typography>
            </Stack>
            <Grid container spacing={1.5}>
              <Metric label="USD/INR 20d" value={fmtNum(data.macro.usdinrChg20d)} />
              <Metric label="Brent 20d" value={fmtNum(data.macro.brentChg20d)} />
              <Metric label="Repo" value={fmtNum(data.macro.repoRate)} />
              <Metric label="Repo 90d" value={fmtNum(data.macro.repoChg90d)} />
            </Grid>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
