import {
  Box,
  Button,
  Chip,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import OpportunityIntelligencePanel from './OpportunityIntelligencePanel';

type RankingRow = {
  rank: number;
  symbol: string;
  opportunityId: string;
  dominance: string;
  stale: boolean;
  dataCompleteness: string;
  strengths: Array<{ code: string; message: string }>;
  weaknesses: Array<{ code: string; message: string }>;
  dimensions: {
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
};

type OppRow = {
  symbol: string;
  decision: string;
  recommendationId?: string;
  thesis: string;
  setup: { positionSize: number; entry?: number | null; stopLoss?: number | null };
  scores: { overall: number };
};

/**
 * Wireframe Desk command center — 3 panes.
 * Best Opps consume backend ranking order only (no FE re-sort).
 * Approve/Wait/Reject must call parent handlers → existing APIs.
 */
export default function DeskThreePane({
  rankings,
  rankingContextLabel,
  noClearWinner,
  selectedSymbol,
  onSelectSymbol,
  selectedOpp,
  selectedRank,
  canApprove,
  approvalsBlocked,
  approveBlockReason,
  onApprove,
  onWait,
  onReject,
  waitBusy,
  rejectBusy,
  tradingControls,
}: {
  rankings: RankingRow[];
  rankingContextLabel: string;
  noClearWinner: boolean;
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  selectedOpp: OppRow | null;
  selectedRank?: RankingRow;
  canApprove: boolean;
  approvalsBlocked: boolean;
  approveBlockReason: string | null;
  onApprove: () => void;
  onWait: () => void;
  onReject: () => void;
  waitBusy: boolean;
  rejectBusy: boolean;
  tradingControls: ReactNode;
}): JSX.Element {
  const [intelTab, setIntelTab] = useState(0);

  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} md={3}>
        <Paper variant="outlined" sx={{ p: 1.5, height: '100%', maxHeight: 640, overflow: 'auto' }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Best Opportunities
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Backend order only{noClearWinner ? ' · no clear winner' : ''}. {rankingContextLabel}
          </Typography>
          <List dense disablePadding>
            {rankings.map((r) => (
              <ListItemButton
                key={r.opportunityId}
                selected={r.symbol === selectedSymbol}
                onClick={() => onSelectSymbol(r.symbol)}
                sx={{ borderRadius: 1, mb: 0.5 }}
              >
                <ListItemText
                  primary={`#${r.rank} ${r.symbol}`}
                  secondary={r.dominance}
                  primaryTypographyProps={{ fontWeight: 700, variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
                {r.stale ? <Chip size="small" color="warning" label="STALE" /> : null}
              </ListItemButton>
            ))}
            {rankings.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ p: 1 }}>
                No rankings from API yet.
              </Typography>
            ) : null}
          </List>
        </Paper>
      </Grid>

      <Grid item xs={12} md={6}>
        <Paper variant="outlined" sx={{ p: 2, minHeight: 420 }}>
          {selectedOpp ? (
            <>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h5" fontWeight={800}>
                  {selectedOpp.symbol}
                </Typography>
                <Chip size="small" label={selectedOpp.decision} color="primary" />
                {selectedRank ? (
                  <Chip size="small" variant="outlined" label={`#${selectedRank.rank}`} />
                ) : null}
                <Button
                  size="small"
                  component={RouterLink}
                  to={`/stocks/${selectedOpp.symbol}`}
                  variant="text"
                >
                  Chart
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
                {selectedOpp.thesis || 'Thesis Not available'}
              </Typography>

              <Tabs
                value={intelTab}
                onChange={(_e, v: number) => setIntelTab(v)}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
              >
                <Tab label="Overview" />
                <Tab label="Intelligence" />
              </Tabs>

              {intelTab === 0 ? (
                <Stack spacing={0.5} sx={{ mb: 2 }}>
                  <Typography variant="caption">
                    Entry {selectedOpp.setup.entry ?? '—'} · Stop{' '}
                    {selectedOpp.setup.stopLoss ?? '—'} · Size{' '}
                    {selectedOpp.setup.positionSize || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Overall score field from API: {selectedOpp.scores.overall} (not RankingScore /
                    not authorization)
                  </Typography>
                </Stack>
              ) : (
                <Box sx={{ mb: 2 }}>
                  <OpportunityIntelligencePanel
                    dimensions={selectedRank?.dimensions}
                    thesis={selectedOpp.thesis}
                    decision={selectedOpp.decision}
                    mlLabel={null}
                  />
                </Box>
              )}

              <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
                Decision
              </Typography>
              {approveBlockReason ? (
                <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1 }}>
                  {approveBlockReason}
                </Typography>
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  color="success"
                  size="large"
                  disabled={!canApprove || approvalsBlocked}
                  onClick={onApprove}
                >
                  Approve
                </Button>
                <Button
                  variant="contained"
                  color="warning"
                  size="large"
                  disabled={!selectedOpp.recommendationId || waitBusy || approvalsBlocked}
                  onClick={onWait}
                >
                  Wait
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  size="large"
                  disabled={!selectedOpp.recommendationId || rejectBusy || approvalsBlocked}
                  onClick={onReject}
                >
                  Reject
                </Button>
              </Stack>
            </>
          ) : (
            <Typography color="text.secondary">
              Select an opportunity from the left list.
            </Typography>
          )}
        </Paper>
      </Grid>

      <Grid item xs={12} md={3}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Trading Controls
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Mode / Kill / ARM — not the same as Approve.
          </Typography>
          {tradingControls}
        </Paper>
      </Grid>
    </Grid>
  );
}
