import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import type {
  AltDataView,
  FundamentalView,
  PeerValuationView,
  StockQuote,
} from '@stockpred/shared-types';
import type { StockBriefPrediction, TradeAction } from '../lib/stock-brief';
import { buildTradeThesis } from '../lib/trade-thesis';

export default function TradeThesisPanel(props: {
  stock?: StockQuote | null;
  altData?: AltDataView | null;
  fundamentals?: FundamentalView | null;
  peer?: PeerValuationView | null;
  paperAction: TradeAction;
  predictions?: StockBriefPrediction[];
  patternOutlook?: string | null;
  signalConfidence?: number | null;
  signalRules?: Record<string, boolean> | null;
}): JSX.Element {
  const thesis = buildTradeThesis(props);
  const borderColor =
    thesis.action === 'BUY'
      ? 'success.main'
      : thesis.action === 'SELL'
        ? 'error.main'
        : 'info.main';

  return (
    <Card
      variant="outlined"
      data-testid="trade-thesis-panel"
      sx={{ borderLeft: 4, borderLeftColor: borderColor }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            {thesis.headline}
          </Typography>
          <Chip
            size="small"
            color={
              thesis.action === 'BUY' ? 'success' : thesis.action === 'SELL' ? 'error' : 'default'
            }
            label={thesis.action}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {thesis.summary}
        </Typography>

        {thesis.levels.length > 0 && (
          <Alert severity="info" sx={{ mb: 1.5 }} icon={false}>
            {thesis.levels.join(' ')}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          }}
        >
          <Box>
            <Typography variant="body2" fontWeight={700} color="success.main" gutterBottom>
              Supporting a buy
            </Typography>
            {thesis.whyBuy.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No strong buy supports yet — ingest data or wait for a clearer signal.
              </Typography>
            ) : (
              <List dense disablePadding>
                {thesis.whyBuy.map((line) => (
                  <ListItem key={line} disableGutters sx={{ alignItems: 'flex-start', py: 0.25 }}>
                    <ListItemText primary={line} primaryTypographyProps={{ variant: 'body2' }} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
          <Box>
            <Typography variant="body2" fontWeight={700} color="warning.main" gutterBottom>
              Risks / cautions
            </Typography>
            {thesis.whyCaution.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No major cautions flagged from the loaded feeds.
              </Typography>
            ) : (
              <List dense disablePadding>
                {thesis.whyCaution.map((line) => (
                  <ListItem key={line} disableGutters sx={{ alignItems: 'flex-start', py: 0.25 }}>
                    <ListItemText primary={line} primaryTypographyProps={{ variant: 'body2' }} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          Not investment advice. Paper levels and scores are model outputs — confirm with your own
          risk limits before trading.
        </Typography>
      </CardContent>
    </Card>
  );
}
