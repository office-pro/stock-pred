import { Box, Card, CardActionArea, CardContent, Grid, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const JOBS = [
  {
    title: 'Overview',
    to: '/overview',
    blurb: 'What is happening? Latest batch research report.',
  },
  {
    title: 'Batch',
    to: '/batch',
    blurb: 'Run intelligence batches — sector-first discovery.',
  },
  {
    title: 'Bull Run',
    to: '/bull-run',
    blurb: 'Target × horizon probabilities (estimates, not guarantees).',
  },
  {
    title: 'Discover',
    to: '/overview',
    blurb: 'Best opportunities from RankingContext — not FE scores.',
  },
  {
    title: 'Market',
    to: '/market',
    blurb: 'What is happening? Indices, tape, session.',
  },
  {
    title: 'Prep',
    to: '/prep',
    blurb: 'What should I watch? Offline Focus Universe.',
  },
  {
    title: 'Desk',
    to: '/agent',
    blurb: 'What should I do? Best Opportunities → Approve.',
  },
  {
    title: 'Book',
    to: '/book',
    blurb: 'What happened? Agent positions and journal.',
  },
] as const;

export default function HomePage(): JSX.Element {
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', py: 2 }}>
      <Typography variant="h3" sx={{ fontWeight: 800, mb: 1 }}>
        StockPred
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ mb: 3, fontWeight: 400 }}>
        Built around the trading brain. No second Risk / Gate / Execution path.
      </Typography>
      <Grid container spacing={2}>
        {JOBS.map((job) => (
          <Grid item xs={12} sm={6} key={job.to}>
            <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardActionArea component={RouterLink} to={job.to} sx={{ height: '100%' }}>
                <CardContent sx={{ minHeight: 140 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                    {job.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {job.blurb}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
