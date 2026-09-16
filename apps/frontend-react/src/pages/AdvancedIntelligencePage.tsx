import { Box, Card, CardContent, Grid, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import {
  useAssessGlobalEventMutation,
  useGetCrossAssetIntelligenceQuery,
  useGetFnoIntelligenceQuery,
  useGetIntelligenceSectorsQuery,
} from '../store/api';

/**
 * Advanced Intelligence — API-backed advisory panels where contracts exist.
 * Remaining backlog cards stay Not available (no fabricated engines).
 */

const BACKLOG = [
  'Market Breadth',
  'Liquidity',
  'Volatility',
  'News/Sentiment',
  'Institutional Flow',
  'Market Integrity',
  'Scenario',
  'Execution Intel',
  'Learning',
] as const;

function statusLine(status?: string, reason?: string): string {
  if (!status) return 'Loading…';
  if (status === 'AVAILABLE') return 'Available';
  if (status === 'UNAVAILABLE') return reason ? `Not available (${reason})` : 'Not available';
  return status;
}

export default function AdvancedIntelligencePage(): JSX.Element {
  const [symbol, setSymbol] = useState('TCS');
  const { data: sectors } = useGetIntelligenceSectorsQuery();
  const { data: fno } = useGetFnoIntelligenceQuery(symbol, { skip: !symbol.trim() });
  const { data: cross } = useGetCrossAssetIntelligenceQuery(
    { symbol, asset: 'NIFTY' },
    { skip: !symbol.trim() },
  );
  const [assessGlobal, globalState] = useAssessGlobalEventMutation();

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Advanced Intelligence
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        Advisory panels call backend contracts only. Missing feeds stay Not available — never
        fabricated.
      </Typography>

      <TextField
        size="small"
        label="Symbol"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        sx={{ mb: 2, maxWidth: 160 }}
      />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                Sectors (B9)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {sectors?.sectors?.length
                  ? `${sectors.sectors.length} sectors loaded from MDS membership`
                  : 'Not available'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                F&O (B15)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {statusLine(fno?.status, fno?.reason)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                Cross Asset (B14)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {cross?.status === 'AVAILABLE'
                  ? `vs NIFTY · pearson ${cross.pearson ?? '—'}`
                  : statusLine(cross?.status, cross?.reason)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700}>
                Global Events (B17)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
                {globalState.data?.event
                  ? statusLine(
                      globalState.data.event.status,
                      globalState.data.event.direction
                        ? `direction ${globalState.data.event.direction}`
                        : undefined,
                    )
                  : 'Probe US_CPI mapping (targeted universe only)'}
              </Typography>
              <Typography
                component="button"
                variant="body2"
                onClick={() => void assessGlobal({ eventType: 'US_CPI', source: 'advanced-ui' })}
                sx={{
                  border: 0,
                  background: 'none',
                  color: 'primary.main',
                  cursor: 'pointer',
                  p: 0,
                  textDecoration: 'underline',
                }}
              >
                Assess sample US_CPI event
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Backlog (no contract yet)
      </Typography>
      <Grid container spacing={2}>
        {BACKLOG.map((name) => (
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
