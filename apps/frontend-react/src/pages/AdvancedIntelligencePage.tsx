import { Box, Card, CardContent, Grid, Typography } from '@mui/material';

/**
 * UI-11 — flat Not available cards only.
 * Do not invent engines, schemas, or fake intelligence modules.
 */
const ROWS = [
  'Market Breadth',
  'Liquidity',
  'Volatility',
  'News/Sentiment',
  'F&O',
  'Cross Asset',
  'Institutional Flow',
  'Market Integrity',
  'Scenario',
  'Execution Intel',
  'Learning',
] as const;

export default function AdvancedIntelligencePage(): JSX.Element {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Advanced Intelligence
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Future capability backlog. No fabricated data — each card stays Not available until a real
        backend contract exists.
      </Typography>
      <Grid container spacing={2}>
        {ROWS.map((name) => (
          <Grid item xs={12} sm={6} md={4} key={name}>
            <Card variant="outlined" sx={{ opacity: 0.75, height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>
                  {name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Not available
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
